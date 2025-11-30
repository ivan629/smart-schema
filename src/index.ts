/**
 * SmartSchema v2 - Main Entry Point
 *
 * Usage:
 *   import { analyze } from 'smart-schema';
 *   const schema = await analyze(data, { apiKey: process.env.ANTHROPIC_API_KEY });
 */

import { LIMITS } from './constants.js';
import { computeStats, type ComputeStatsOptions } from './stats.js';
import { detectStructure } from './structure.js';
import { extractCapabilities, detectEntities } from './capabilities.js';
import { enrichWithAI, applyDefaults, type EnrichOptions } from './enrich.js';
import type { SmartSchema, Logger } from './types.js';
import { consoleLogger, LimitExceededError, AIEnrichmentError } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface AnalyzeOptions {
    /** Anthropic API key. Required unless skipAI is true. */
    readonly apiKey: string;

    /** Max rows to sample per table. Default: 10000 */
    readonly maxRows?: number;

    /** Max nesting depth to traverse. Default: 50 */
    readonly maxDepth?: number;

    /** Skip AI enrichment, use defaults. Default: false */
    readonly skipAI?: boolean;

    /** AI model to use. Default: claude-sonnet-4-5-20250929 */
    readonly model?: string;

    /** AI request timeout in ms. Default: 300000 (5 min) */
    readonly timeout?: number;

    /** Format detection threshold (0-1). Default: 0.9 */
    readonly formatThreshold?: number;

    /** Mixed type threshold (0-1). Default: 0.1 */
    readonly mixedTypeThreshold?: number;

    /** Logger instance. Default: silent */
    readonly logger?: Logger;
}

// ============================================================================
// Validation
// ============================================================================

function validateLimits(
    fieldCount: number,
    tableCount: number,
    logger: Logger
): void {
    if (tableCount > LIMITS.maxTablesForEnrichment) {
        throw new LimitExceededError(
            `Dataset has ${tableCount} tables (max: ${LIMITS.maxTablesForEnrichment})`
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
            `Large schema (${fieldCount} fields) - AI enrichment may be incomplete`
        );
    }
}

// ============================================================================
// Main Export
// ============================================================================

export async function analyze(
    data: unknown,
    options: AnalyzeOptions
): Promise<SmartSchema> {
    const {
        apiKey,
        maxRows,
        maxDepth,
        skipAI = false,
        model,
        timeout,
        formatThreshold,
        mixedTypeThreshold,
        logger = consoleLogger,
    } = options;

    logger.info('Starting schema analysis...');

    // Step 1: Compute statistics
    logger.debug('Computing statistics...');
    const statsOptions: ComputeStatsOptions = {
        ...(maxRows !== undefined && { maxRows }),
        ...(maxDepth !== undefined && { maxDepth }),
        ...(formatThreshold !== undefined && { formatThreshold }),
        ...(mixedTypeThreshold !== undefined && { mixedTypeThreshold }),
    };
    const stats = computeStats(data, statsOptions);

    const tableCount = Object.keys(stats.tables).length;
    const fieldCount = Object.values(stats.tables).reduce(
        (sum, t) => sum + t.fields.length,
        0
    );
    logger.info(`Found ${tableCount} table(s) with ${fieldCount} total fields`);

    // Step 2: Detect structure (archetypes, maps, tree)
    logger.debug('Detecting structure...');
    const structures = detectStructure(stats);

    // For now, we handle single-table (root) case
    // Multi-table support can be added later
    const tableName = Object.keys(stats.tables)[0] ?? 'root';
    const structure = structures.get(tableName);

    if (!structure) {
        throw new Error('Failed to detect structure');
    }

    logger.info(
        `Structure detected: ${structure.stats.defCount} $defs, ` +
        `${structure.stats.mapCount} maps, ` +
        `${structure.stats.reductionPercent}% token reduction`
    );

    // Step 3: Extract capabilities
    logger.debug('Extracting capabilities...');
    const tableFields = stats.tables[tableName]?.fields ?? [];
    const capabilities = extractCapabilities(tableFields, structure.maps);
    const entities = detectEntities(tableFields, structure.maps);

    logger.info(
        `Capabilities: ${capabilities.measures.length} measures, ` +
        `${capabilities.dimensions.length} dimensions, ` +
        `${capabilities.identifiers.length} identifiers`
    );

    // Step 4: Enrich (AI or defaults)
    const shouldEnrich = !skipAI && Boolean(apiKey);

    if (shouldEnrich) {
        validateLimits(fieldCount, tableCount, logger);
    }

    let schema: SmartSchema;

    if (!shouldEnrich) {
        logger.info('Skipping AI enrichment, applying defaults');
        schema = applyDefaults(structure.defs, structure.root, capabilities, entities);
    } else {
        logger.info('Starting AI enrichment...');

        try {
            const enrichOptions: EnrichOptions = {
                logger,
                ...(model !== undefined && { model }),
                ...(timeout !== undefined && { timeout }),
            };

            schema = await enrichWithAI(
                structure.defs,
                structure.root,
                capabilities,
                entities,
                apiKey,
                enrichOptions
            );

            logger.info('AI enrichment complete');
        } catch (error) {
            // Provide partial schema on failure
            const partialSchema = applyDefaults(
                structure.defs,
                structure.root,
                capabilities,
                entities
            );

            const message = error instanceof Error ? error.message : 'AI enrichment failed';
            logger.error(`AI enrichment failed: ${message}`);

            throw new AIEnrichmentError(message, partialSchema);
        }
    }

    logger.info('Schema analysis complete');

    return schema;
}

// ============================================================================
// Re-exports
// ============================================================================

export { consoleLogger, silentLogger } from './types.js';
export type { SmartSchema, Logger } from './types.js';
export { InvalidInputError, AIEnrichmentError, LimitExceededError } from './types.js';