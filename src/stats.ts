/**
 * SmartSchema v2 - Statistics
 *
 * Analyzes data structure and infers semantic roles.
 *
 * IMPROVEMENTS:
 * - Cardinality tracking for better role inference
 * - Value pattern detection (Unix timestamps, boolean strings, etc.)
 * - Smarter role scoring based on data characteristics
 */

import { createCompoundSchema } from 'genson-js';
import { inferType } from '@jsonhero/json-infer-types';
import type {
    StatsField,
    StatsTableSchema,
    StatsMultiTableSchema,
    FieldType,
    FieldRole,
    FieldFormat,
    AggregationType,
} from './types.js';
import { DATE_FORMATS } from './constants.js';

// ============================================================================
// Types
// ============================================================================

interface GensonSchema {
    type: string | string[];
    properties?: Record<string, GensonSchema>;
    items?: GensonSchema;
    required?: string[];
}

// ============================================================================
// Value Patterns (NEW)
// ============================================================================

interface ValuePattern {
    name: string;
    test: (samples: unknown[]) => boolean;
    type?: FieldType;
    format?: FieldFormat;
    role?: FieldRole;
}

const VALUE_PATTERNS: ValuePattern[] = [
    // Unix timestamp (seconds since 1970) - years ~2001 to ~2033
    {
        name: 'timestamp_unix',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 3) return false;
            return nums.every(n => Number.isInteger(n) && n > 1_000_000_000 && n < 2_000_000_000);
        },
        type: 'date',
        role: 'time',
    },
    // Unix timestamp (milliseconds)
    {
        name: 'timestamp_ms',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 3) return false;
            return nums.every(n => Number.isInteger(n) && n > 1_000_000_000_000 && n < 2_000_000_000_000);
        },
        type: 'date',
        role: 'time',
    },
    // Boolean integers (0/1 only)
    {
        name: 'boolean_int',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 3) return false;
            const unique = new Set(nums);
            return unique.size <= 2 && nums.every(n => n === 0 || n === 1);
        },
        role: 'dimension',
    },
    // Boolean strings
    {
        name: 'boolean_string',
        test: (samples) => {
            const strs = samples.filter((s): s is string => typeof s === 'string');
            if (strs.length < 3) return false;
            const boolValues = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '1', '0', 'on', 'off']);
            return strs.every(s => boolValues.has(s.toLowerCase()));
        },
        role: 'dimension',
    },
    // HTTP status codes (100-599)
    {
        name: 'http_status',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 3) return false;
            return nums.every(n => Number.isInteger(n) && n >= 100 && n < 600);
        },
        role: 'dimension',
    },
    // Year values (1900-2100)
    {
        name: 'year',
        test: (samples) => {
            const nums = samples.filter((s): s is number => typeof s === 'number');
            if (nums.length < 3) return false;
            return nums.every(n => Number.isInteger(n) && n >= 1900 && n <= 2100);
        },
        role: 'time',
    },
];

function detectValuePattern(samples: unknown[]): ValuePattern | undefined {
    for (const pattern of VALUE_PATTERNS) {
        if (pattern.test(samples)) {
            return pattern;
        }
    }
    return undefined;
}

/**
 * Select diverse, representative sample values for AI context
 * - Unique values only
 * - Prioritizes variety over first-seen
 * - Truncates long strings
 * - Max count limited
 */
function selectDiverseSamples(samples: unknown[], maxCount: number): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const sample of samples) {
        if (result.length >= maxCount) break;

        // Create a key for deduplication
        const key = typeof sample === 'object'
            ? JSON.stringify(sample)
            : String(sample);

        if (seen.has(key)) continue;
        seen.add(key);

        // Truncate long strings for prompt efficiency
        if (typeof sample === 'string' && sample.length > 50) {
            result.push(sample.slice(0, 47) + '...');
        } else {
            result.push(sample);
        }
    }

    return result;
}

// ============================================================================
// Patterns (Name-based)
// ============================================================================

const PATTERNS = {
    identifier: [
        /\bid\b/i, /\bkey\b/i, /\buuid\b/i, /\bguid\b/i,
        /\bsku\b/i, /\bslug\b/i, /_id$/i, /Id$/,
    ],
    time: [
        /\bdate\b/i, /\btime\b/i, /\btimestamp\b/i,
        /\bcreated\b/i, /\bupdated\b/i, /_at$/i, /At$/,
    ],
    measure: [
        /\bcount\b/i, /\btotal\b/i, /\bsum\b/i, /\bamount\b/i,
        /\bprice\b/i, /\bcost\b/i, /\bscore\b/i, /\brating\b/i,
        /\bquantity\b/i, /\bpercent/i, /\bratio\b/i,
        /\bavg\b/i, /\baverage\b/i, /\bmin\b/i, /\bmax\b/i,
        /\btokens?\b/i, /\bwords?\b/i, /\bconfidence\b/i,
        /\bweight\b/i, /\bheight\b/i, /\bwidth\b/i,
        /\brevenue\b/i, /\bprofit\b/i, /\bbalance\b/i,
    ],
    text: [
        /\bdescription\b/i, /\btext\b/i, /\bcontent\b/i,
        /\bbody\b/i, /\bmessage\b/i, /\bcomment\b/i,
        /\bsummary\b/i, /\bquote\b/i, /\bcontext\b/i,
        /\breason\b/i, /\bexplanation\b/i,
    ],
    avgAggregation: [
        /\bavg\b/i, /\baverage\b/i, /\brate\b/i, /\bratio\b/i,
        /\bpercent/i, /\bscore\b/i, /\bconfidence\b/i, /\brating\b/i,
    ],
} as const;

const UNIT_PATTERNS: Array<{ pattern: RegExp; unit: string }> = [
    { pattern: /(cost|price|amount|revenue|profit|usd|dollar)/i, unit: 'USD' },
    { pattern: /(percent|pct|ratio)/i, unit: 'percent' },
    { pattern: /(tokens?)/i, unit: 'tokens' },
    { pattern: /(words?)/i, unit: 'words' },
    { pattern: /(bytes?|size)/i, unit: 'bytes' },
    { pattern: /(seconds?|secs?)/i, unit: 'seconds' },
    { pattern: /(minutes?|mins?)/i, unit: 'minutes' },
    { pattern: /(hours?|hrs?)/i, unit: 'hours' },
    { pattern: /(count|quantity|instances?)/i, unit: 'count' },
];

// ============================================================================
// Role Inference (IMPROVED with cardinality)
// ============================================================================

function inferRole(
    path: string,
    type: FieldType,
    format: FieldFormat | undefined,
    cardinality: number | undefined,
    sampleSize: number | undefined,
    valuePatternRole: FieldRole | undefined
): FieldRole {
    const leaf = path.split('.').pop() ?? path;

    // 0. Value pattern detection takes precedence for specific patterns
    if (valuePatternRole) {
        return valuePatternRole;
    }

    // 1. Identifiers (name-based)
    for (const p of PATTERNS.identifier) {
        if (p.test(leaf)) return 'identifier';
    }

    // 2. Time fields (name-based)
    for (const p of PATTERNS.time) {
        if (p.test(leaf)) return 'time';
    }
    if (format === 'datetime' || format === 'date') return 'time';
    if (type === 'date') return 'time';

    // 3. Format-based
    if (format === 'url' || format === 'email') return 'dimension';
    if (format === 'uuid') return 'identifier';

    // 4. NUMERIC: Check name patterns FIRST, then use cardinality as tiebreaker
    if (type === 'int' || type === 'number') {
        // Check if name suggests it's a measure (takes precedence)
        for (const p of PATTERNS.measure) {
            if (p.test(leaf)) return 'measure';
        }

        // Use cardinality to distinguish dimension vs identifier for unnamed numerics
        if (cardinality !== undefined && sampleSize !== undefined && sampleSize >= 5) {
            // All unique values = likely identifier
            if (cardinality === sampleSize && sampleSize > 3) {
                return 'identifier';
            }
            // Very low cardinality (≤10 unique values) = likely dimension (enum-like)
            if (cardinality <= 10) {
                return 'dimension';
            }
            // Low cardinality relative to sample size = likely dimension
            if (cardinality <= 20 && sampleSize >= 50) {
                return 'dimension';
            }
        }
        // Default for numeric: measure
        return 'measure';
    }

    // 5. String → text or dimension (with cardinality check)
    if (type === 'string') {
        // Check for text patterns first
        for (const p of PATTERNS.text) {
            if (p.test(leaf)) return 'text';
        }
        // High cardinality + all unique = likely identifier
        if (cardinality !== undefined && sampleSize !== undefined && sampleSize >= 5) {
            if (cardinality === sampleSize) {
                return 'identifier';
            }
        }
        return 'dimension';
    }

    // 6. Boolean → dimension
    if (type === 'boolean') return 'dimension';

    // 7. Everything else
    return 'metadata';
}

function inferAggregation(role: FieldRole, path: string): AggregationType {
    if (role !== 'measure') return 'none';

    const leaf = path.split('.').pop() ?? path;
    for (const p of PATTERNS.avgAggregation) {
        if (p.test(leaf)) return 'avg';
    }
    return 'sum';
}

function inferUnit(path: string): string | undefined {
    const leaf = path.split('.').pop() ?? path;
    for (const { pattern, unit } of UNIT_PATTERNS) {
        if (pattern.test(leaf)) return unit;
    }
    return undefined;
}

// ============================================================================
// Format Detection
// ============================================================================

function detectFormat(samples: unknown[]): FieldFormat | undefined {
    const counts = new Map<string, number>();
    let total = 0;

    for (const sample of samples) {
        if (typeof sample !== 'string' || !sample.trim()) continue;
        total++;

        const inferred = inferType(sample);
        if (inferred.name === 'string' && 'format' in inferred) {
            const fmt = String(inferred.format);
            const mapped: Record<string, FieldFormat> = {
                uri: 'url', email: 'email', uuid: 'uuid',
                datetime: 'datetime', 'date-time': 'datetime',
                date: 'date', time: 'time',
            };
            if (mapped[fmt]) {
                counts.set(mapped[fmt], (counts.get(mapped[fmt]) ?? 0) + 1);
            }
        }
    }

    if (total === 0) return undefined;

    const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
    if (sorted[0] && sorted[0][1] / total >= 0.8) {
        return sorted[0][0] as FieldFormat;
    }
    return undefined;
}

// ============================================================================
// Schema Conversion
// ============================================================================

function mapType(gensonType: string | undefined): FieldType {
    const map: Record<string, FieldType> = {
        string: 'string',
        integer: 'int',
        number: 'number',
        boolean: 'boolean',
        object: 'object',
        array: 'array',
        null: 'null',
    };
    return map[gensonType ?? 'string'] ?? 'string';
}

function collectSamples(
    data: unknown,
    path: string = '',
    samples: Map<string, unknown[]> = new Map()
): Map<string, unknown[]> {
    if (data === null || data === undefined) return samples;

    if (Array.isArray(data)) {
        for (const item of data) {
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                collectSamples(item, path ? `${path}.[]` : '[]', samples);
            }
        }
        return samples;
    }

    if (typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
            const fieldPath = path ? `${path}.${key}` : key;
            const existing = samples.get(fieldPath) ?? [];
            existing.push(value);
            samples.set(fieldPath, existing);

            if (value !== null && typeof value === 'object') {
                collectSamples(value, fieldPath, samples);
            }
        }
    }

    return samples;
}

function schemaToField(
    schema: GensonSchema,
    path: string,
    samples: unknown[],
    nullable: boolean,
    allSamples: Map<string, unknown[]>
): StatsField {
    const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    let type = mapType(schemaType);

    const format = detectFormat(samples);

    // Promote string to date if format indicates it
    if (type === 'string' && format && DATE_FORMATS.has(format)) {
        type = 'date';
    }

    // NEW: Calculate cardinality
    const nonNullSamples = samples.filter(s => s != null);
    const cardinality = new Set(nonNullSamples.map(s =>
        typeof s === 'object' ? JSON.stringify(s) : String(s)
    )).size;
    const sampleSize = nonNullSamples.length;

    // NEW: Detect value patterns (timestamps, boolean ints, etc.)
    const valuePattern = detectValuePattern(nonNullSamples);
    if (valuePattern?.type) {
        type = valuePattern.type;
    }

    // IMPROVED: Pass cardinality and value pattern to role inference
    const role = inferRole(path, type, format, cardinality, sampleSize, valuePattern?.role);
    const aggregation = inferAggregation(role, path);
    const unit = role === 'measure' ? inferUnit(path) : undefined;

    // Collect diverse sample values for AI enrichment (max 5, unique, non-null)
    const diverseSamples = selectDiverseSamples(nonNullSamples, 5);

    const field: StatsField = {
        path,
        type,
        nullable,
        role,
        aggregation,
        cardinality,
        sampleSize,
        samples: diverseSamples,
        ...(format && { format }),
        ...(unit && { unit }),
    };

    // Handle arrays
    if (type === 'array' && schema.items) {
        const itemType = Array.isArray(schema.items.type)
            ? schema.items.type[0]
            : schema.items.type;
        field.itemType = mapType(itemType);

        if (schema.items.type === 'object' && schema.items.properties) {
            field.itemFields = [];
            for (const [key, propSchema] of Object.entries(schema.items.properties)) {
                const itemPath = `${path}.[].${key}`;
                const itemSamples = allSamples.get(itemPath) ?? [];
                const isRequired = schema.items.required?.includes(key) ?? false;
                field.itemFields.push(
                    schemaToField(propSchema, key, itemSamples, !isRequired, allSamples)
                );
            }
        }
    }

    return field;
}

function gensonToFields(
    schema: GensonSchema,
    samples: Map<string, unknown[]>,
    path: string = ''
): StatsField[] {
    const fields: StatsField[] = [];

    if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            const fieldPath = path ? `${path}.${key}` : key;
            const fieldSamples = samples.get(fieldPath) ?? [];
            const isRequired = schema.required?.includes(key) ?? false;
            const nullable = !isRequired || fieldSamples.some(s => s === null);

            fields.push(schemaToField(propSchema, fieldPath, fieldSamples, nullable, samples));

            // Recurse into nested objects
            if (propSchema.type === 'object' && propSchema.properties) {
                fields.push(...gensonToFields(propSchema, samples, fieldPath));
            }

            // Recurse into array items (THIS WAS MISSING!)
            if (propSchema.type === 'array' && propSchema.items) {
                const itemSchema = propSchema.items;
                if (itemSchema.type === 'object' && itemSchema.properties) {
                    fields.push(...gensonToFields(itemSchema, samples, `${fieldPath}.[]`));
                }
            }
        }
    }

    return fields;
}

// ============================================================================
// Main Export
// ============================================================================

export function computeStats(data: unknown): StatsMultiTableSchema {
    const tables: Record<string, StatsTableSchema> = {};

    if (Array.isArray(data)) {
        const schema = createCompoundSchema(data) as GensonSchema;
        const samples = new Map<string, unknown[]>();
        for (const item of data) {
            collectSamples(item, '', samples);
        }
        tables.root = { fields: gensonToFields(schema, samples) };
    } else if (typeof data === 'object' && data !== null) {
        const schema = createCompoundSchema([data]) as GensonSchema;
        const samples = collectSamples(data);
        tables.root = { fields: gensonToFields(schema, samples) };
    }

    return { tables };
}