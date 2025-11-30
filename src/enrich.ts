/**
 * AI Enrichment Module
 *
 * Enriches pre-compressed structure with semantic descriptions.
 * AI only sees unique elements (archetypes + unique fields), not repetitive structures.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from './types.js';
import { consoleLogger, AIEnrichmentError, AIValidationError, APIError, TimeoutError } from './types.js';
import type { PreCompressedStructure, UniqueField, DetectedArchetype } from './structure.js';
import { buildEnrichmentPrompt, type AIEnrichmentResponse, type AITableEnrichment } from './prompts.js';
import type {
    CompressedSchema,
    CompressedTable,
    CompressedField,
    CompressedEntity,
    Archetype,
    ArchetypeField,
    SchemaMap,
    SchemaDefaults,
    Pattern,
} from './compress.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_TOKENS = 8192;

// ============================================================================
// Types
// ============================================================================

export interface EnrichOptions {
    readonly model?: string;
    readonly timeout?: number;
    readonly logger?: Logger;
}

// ============================================================================
// AI Call
// ============================================================================

async function callAI(
    prompt: string,
    apiKey: string,
    options: EnrichOptions
): Promise<AIEnrichmentResponse> {
    const { model = DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT, logger = consoleLogger } = options;

    const client = new Anthropic({ apiKey });

    logger.debug(`Calling AI model: ${model}`);

    try {
        const response = await Promise.race([
            client.messages.create({
                model,
                max_tokens: MAX_TOKENS,
                messages: [{ role: 'user', content: prompt }],
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new TimeoutError(`AI request timed out after ${timeout}ms`)), timeout)
            ),
        ]);

        const content = response.content[0];
        if (content.type !== 'text') {
            throw new APIError('Unexpected response type from AI');
        }

        const text = content.text.trim();

        // Try to extract JSON from response
        let jsonText = text;

        // Handle markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1].trim();
        }

        try {
            return JSON.parse(jsonText) as AIEnrichmentResponse;
        } catch (parseError) {
            logger.error(`Failed to parse AI response: ${text.slice(0, 500)}`);
            throw new AIValidationError(
                'Failed to parse AI response as JSON',
                [{ message: parseError instanceof Error ? parseError.message : 'Parse error' }]
            );
        }
    } catch (error) {
        if (error instanceof TimeoutError || error instanceof AIValidationError) {
            throw error;
        }

        if (error instanceof Anthropic.APIError) {
            throw new APIError(`Anthropic API error: ${error.message}`);
        }

        throw error;
    }
}

// ============================================================================
// Schema Building
// ============================================================================

function extractDefaults(structure: PreCompressedStructure): SchemaDefaults {
    const nullableCounts = { true: 0, false: 0 };
    const aggregationCounts: Record<string, number> = {};

    for (const fields of structure.uniqueFields.values()) {
        for (const field of fields) {
            nullableCounts[String(field.nullable) as 'true' | 'false']++;
            aggregationCounts[field.aggregation] = (aggregationCounts[field.aggregation] ?? 0) + 1;
        }
    }

    const mostCommonAggregation = Object.entries(aggregationCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'none';

    return {
        nullable: nullableCounts.true > nullableCounts.false,
        personalData: false,
        aggregation: mostCommonAggregation as SchemaDefaults['aggregation'],
    };
}

function buildArchetypes(
    structure: PreCompressedStructure,
    aiResponse: AIEnrichmentResponse
): Record<string, Archetype> {
    const archetypes: Record<string, Archetype> = {};

    for (const [name, detected] of structure.archetypes) {
        const aiArchetype = aiResponse.archetypes?.[name];

        const fields: Record<string, ArchetypeField> = {};
        for (const [fieldName, shape] of detected.fields) {
            const aiField = aiArchetype?.fields?.[fieldName];

            fields[fieldName] = {
                type: shape.type,
                role: shape.role,
                description: aiField?.description ?? `${fieldName} field`,
                ...(shape.aggregation !== 'none' && { aggregation: shape.aggregation }),
                ...(shape.unit && { unit: shape.unit }),
                ...(shape.format && { format: shape.format }),
            };
        }

        archetypes[name] = {
            description: aiArchetype?.description ?? `${name} structure`,
            fields,
        };
    }

    return archetypes;
}

function buildMaps(
    structure: PreCompressedStructure,
    aiResponse: AIEnrichmentResponse
): SchemaMap[] {
    const maps: SchemaMap[] = [];

    for (const [path, detected] of structure.maps) {
        const aiMap = aiResponse.maps?.[path];

        if (detected.archetypeName) {
            maps.push({
                path,
                description: aiMap?.description ?? `Collection at ${path}`,
                keys: detected.keys,
                valueArchetype: detected.archetypeName,
            });
        }
    }

    return maps;
}

function buildCompressedField(
    field: UniqueField,
    defaults: SchemaDefaults,
    aiDescription?: string
): CompressedField {
    const includeAggregation = field.aggregation !== defaults.aggregation;
    const includeNullable = field.nullable !== defaults.nullable;

    return {
        path: field.path,
        type: field.type,
        role: field.role,
        ...(aiDescription && { description: aiDescription }),
        ...(field.format && { format: field.format }),
        ...(field.unit && { unit: field.unit }),
        ...(includeAggregation && { aggregation: field.aggregation }),
        ...(includeNullable && { nullable: field.nullable }),
        ...(field.refKeys && { refKeys: field.refKeys }),
        ...(field.sameAs && { sameAs: field.sameAs }),
    };
}

function buildEntities(
    tableName: string,
    fields: readonly UniqueField[],
    archetypes: Record<string, Archetype>,
    maps: SchemaMap[],
    aiTable?: AITableEnrichment
): CompressedEntity[] {
    const entities: CompressedEntity[] = [];

    // Add AI-detected entities
    if (aiTable?.entities) {
        for (const aiEntity of aiTable.entities) {
            entities.push({
                name: aiEntity.name,
                description: aiEntity.description,
                table: tableName,
                ...(aiEntity.idField && { idField: aiEntity.idField }),
                ...(aiEntity.nameField && { nameField: aiEntity.nameField }),
                primaryFields: fields
                    .filter(f => !f.path.includes('.') || f.path.split('.').length <= 2)
                    .slice(0, 10)
                    .map(f => f.path),
            });
        }
    }

    // Add archetype-based entities
    for (const [archetypeName, archetype] of Object.entries(archetypes)) {
        const matchingMaps = maps.filter(m => m.valueArchetype === archetypeName);

        if (matchingMaps.length > 0) {
            const alreadyExists = entities.some(e => e.archetype === archetypeName);
            if (!alreadyExists) {
                entities.push({
                    name: archetypeName,
                    description: archetype.description,
                    table: tableName,
                    archetype: archetypeName,
                    primaryFields: Object.keys(archetype.fields),
                    occursIn: matchingMaps.map(m => `${m.path}.*`),
                });
            }
        }
    }

    return entities;
}

function buildPatterns(structure: PreCompressedStructure): Pattern[] {
    return structure.patterns.map(p => ({ ...p }));
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function enrichStructure(
    structure: PreCompressedStructure,
    apiKey: string,
    options: EnrichOptions = {}
): Promise<CompressedSchema> {
    const { logger = consoleLogger } = options;

    // Build prompt
    const prompt = buildEnrichmentPrompt(structure);
    logger.debug(`Generated prompt (${prompt.length} chars)`);

    // Call AI
    logger.info('Calling AI for enrichment...');
    const aiResponse = await callAI(prompt, apiKey, options);
    logger.info('AI enrichment received');

    // Build schema
    const defaults = extractDefaults(structure);
    const archetypes = buildArchetypes(structure, aiResponse);
    const allMaps = buildMaps(structure, aiResponse);
    const patterns = buildPatterns(structure);

    const tables: Record<string, CompressedTable> = {};

    for (const [tableName, uniqueFields] of structure.uniqueFields) {
        const aiTable = aiResponse.tables?.[tableName];
        // All maps belong to the table (we only have one table typically)
        // Maps are detected from structure.maps which came from the same table
        const tableMaps = allMaps;

        const fields = uniqueFields.map(f =>
            buildCompressedField(f, defaults, aiTable?.fields?.[f.path]?.description)
        );

        const entities = buildEntities(tableName, uniqueFields, archetypes, tableMaps, aiTable);

        tables[tableName] = {
            description: aiTable?.description ?? `${tableName} table`,
            dataGrain: aiTable?.dataGrain ?? 'one row per record',
            maps: tableMaps,
            fields,
            entities,
            capabilities: 'auto',
        };
    }

    return {
        domain: aiResponse.domain ?? 'unknown',
        description: aiResponse.description ?? 'Data schema',
        defaults,
        archetypes,
        patterns,
        tables,
    };
}

// ============================================================================
// No-AI Fallback
// ============================================================================

function pathToLabel(path: string): string {
    const leaf = path.split('.').pop() ?? path;
    return leaf
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase());
}

export function applyDefaults(structure: PreCompressedStructure): CompressedSchema {
    const defaults = extractDefaults(structure);

    // Build archetypes with default descriptions
    const archetypes: Record<string, Archetype> = {};
    for (const [name, detected] of structure.archetypes) {
        const fields: Record<string, ArchetypeField> = {};
        for (const [fieldName, shape] of detected.fields) {
            fields[fieldName] = {
                type: shape.type,
                role: shape.role,
                description: pathToLabel(fieldName),
                ...(shape.aggregation !== 'none' && { aggregation: shape.aggregation }),
                ...(shape.unit && { unit: shape.unit }),
                ...(shape.format && { format: shape.format }),
            };
        }
        archetypes[name] = {
            description: pathToLabel(name),
            fields,
        };
    }

    // Build maps
    const allMaps: SchemaMap[] = [];
    for (const [path, detected] of structure.maps) {
        if (detected.archetypeName) {
            allMaps.push({
                path,
                description: pathToLabel(path.split('.').pop() ?? path),
                keys: detected.keys,
                valueArchetype: detected.archetypeName,
            });
        }
    }

    const patterns = buildPatterns(structure);

    const tables: Record<string, CompressedTable> = {};

    for (const [tableName, uniqueFields] of structure.uniqueFields) {
        // All maps belong to the table
        const tableMaps = allMaps;

        const fields = uniqueFields.map(f =>
            buildCompressedField(f, defaults, pathToLabel(f.path))
        );

        const entities = buildEntities(tableName, uniqueFields, archetypes, tableMaps);

        tables[tableName] = {
            description: pathToLabel(tableName),
            dataGrain: 'one row per record',
            maps: tableMaps,
            fields,
            entities,
            capabilities: 'auto',
        };
    }

    return {
        domain: 'unknown',
        description: 'Data schema',
        defaults,
        archetypes,
        patterns,
        tables,
    };
}