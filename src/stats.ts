/**
 * SmartSchema v2 - Statistics
 *
 * Analyzes data structure and infers semantic roles.
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
// Patterns
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
// Role Inference (FIXED: type-safe)
// ============================================================================

function inferRole(path: string, type: FieldType, format?: FieldFormat): FieldRole {
    const leaf = path.split('.').pop() ?? path;

    // 1. Identifiers (any type)
    for (const p of PATTERNS.identifier) {
        if (p.test(leaf)) return 'identifier';
    }

    // 2. Time fields
    for (const p of PATTERNS.time) {
        if (p.test(leaf)) return 'time';
    }
    if (format === 'datetime' || format === 'date') return 'time';
    if (type === 'date') return 'time';

    // 3. Format-based
    if (format === 'url' || format === 'email') return 'dimension';
    if (format === 'uuid') return 'identifier';

    // 4. NUMERIC ONLY → measure (this is the fix)
    if (type === 'int' || type === 'number') {
        return 'measure';
    }

    // 5. String → text or dimension
    if (type === 'string') {
        for (const p of PATTERNS.text) {
            if (p.test(leaf)) return 'text';
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

    const role = inferRole(path, type, format);
    const aggregation = inferAggregation(role, path);
    const unit = role === 'measure' ? inferUnit(path) : undefined;

    const field: StatsField = {
        path,
        type,
        nullable,
        role,
        aggregation,
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

            if (propSchema.type === 'object' && propSchema.properties) {
                fields.push(...gensonToFields(propSchema, samples, fieldPath));
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