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
 * // Single table (array of records)
 * const schema = await generate([{...}, {...}]);
 *
 * // Multi-table input
 * const schema = await generate({
 *   orders: [{...}, {...}],
 *   products: [{...}, {...}],
 *   customers: [{...}, {...}]
 * });
 *
 * // With AI enrichment
 * const schema = await generate(data, { apiKey: '...' });
 * ```
 */

import { computeStats } from './stats.js';
import { buildStructure } from './structure.js';
import { extractCapabilities, detectEntities, inferGrain } from './capabilities.js';
import { enrichSchema, enrichSchemaSync } from './enrich.js';
import type { SmartSchema, StatsField } from './types.js';

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

/** Detected shape of input data */
export type InputShape = 'array' | 'multi-table' | 'single-record';

/** Relationship between tables */
export interface Relationship {
    from: { table: string; field: string };
    to: { table: string; field: string };
    type: 'one-to-one' | 'one-to-many' | 'many-to-one';
}

/** Result for multi-table schemas */
export interface MultiTableSchema {
    type: 'multi-table';
    tables: Record<string, SmartSchema>;
    relationships: Relationship[];
}

/** Union type for generate() return value */
export type GenerateResult = SmartSchema | MultiTableSchema;

// ============================================================================
// Input Shape Detection
// ============================================================================

/** Common wrapper keys that contain the actual data */
const WRAPPER_KEYS = ['tables', 'data', 'datasets', 'entities', 'records'];

/**
 * Check if an object's values are all arrays of objects (multi-table structure)
 */
function isMultiTableObject(obj: Record<string, unknown>): boolean {
    const dataEntries = Object.entries(obj).filter(([key]) => !key.startsWith('_'));

    if (dataEntries.length < 1) return false;

    const allArraysOfObjects = dataEntries.every(([, value]) =>
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === 'object' &&
        value[0] !== null &&
        !Array.isArray(value[0])
    );

    return allArraysOfObjects && dataEntries.length > 1;
}

/**
 * Try to unwrap common wrapper patterns like { tables: {...} } or { data: {...} }
 * Returns the unwrapped object if found, otherwise null
 */
function tryUnwrap(input: Record<string, unknown>): Record<string, unknown> | null {
    for (const wrapperKey of WRAPPER_KEYS) {
        const wrapped = input[wrapperKey];
        if (
            wrapped &&
            typeof wrapped === 'object' &&
            !Array.isArray(wrapped) &&
            isMultiTableObject(wrapped as Record<string, unknown>)
        ) {
            return wrapped as Record<string, unknown>;
        }
    }
    return null;
}

/**
 * Detect the shape of input data
 *
 * @example
 * detectInputShape([{...}, {...}])                    // 'array'
 * detectInputShape({ orders: [...], products: [...] })  // 'multi-table'
 * detectInputShape({ tables: { orders: [...], ... } })  // 'multi-table' (unwrapped)
 * detectInputShape({ user: {...}, ... })              // 'single-record'
 */
export function detectInputShape(input: unknown): InputShape {
    if (Array.isArray(input)) {
        return 'array';
    }

    if (typeof input === 'object' && input !== null) {
        const inputObj = input as Record<string, unknown>;

        // First, check for wrapper patterns like { tables: {...} }
        const unwrapped = tryUnwrap(inputObj);
        if (unwrapped) {
            return 'multi-table';
        }

        // Check direct multi-table structure
        if (isMultiTableObject(inputObj)) {
            return 'multi-table';
        }

        return 'single-record';
    }

    throw new Error('Invalid input: expected array or object');
}

/**
 * Normalize input to standard format for processing
 */
function normalizeInput(input: unknown): {
    shape: InputShape;
    tables: Record<string, unknown[]>;
    metadata?: Record<string, unknown>;
} {
    const shape = detectInputShape(input);

    switch (shape) {
        case 'array':
            return {
                shape,
                tables: { root: input as unknown[] }
            };

        case 'multi-table': {
            const inputObj = input as Record<string, unknown>;

            // Try to unwrap first
            const unwrapped = tryUnwrap(inputObj);
            const dataSource = unwrapped ?? inputObj;

            const tables: Record<string, unknown[]> = {};
            const metadata: Record<string, unknown> = {};

            // Collect metadata from original input (not unwrapped)
            for (const [key, value] of Object.entries(inputObj)) {
                if (key.startsWith('_')) {
                    metadata[key] = value;
                }
            }

            // Collect tables from data source
            for (const [key, value] of Object.entries(dataSource)) {
                if (!key.startsWith('_') && Array.isArray(value)) {
                    tables[key] = value;
                }
            }

            return { shape, tables, metadata };
        }

        case 'single-record':
            return {
                shape,
                tables: { root: [input] }
            };
    }
}

/**
 * Detect foreign key relationships between tables
 */
function detectRelationships(
    tableSchemas: Record<string, SmartSchema>
): Relationship[] {
    const relationships: Relationship[] = [];
    const tableNames = Object.keys(tableSchemas);

    // Build a set of all ID fields per table for matching
    const tableIdFields = new Map<string, Set<string>>();
    for (const [tableName, schema] of Object.entries(tableSchemas)) {
        const idFields = new Set<string>();
        for (const idPath of schema.capabilities.identifiers) {
            const leaf = idPath.split('.').pop() ?? idPath;
            idFields.add(leaf.toLowerCase());
        }
        tableIdFields.set(tableName, idFields);
    }

    // Look for foreign key patterns in each table
    for (const [tableName, schema] of Object.entries(tableSchemas)) {
        const allFields = [
            ...schema.capabilities.dimensions,
            ...schema.capabilities.identifiers,
        ];

        for (const fieldPath of allFields) {
            const leaf = fieldPath.split('.').pop() ?? fieldPath;

            // Check for *_id pattern
            const match = leaf.match(/^(.+?)_id$/i);
            if (!match) continue;

            const potentialEntity = match[1].toLowerCase();

            // Look for matching table (singular or plural forms)
            const matchingTable = tableNames.find(t => {
                const tLower = t.toLowerCase();
                return (
                    tLower === potentialEntity ||
                    tLower === potentialEntity + 's' ||
                    tLower === potentialEntity + 'es' ||
                    tLower.replace(/ies$/, 'y') === potentialEntity ||
                    tLower.replace(/s$/, '') === potentialEntity
                );
            });

            if (matchingTable && matchingTable !== tableName) {
                // Verify the target table has this ID field
                const targetIds = tableIdFields.get(matchingTable);
                const hasMatchingId = targetIds?.has(leaf.toLowerCase()) ||
                    targetIds?.has(`${potentialEntity}_id`);

                relationships.push({
                    from: { table: tableName, field: fieldPath },
                    to: {
                        table: matchingTable,
                        field: hasMatchingId ? leaf : `${potentialEntity}_id`
                    },
                    type: 'many-to-one'
                });
            }
        }
    }

    return relationships;
}

// ============================================================================
// Single Table Processing
// ============================================================================

/**
 * Generate schema for a single table
 */
async function generateTableSchema(
    data: unknown[],
    tableName: string,
    options: GenerateOptions = {}
): Promise<SmartSchema> {
    const verbose = options.verbose ?? false;

    // 1. Compute statistics and infer types/roles
    const stats = computeStats(data);
    const fields = stats.tables.root?.fields ?? [];
    if (verbose) console.log(`smart-schema: [${tableName}] ${fields.length} fields detected`);

    // 2. Build structure with $defs and map detection
    const samples = Array.isArray(data) ? data : [data];
    const { root, $defs } = buildStructure(stats.tables.root ?? { fields: [] }, {
        detectMaps: true,
        samples,
    });

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
// Main Export
// ============================================================================

/**
 * Generate a semantic schema from JSON data.
 *
 * Automatically detects input shape:
 * - Array of objects → single table schema
 * - Object with array values → multi-table schema
 * - Single object → wraps in array, single table schema
 *
 * @param data - Array of objects, multi-table object, or single object
 * @param options - Configuration options
 * @returns Semantic schema (SmartSchema) or multi-table result (MultiTableSchema)
 */
export async function generate(
    data: unknown,
    options: GenerateOptions = {}
): Promise<GenerateResult> {
    const verbose = options.verbose ?? false;

    // 1. Detect input shape and normalize
    const { shape, tables, metadata } = normalizeInput(data);

    if (verbose) {
        console.log(`smart-schema: Detected input shape: ${shape}`);
        console.log(`smart-schema: Tables found: ${Object.keys(tables).join(', ')}`);
    }

    // 2. Single table path (original behavior)
    if (shape === 'array' || shape === 'single-record') {
        return generateTableSchema(tables.root, 'root', options);
    }

    // 3. Multi-table path
    const tableSchemas: Record<string, SmartSchema> = {};

    for (const [tableName, records] of Object.entries(tables)) {
        if (verbose) {
            console.log(`smart-schema: Processing table "${tableName}" (${records.length} records)`);
        }

        tableSchemas[tableName] = await generateTableSchema(records, tableName, options);
    }

    // 4. Detect cross-table relationships
    const relationships = detectRelationships(tableSchemas);

    if (verbose && relationships.length > 0) {
        console.log(`smart-schema: Detected ${relationships.length} relationships`);
        for (const rel of relationships) {
            console.log(`  - ${rel.from.table}.${rel.from.field} → ${rel.to.table}.${rel.to.field} (${rel.type})`);
        }
    }

    return {
        type: 'multi-table',
        tables: tableSchemas,
        relationships,
    };
}

/**
 * Type guard to check if result is multi-table
 */
export function isMultiTableSchema(result: GenerateResult): result is MultiTableSchema {
    return 'type' in result && result.type === 'multi-table';
}

/**
 * Type guard to check if result is single-table
 */
export function isSingleTableSchema(result: GenerateResult): result is SmartSchema {
    return !('type' in result) || result.type !== 'multi-table';
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
export { buildStructure, type BuildStructureOptions } from './structure.js';
export { extractCapabilities, detectEntities, inferGrain } from './capabilities.js';
export { enrichSchema, enrichSchemaSync } from './enrich.js';