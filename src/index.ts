/**
 * SmartSchema
 *
 * Semantic schema generation for LLM understanding.
 *
 * Usage:
 *   const schema = await analyze(data, { apiKey: process.env.ANTHROPIC_API_KEY });
 */

import { LIMITS } from './constants.js';
import { computeStats } from './stats.js';
import { detectStructure } from './structure.js';
import { extractCapabilities, detectEntities } from './capabilities.js';
import { enrichWithAI, applyDefaults } from './enrich.js';
import type { SmartSchema } from './types.js';

// ============================================================================
// Options
// ============================================================================

export interface AnalyzeOptions {
    /** Anthropic API key. Required unless skipAI is true. */
    apiKey: string;
    /** Skip AI enrichment, use defaults. Default: false */
    skipAI?: boolean;
    /** Log progress to console. Default: false */
    verbose?: boolean;
}

// ============================================================================
// Main
// ============================================================================

export async function analyze(data: unknown, options: AnalyzeOptions): Promise<SmartSchema> {
    const { apiKey, skipAI = false, verbose = false } = options;
    const log = (msg: string) => verbose && console.log(`[smart-schema] ${msg}`);

    // Validate input
    if (data === null || data === undefined) {
        throw new Error('Input cannot be null or undefined');
    }
    if (typeof data !== 'object') {
        throw new Error('Input must be an object or array');
    }
    if (Array.isArray(data) && data.length === 0) {
        throw new Error('Input array cannot be empty');
    }
    if (!Array.isArray(data) && Object.keys(data).length === 0) {
        throw new Error('Input object cannot be empty');
    }
    if (!skipAI && !apiKey) {
        throw new Error('apiKey is required when skipAI is false');
    }

    log('Analyzing data...');

    // Step 1: Compute field statistics
    const stats = computeStats(data);
    const tableName = Object.keys(stats.tables)[0] ?? 'root';
    const fields = stats.tables[tableName]?.fields ?? [];

    log(`Found ${fields.length} fields`);

    // Step 2: Detect structure (maps, $defs)
    const structures = detectStructure(stats);
    const structure = structures.get(tableName);

    if (!structure) {
        throw new Error('Failed to detect structure');
    }

    log(`Structure: ${structure.stats.defCount} $defs, ${structure.stats.mapCount} maps`);

    // Step 3: Extract capabilities
    const capabilities = extractCapabilities(fields, structure.maps);
    const entities = detectEntities(fields, structure.maps);

    log(`Capabilities: ${capabilities.measures.length} measures, ${capabilities.dimensions.length} dimensions`);

    // Step 4: Check limits (warn only)
    const tableCount = Object.keys(stats.tables).length;
    if (verbose) {
        if (tableCount > LIMITS.maxTables) {
            console.warn(`[smart-schema] Large dataset: ${tableCount} tables`);
        }
        if (fields.length > LIMITS.maxFields) {
            console.warn(`[smart-schema] Large schema: ${fields.length} fields`);
        }
    }

    // Step 5: Enrich
    if (skipAI) {
        log('Skipping AI, using defaults');
        return applyDefaults(structure.defs, structure.root, capabilities, entities);
    }

    log('Enriching with AI...');

    try {
        const schema = await enrichWithAI(
            structure.defs,
            structure.root,
            capabilities,
            entities,
            apiKey,
            verbose
        );
        log('Done');
        return schema;
    } catch (error) {
        // AI failed, return schema with defaults
        if (verbose) {
            const message = error instanceof Error ? error.message : 'AI enrichment failed';
            console.warn(`[smart-schema] ${message}, using defaults`);
        }
        return applyDefaults(structure.defs, structure.root, capabilities, entities);
    }
}

// ============================================================================
// Exports
// ============================================================================

export type { SmartSchema, Capabilities, Entity } from './types.js';