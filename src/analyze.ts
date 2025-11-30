import { LIMITS, THRESHOLDS } from './constants.js';
import { applyDefaults, enrichStructure, type EnrichOptions } from './enrich.js';
import { detectStructure, getStructureStats } from './structure.js';
import type { CompressedSchema } from './compress.js';
import { type ComputeStatsOptions, computeStats } from './stats.js';
import type { AnalyzeOptions, Logger, StatsMultiTableSchema } from './types.js';
import { AIEnrichmentError, consoleLogger } from './types.js';
import { countTotalFields } from './utils.js';

export class LimitExceededError extends Error {
    public readonly name = 'LimitExceededError' as const;
}

interface SchemaMetrics {
    tableCount: number;
    fieldCount: number;
}

function getSchemaMetrics(stats: StatsMultiTableSchema): SchemaMetrics {
    return {
        tableCount: Object.keys(stats.tables).length,
        fieldCount: countTotalFields(stats.tables),
    };
}

function validateSchemaLimits(stats: StatsMultiTableSchema, logger: Logger): void {
    const { tableCount, fieldCount } = getSchemaMetrics(stats);

    if (tableCount > LIMITS.maxTablesForEnrichment) {
        throw new LimitExceededError(
            `Dataset has ${tableCount} tables (max: ${LIMITS.maxTablesForEnrichment}).`
        );
    }

    if (fieldCount > LIMITS.maxFieldsForEnrichment) {
        throw new LimitExceededError(
            `Dataset has ${fieldCount} fields (max: ${LIMITS.maxFieldsForEnrichment}). ` +
            `Consider using skipAI: true or splitting your dataset.`
        );
    }

    if (fieldCount > LIMITS.maxFieldsWarningThreshold) {
        logger.warn(
            `Large schema (${fieldCount} fields) - AI enrichment may be incomplete for some fields`
        );
    }

    logger.debug(`Validated limits: ${tableCount} tables, ${fieldCount} fields`);
}

function shouldPerformAIEnrichment(skipAI: boolean, apiKey: string): boolean {
    return !skipAI && Boolean(apiKey);
}

export async function analyze(data: unknown, options: AnalyzeOptions): Promise<CompressedSchema> {
    const {
        apiKey,
        maxRows = LIMITS.maxRowsToSample,
        maxDepth,
        skipAI = false,
        model,
        logger = consoleLogger,
        timeout,
        formatThreshold = THRESHOLDS.formatDetection,
        mixedTypeThreshold = THRESHOLDS.mixedType,
    } = options;

    logger.info('Starting schema analysis...');
    logger.debug('Computing statistics...');

    const statsOptions: ComputeStatsOptions = {
        maxRows,
        formatThreshold,
        mixedTypeThreshold,
        ...(maxDepth !== undefined && { maxDepth }),
    };

    // Step 1: Compute statistics
    const stats = computeStats(data, statsOptions);
    const { tableCount, fieldCount } = getSchemaMetrics(stats);
    logger.info(`Found ${tableCount} tables with ${fieldCount} total fields`);

    // Step 2: Detect structure patterns (mechanical, free)
    logger.debug('Detecting structure patterns...');
    const structure = detectStructure(stats);

    const structureStats = getStructureStats(structure);
    logger.info(
        `Structure detected: ${structureStats.archetypeCount} archetypes, ` +
        `${structureStats.mapCount} maps, ${structureStats.patternCount} patterns`
    );
    logger.info(
        `Field reduction: ${structureStats.originalFieldCount} → ${structureStats.uniqueFieldCount} ` +
        `(${structureStats.reductionPercent}% reduction for AI)`
    );

    const performAIEnrichment = shouldPerformAIEnrichment(skipAI, apiKey);

    if (performAIEnrichment) {
        validateSchemaLimits(stats, logger);
    }

    // Step 3: Enrich (AI or defaults)
    let schema: CompressedSchema;

    if (!performAIEnrichment) {
        logger.info('Skipping AI enrichment, applying defaults');
        schema = applyDefaults(structure);
    } else {
        logger.info('Starting AI enrichment...');

        try {
            const enrichOptions: EnrichOptions = {
                logger,
                ...(model !== undefined && { model }),
                ...(timeout !== undefined && { timeout }),
            };

            schema = await enrichStructure(structure, apiKey, enrichOptions);
            logger.info('AI enrichment complete');
        } catch (error) {
            if (error instanceof AIEnrichmentError) {
                throw error;
            }

            const partialSchema = applyDefaults(structure);
            const errorMessage = error instanceof Error ? error.message : 'AI enrichment failed';

            logger.error(`AI enrichment failed: ${errorMessage}`);

            const enrichmentError = new AIEnrichmentError(errorMessage, partialSchema);

            if (error instanceof Error) {
                enrichmentError.cause = error;
            }

            throw enrichmentError;
        }
    }

    const compressedFieldCount = Object.values(schema.tables)
        .reduce((sum, table) => sum + table.fields.length, 0);

    logger.info(`Final schema: ${compressedFieldCount} fields`);
    logger.info('Schema analysis complete');

    return schema;
}