/**
 * SmartSchema v2 - Main Entry Point
 *
 * Usage:
 *   import { analyze } from 'smart-schema';
 *   const schema = await analyze(data, { apiKey: process.env.ANTHROPIC_API_KEY });
 */

import { LIMITS } from './constants.js';
import { computeStats } from './stats.js';
import { detectStructure } from './structure.js';
import { extractCapabilities, detectEntities } from './capabilities.js';
import { enrichWithAI, applyDefaults } from './enrich.js';
import type { SmartSchema } from './types.js';
import {
    LimitExceededError,
    AIEnrichmentError,
    InvalidInputError,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface AnalyzeOptions {
    /** Anthropic API key. Required unless skipAI is true. */
    readonly apiKey: string;

    /** Skip AI enrichment, use defaults. Default: false */
    readonly skipAI?: boolean;

    /** Enable console logging. Default: false */
    readonly verbose?: boolean;
}

// ============================================================================
// Validation
// ============================================================================

function validateLimits(
    fieldCount: number,
    tableCount: number,
    verbose: boolean
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

    if (verbose && fieldCount > LIMITS.maxFieldsWarningThreshold) {
        console.warn(
            `[smart-schema] Large schema (${fieldCount} fields) - AI enrichment may be incomplete`
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
        skipAI = false,
        verbose = false,
    } = options;

    const log = (msg: string) => verbose && console.log(`[smart-schema] ${msg}`);

    // Input validation
    if (data === null || data === undefined) {
        throw new InvalidInputError('Input cannot be null or undefined', 'invalid');
    }

    if (typeof data !== 'object') {
        throw new InvalidInputError('Input must be an object or array', 'primitive');
    }

    if (Array.isArray(data) && data.length === 0) {
        throw new InvalidInputError('Input array cannot be empty', 'empty');
    }

    if (!Array.isArray(data) && Object.keys(data).length === 0) {
        throw new InvalidInputError('Input object cannot be empty', 'empty');
    }

    if (!skipAI && !apiKey) {
        throw new Error('apiKey is required when skipAI is false');
    }

    log('Starting schema analysis...');

    // Step 1: Compute statistics
    const stats = computeStats(data);

    const tableCount = Object.keys(stats.tables).length;
    const fieldCount = Object.values(stats.tables).reduce(
        (sum, t) => sum + t.fields.length,
        0
    );
    log(`Found ${tableCount} table(s) with ${fieldCount} total fields`);

    // Step 2: Detect structure (archetypes, maps, tree)
    const structures = detectStructure(stats);

    const tableName = Object.keys(stats.tables)[0] ?? 'root';
    const structure = structures.get(tableName);

    if (!structure) {
        throw new Error('Failed to detect structure');
    }

    log(
        `Structure: ${structure.stats.defCount} $defs, ` +
        `${structure.stats.mapCount} maps, ` +
        `${structure.stats.reductionPercent}% reduction`
    );

    // Step 3: Extract capabilities
    const tableFields = stats.tables[tableName]?.fields ?? [];
    const capabilities = extractCapabilities(tableFields, structure.maps);
    const entities = detectEntities(tableFields, structure.maps);

    log(
        `Capabilities: ${capabilities.measures.length} measures, ` +
        `${capabilities.dimensions.length} dimensions, ` +
        `${capabilities.identifiers.length} identifiers`
    );

    // Step 4: Enrich (AI or defaults)
    const shouldEnrich = !skipAI && Boolean(apiKey);

    if (shouldEnrich) {
        validateLimits(fieldCount, tableCount, verbose);
    }

    let schema: SmartSchema;

    if (!shouldEnrich) {
        log('Skipping AI enrichment, applying defaults');
        schema = applyDefaults(
            structure.defs,
            structure.root,
            capabilities,
            entities
        );
    } else {
        log('Starting AI enrichment...');

        try {
            schema = await enrichWithAI(
                structure.defs,
                structure.root,
                capabilities,
                entities,
                apiKey,
                { verbose }
            );

            log('AI enrichment complete');
        } catch (error) {
            const partialSchema = applyDefaults(
                structure.defs,
                structure.root,
                capabilities,
                entities
            );

            const message =
                error instanceof Error ? error.message : 'AI enrichment failed';

            if (verbose) {
                console.error(`[smart-schema] AI enrichment failed: ${message}`);
            }

            throw new AIEnrichmentError(message, partialSchema);
        }
    }

    log('Schema analysis complete');

    return schema;
}

// ============================================================================
// Re-exports
// ============================================================================

export type { SmartSchema, Capabilities, Entity } from './types.js';
export {
    InvalidInputError,
    AIEnrichmentError,
    LimitExceededError,
} from './types.js';
export type { StructureResult, DetectedMap } from './structure.js';