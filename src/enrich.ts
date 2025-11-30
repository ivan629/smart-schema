import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlock, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import pTimeout, { TimeoutError as PTimeoutError } from 'p-timeout';
import { AI_CONFIG, RELATIONSHIP_INDICATORS } from './constants.js';
import {
    inferAggregationType,
    inferFieldDescription,
    inferFieldRole,
    inferPersonalDataType,
} from './inference.js';
import {
    buildDomainPrompt,
    buildFieldEnrichmentPrompt,
    buildRelationshipPrompt,
    type TableSummary,
} from './prompts.js';
import type {
    Entity,
    Field,
    Logger,
    MultiTableSchema,
    Relationship,
    StatsField,
    StatsMultiTableSchema,
    TableCapabilities,
    TableSchema,
} from './types.js';
import { nullLogger, TimeoutError } from './types.js';
import { countTotalFields, extractJsonFromText, removeUndefinedValues } from './utils.js';
import {
    type ValidatedDomainResponse,
    type ValidatedFieldsResponse,
    type ValidatedRelationshipsResponse,
    validateDomainResponse,
    validateFieldsResponse,
    validateRelationshipsResponse,
} from './validation.js';

export interface EnrichOptions {
    readonly model?: string;
    readonly logger?: Logger;
    readonly timeout?: number;
}

interface ResolvedEnrichOptions {
    readonly model: string;
    readonly logger: Logger;
    readonly timeout: number;
}

function resolveOptions(options: EnrichOptions): ResolvedEnrichOptions {
    return {
        model: options.model ?? AI_CONFIG.defaultModel,
        logger: options.logger ?? nullLogger,
        timeout: options.timeout ?? AI_CONFIG.defaultTimeoutMs,
    };
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
): Promise<T> {
    try {
        return await pTimeout(promise, {
            milliseconds: timeoutMs,
            message: `${operationName} timed out after ${timeoutMs}ms`,
        });
    } catch (error) {
        if (error instanceof PTimeoutError) {
            throw new TimeoutError(error.message);
        }
        throw error;
    }
}

function extractTextFromContent(content: ContentBlock): string {
    if (content.type === 'text') {
        return content.text;
    }
    throw new Error('Unexpected response type from AI');
}

interface CompletionConfig {
    model: string;
    maxTokens: number;
    temperature: number;
    messages: MessageParam[];
}

async function streamCompletion(client: Anthropic, config: CompletionConfig): Promise<string> {
    const stream = await client.messages.stream({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: config.messages,
    });

    const response = await stream.finalMessage();
    const content = response.content[0];

    if (!content) {
        throw new Error('Empty response from AI');
    }

    return extractTextFromContent(content);
}

function buildDefaultCapabilities(fields: readonly Field[]): TableCapabilities {
    const timeSeriesField = fields.find((field) => field.role === 'time');

    const base = {
        measures: fields.filter((field) => field.role === 'measure').map((field) => field.path),
        dimensions: fields.filter((field) => field.role === 'dimension').map((field) => field.path),
        searchable: fields.filter((field) => field.role === 'text').map((field) => field.path),
    };

    if (timeSeriesField) {
        return { ...base, timeSeries: timeSeriesField.path };
    }

    return base;
}

function buildFieldFromStats(statsField: StatsField): Field {
    return removeUndefinedValues({
        path: statsField.path,
        type: statsField.type,
        nullable: statsField.nullable,
        role: inferFieldRole(statsField),
        description: inferFieldDescription(statsField),
        personalData: inferPersonalDataType(statsField),
        aggregation: inferAggregationType(statsField),
        format: statsField.format,
        itemType: statsField.itemType,
    }) as Field;
}

export function applyDefaults(stats: StatsMultiTableSchema): MultiTableSchema {
    const tables: Record<string, TableSchema> = {};

    for (const [tableName, statsTable] of Object.entries(stats.tables)) {
        const fields: Field[] = statsTable.fields.map(buildFieldFromStats);

        tables[tableName] = {
            domain: 'unknown',
            description: `Table containing ${statsTable.fields.length} fields`,
            dataGrain: 'one row per record',
            entities: [],
            fields,
            capabilities: buildDefaultCapabilities(fields),
        };
    }

    return {
        domain: 'unknown',
        description: 'Schema generated without AI enrichment',
        tables,
    };
}

async function enrichFields(
    client: Anthropic,
    stats: StatsMultiTableSchema,
    options: ResolvedEnrichOptions
): Promise<ValidatedFieldsResponse> {
    const { logger, timeout, model } = options;

    const execute = async (): Promise<string> => {
        const responseText = await streamCompletion(client, {
            model,
            maxTokens: AI_CONFIG.maxTokens.fieldEnrichment,
            temperature: AI_CONFIG.temperature,
            messages: [{ role: 'user', content: buildFieldEnrichmentPrompt(stats) }],
        });
        return extractJsonFromText(responseText);
    };

    const rawResponse = await withTimeout(execute(), timeout, 'Field enrichment');
    logger.debug('Field enrichment response received');

    return validateFieldsResponse(rawResponse);
}

function buildTableSummaries(
    stats: StatsMultiTableSchema,
    fields: ValidatedFieldsResponse
): TableSummary[] {
    return Object.keys(stats.tables).map((tableName) => {
        const tableFields = fields.tables[tableName] ?? {};

        return {
            table: tableName,
            identifiers: Object.entries(tableFields)
                .filter(([, field]) => field.role === 'identifier')
                .map(([path]) => path),
            references: Object.entries(tableFields)
                .filter(([, field]) => field.role === 'reference')
                .map(([path]) => path),
            allFields: Object.keys(tableFields),
        };
    });
}

function hasRelationshipPotential(tableSummaries: readonly TableSummary[]): boolean {
    const hasReferences = tableSummaries.some((table) => table.references.length > 0);
    const hasMultipleTables = tableSummaries.length >= 2;

    const hasSelfReferencePotential = tableSummaries.some((table) => {
        if (table.identifiers.length === 0) {
            return false;
        }

        const primaryIdentifier = table.identifiers[0];

        return table.allFields.some((fieldPath) => {
            if (fieldPath === primaryIdentifier) {
                return false;
            }

            const hasForeignKeySuffix = RELATIONSHIP_INDICATORS.foreignKeySuffixes.some((suffix) =>
                fieldPath.endsWith(suffix)
            );

            const hasSelfReferencePattern = RELATIONSHIP_INDICATORS.selfReferencePatterns.some(
                (pattern) => fieldPath.includes(pattern)
            );

            return hasForeignKeySuffix || hasSelfReferencePattern;
        });
    });

    return hasReferences || hasMultipleTables || hasSelfReferencePotential;
}

async function detectRelationships(
    client: Anthropic,
    stats: StatsMultiTableSchema,
    fields: ValidatedFieldsResponse,
    options: ResolvedEnrichOptions
): Promise<ValidatedRelationshipsResponse> {
    const tableSummaries = buildTableSummaries(stats, fields);

    if (!hasRelationshipPotential(tableSummaries)) {
        return { relationships: [] };
    }

    const { logger, timeout, model } = options;

    const execute = async (): Promise<string> => {
        const responseText = await streamCompletion(client, {
            model,
            maxTokens: AI_CONFIG.maxTokens.relationshipDetection,
            temperature: AI_CONFIG.temperature,
            messages: [{ role: 'user', content: buildRelationshipPrompt(tableSummaries) }],
        });
        return extractJsonFromText(responseText);
    };

    const rawResponse = await withTimeout(execute(), timeout, 'Relationship detection');
    logger.debug('Relationship detection response received');

    return validateRelationshipsResponse(rawResponse);
}

function calculateDomainSynthesisTokens(stats: StatsMultiTableSchema): number {
    const totalFieldCount = countTotalFields(stats.tables);
    const { minimum, tokensPerField, maximum } = AI_CONFIG.maxTokens.domainSynthesis;
    const estimatedTokens = Math.min(totalFieldCount * tokensPerField, maximum);
    return Math.max(estimatedTokens, minimum);
}

async function synthesizeDomain(
    client: Anthropic,
    stats: StatsMultiTableSchema,
    fields: ValidatedFieldsResponse,
    options: ResolvedEnrichOptions
): Promise<ValidatedDomainResponse> {
    const { logger, timeout, model } = options;
    const maxTokens = calculateDomainSynthesisTokens(stats);

    const execute = async (): Promise<string> => {
        const responseText = await streamCompletion(client, {
            model,
            maxTokens,
            temperature: AI_CONFIG.temperature,
            messages: [{ role: 'user', content: buildDomainPrompt(stats, fields) }],
        });
        return extractJsonFromText(responseText);
    };

    const rawResponse = await withTimeout(execute(), timeout, 'Domain synthesis');
    logger.debug('Domain synthesis response received');

    return validateDomainResponse(rawResponse);
}

type EnrichedFieldData = ValidatedFieldsResponse['tables'][string][string];

function buildEnrichedField(
    statsField: StatsField,
    enrichedData: EnrichedFieldData | undefined
): Field {
    return removeUndefinedValues({
        path: statsField.path,
        type: statsField.type,
        nullable: statsField.nullable,
        role: enrichedData?.role ?? inferFieldRole(statsField),
        description: enrichedData?.description ?? inferFieldDescription(statsField),
        personalData: enrichedData?.pii ?? inferPersonalDataType(statsField),
        aggregation: enrichedData?.aggregation ?? inferAggregationType(statsField),
        format: statsField.format,
        itemType: statsField.itemType,
        unit: enrichedData?.unit,
    }) as Field;
}

function buildEntity(rawEntity: ValidatedDomainResponse['entities'][number]): Entity {
    return removeUndefinedValues({
        name: rawEntity.name,
        description: rawEntity.description,
        fields: rawEntity.fields,
        idField: rawEntity.idField,
        nameField: rawEntity.nameField,
    }) as Entity;
}

function buildCapabilities(
    tableDomain: ValidatedDomainResponse['tables'][string] | undefined,
    mergedFields: readonly Field[]
): TableCapabilities {
    if (!tableDomain?.capabilities) {
        return buildDefaultCapabilities(mergedFields);
    }

    const caps = tableDomain.capabilities;

    return removeUndefinedValues({
        measures: caps.measures,
        dimensions: caps.dimensions,
        searchable: caps.searchable,
        timeSeries: caps.timeSeries,
    }) as TableCapabilities;
}

function mergeEnrichmentResults(
    stats: StatsMultiTableSchema,
    fields: ValidatedFieldsResponse,
    relationships: ValidatedRelationshipsResponse,
    domain: ValidatedDomainResponse
): MultiTableSchema {
    const tables: Record<string, TableSchema> = {};

    for (const [tableName, statsTable] of Object.entries(stats.tables)) {
        const enrichedFields = fields.tables[tableName] ?? {};
        const tableDomain = domain.tables?.[tableName];

        const tableEntities: Entity[] = (domain.entities ?? [])
            .filter((entity) => entity.table === tableName)
            .map(buildEntity);

        const mergedFields: Field[] = statsTable.fields.map((statsField) => {
            const enriched = enrichedFields[statsField.path];
            return buildEnrichedField(statsField, enriched);
        });

        tables[tableName] = {
            domain: domain.domain ?? 'unknown',
            description:
                tableDomain?.description ?? `Table with ${statsTable.fields.length} fields`,
            dataGrain: tableDomain?.dataGrain ?? 'one row per record',
            entities: tableEntities,
            fields: mergedFields,
            capabilities: buildCapabilities(tableDomain, mergedFields),
        };
    }

    const typedRelationships: Relationship[] = (relationships.relationships ?? []).map((rel) => ({
        from: rel.from,
        to: rel.to,
        type: rel.type,
        confidence: rel.confidence,
        description: rel.description,
    }));

    const result: MultiTableSchema = {
        domain: domain.domain ?? 'unknown',
        description: domain.description ?? 'Schema generated with AI enrichment',
        tables,
    };

    if (typedRelationships.length > 0) {
        return { ...result, relationships: typedRelationships };
    }

    return result;
}

export async function enrich(
    stats: StatsMultiTableSchema,
    apiKey: string,
    options: EnrichOptions = {}
): Promise<MultiTableSchema> {
    const resolvedOptions = resolveOptions(options);
    const { logger } = resolvedOptions;

    const client = new Anthropic({ apiKey });

    logger.info('Enriching fields...');
    const fields = await enrichFields(client, stats, resolvedOptions);

    logger.info('Detecting relationships & synthesizing domain...');
    const [relationships, domain] = await Promise.all([
        detectRelationships(client, stats, fields, resolvedOptions),
        synthesizeDomain(client, stats, fields, resolvedOptions),
    ]);

    return mergeEnrichmentResults(stats, fields, relationships, domain);
}
