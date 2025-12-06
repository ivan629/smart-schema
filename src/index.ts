/**
 * SmartSchema v2
 *
 * Infer semantic JSON schemas for LLM understanding.
 * Structure + Meaning + Roles + Relationships.
 *
 * @example
 * ```typescript
 * import { generate } from 'smart-schema';
 *
 * // With AI enrichment
 * const schema = await generate(data, { apiKey: '...' });
 *
 * // Without AI (sync)
 * const schema = await generate(data);
 * ```
 */

import { computeStats } from './stats.js';
import { buildStructure } from './structure.js';
import { extractCapabilities, detectEntities, inferGrain } from './capabilities.js';
import { enrichSchema, enrichSchemaSync } from './enrich.js';
import type { SmartSchema } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface GenerateOptions {
    /** Anthropic API key for AI enrichment */
    apiKey?: string;
    /** Enable AI enrichment (default: true if apiKey provided) */
    enrich?: boolean;
    /** Log progress to console */
    verbose?: boolean;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Generate a semantic schema from JSON data.
 *
 * @param data - Array of objects or single object
 * @param options - Configuration options
 * @returns Semantic schema with roles, capabilities, and entities
 */
export async function generate(
    data: unknown,
    options: GenerateOptions = {}
): Promise<SmartSchema> {
    const verbose = options.verbose ?? false;

    // 1. Compute statistics and infer types/roles
    const stats = computeStats(data);
    const fields = stats.tables.root?.fields ?? [];
    if (verbose) console.log(`smart-schema: ${fields.length} fields detected`);

    // 2. Build structure with $defs
    const { root, $defs } = buildStructure(stats.tables.root ?? { fields: [] });

    // 3. Extract capabilities
    const capabilities = extractCapabilities(fields);

    // 4. Detect entities
    const entities = detectEntities(fields);

    // 5. Infer grain
    const grain = inferGrain(fields, entities);

    // 6. Assemble base schema
    let schema: SmartSchema = {
        domain: 'general',
        description: 'Data schema',
        grain,
        ...(Object.keys($defs).length > 0 && { $defs }),
        root,
        capabilities,
        ...(entities.length > 0 && { entities }),
    };

    // 7. Enrich with AI if apiKey provided
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (options.enrich !== false && apiKey) {
        schema = await enrichSchema(schema, {
            apiKey,
            verbose,
            statsFields: fields,
        });
    } else {
        schema = enrichSchemaSync(schema);
    }

    return schema;
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
    SmartSchema,
    NodeDef,
    FieldNode,
    ObjectNode,
    ArrayNode,
    MapNode,
    RefNode,
    TypeDef,
    Capabilities,
    Entity,
    FieldType,
    FieldRole,
    FieldFormat,
    AggregationType,
    StatsField,
} from './types.js';

export { computeStats } from './stats.js';
export { buildStructure } from './structure.js';
export { extractCapabilities, detectEntities, inferGrain } from './capabilities.js';
export { enrichSchema, enrichSchemaSync } from './enrich.js';