/**
 * Stats Module - Semantic Schema Generation
 *
 * Uses genson-js for base JSON Schema generation, then enriches with:
 * - Role inference (measure, dimension, identifier, time, text)
 * - Aggregation inference (sum, avg, count, none)
 * - Unit detection (USD, tokens, percent, etc.)
 * - Format detection (url, email, datetime, uuid)
 * - Numeric string promotion
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
// Constants
// ============================================================================

const ROLE_PATTERNS = {
    identifier: [
        /\bid\b/i, /\bkey\b/i, /\buuid\b/i, /\bguid\b/i, /\bcode\b/i,
        /\bsku\b/i, /\bref\b/i, /\bslug\b/i, /_id$/i, /Id$/,
    ],
    time: [
        /\bdate\b/i, /\btime\b/i, /\btimestamp\b/i, /\bcreated\b/i,
        /\bupdated\b/i, /\bmodified\b/i, /_at$/i, /At$/, /\bwhen\b/i,
    ],
    measure: [
        /\bcount\b/i, /\btotal\b/i, /\bsum\b/i, /\bamount\b/i, /\bprice\b/i,
        /\bcost\b/i, /\bvalue\b/i, /\brate\b/i, /\bscore\b/i, /\bweight\b/i,
        /\bheight\b/i, /\bwidth\b/i, /\blength\b/i, /\bsize\b/i, /\bage\b/i,
        /\bduration\b/i, /\bquantity\b/i, /\bpercent/i, /\bratio\b/i,
        /\bavg\b/i, /\baverage\b/i, /\bmin\b/i, /\bmax\b/i, /\bnum\b/i,
        /\bnumber\b/i, /\bconfidence\b/i, /\bstrength\b/i, /\bintensity\b/i,
        /\bfrequency\b/i, /\bvolume\b/i, /\bdistance\b/i, /\bspeed\b/i,
        /\bbalance\b/i, /\bbudget\b/i, /\brevenue\b/i, /\bprofit\b/i,
        /\bloss\b/i, /\bsalary\b/i, /\bincome\b/i, /\bexpense\b/i,
        /\btokens?\b/i, /\bwords?\b/i, /\bcharacters?\b/i, /\blines?\b/i,
        /\binstances?\b/i, /\boccurrences?\b/i, /\bdetected\b/i,
    ],
    text: [
        /\bdescription\b/i, /\btext\b/i, /\bcontent\b/i, /\bbody\b/i,
        /\bmessage\b/i, /\bcomment\b/i, /\bnote\b/i, /\bsummary\b/i,
        /\bdetails?\b/i, /\bexplanation\b/i, /\breason\b/i, /\bquote\b/i,
        /\bcontext\b/i, /\bnarrative\b/i, /\bstory\b/i, /\barticle\b/i,
        /\bparagraph\b/i, /\bsentence\b/i, /\bexcerpt\b/i, /\bsnippet\b/i,
        /\btranscript\b/i, /\bmarkdown\b/i, /\bhtml\b/i, /\bresponse\b/i,
        /\bprompt\b/i, /\bquery\b/i, /\bquestion\b/i, /\banswer\b/i,
        /\bfeedback\b/i, /\breview\b/i, /\bimpact\b/i, /\bassessment\b/i,
    ],
} as const;

const UNIT_PATTERNS: Array<{ pattern: RegExp; unit: string }> = [
    { pattern: /(cost|price|amount|revenue|profit|income|expense|salary|budget|balance|usd|dollar)/i, unit: 'USD' },
    { pattern: /(percent|pct|ratio)/i, unit: 'percent' },
    { pattern: /(tokens?)/i, unit: 'tokens' },
    { pattern: /(words?|word_count)/i, unit: 'words' },
    { pattern: /(bytes?|size)/i, unit: 'bytes' },
    { pattern: /(seconds?|secs?|duration_s)/i, unit: 'seconds' },
    { pattern: /(minutes?|mins?)/i, unit: 'minutes' },
    { pattern: /(hours?|hrs?)/i, unit: 'hours' },
    { pattern: /(days?)/i, unit: 'days' },
    { pattern: /(count|num|quantity|instances?|occurrences?)/i, unit: 'instances' },
];

const AVG_PATTERNS = [
    /\bavg\b/i, /\baverage\b/i, /\bmean\b/i, /\brate\b/i, /\bratio\b/i,
    /\bpercent/i, /\bscore\b/i, /\bconfidence\b/i, /\bstrength\b/i,
    /\bintensity\b/i, /\bprobability\b/i, /\blikelihood\b/i,
];

// ============================================================================
// Sample Collection
// ============================================================================

/**
 * Collect samples for each field path from raw data
 */
function collectFieldSamples(
    data: unknown,
    path: string = '',
    samples: Map<string, unknown[]> = new Map()
): Map<string, unknown[]> {
    if (data === null || data === undefined) {
        if (path) {
            const existing = samples.get(path) ?? [];
            existing.push(null);
            samples.set(path, existing);
        }
        return samples;
    }

    if (Array.isArray(data)) {
        if (path) {
            const existing = samples.get(path) ?? [];
            existing.push(data);
            samples.set(path, existing);
        }

        for (const item of data) {
            if (item === null || item === undefined) continue;

            if (typeof item === 'object' && !Array.isArray(item)) {
                collectFieldSamples(item, path ? `${path}.[]` : '[]', samples);
            } else if (Array.isArray(item)) {
                collectFieldSamples(item, path ? `${path}.[]` : '[]', samples);
            } else {
                const itemPath = path ? `${path}.[]` : '[]';
                const existing = samples.get(itemPath) ?? [];
                existing.push(item);
                samples.set(itemPath, existing);
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

            if (value !== null && value !== undefined && typeof value === 'object') {
                collectFieldSamples(value, fieldPath, samples);
            }
        }
    }

    return samples;
}

// ============================================================================
// Genson Schema to StatsField Conversion
// ============================================================================

/**
 * Convert genson schema to flat field list with enrichment
 */
function gensonToFields(
    schema: GensonSchema,
    fieldSamples: Map<string, unknown[]>,
    path: string = ''
): StatsField[] {
    const fields: StatsField[] = [];

    if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            const fieldPath = path ? `${path}.${key}` : key;
            const samples = fieldSamples.get(fieldPath) ?? [];
            const isRequired = schema.required?.includes(key) ?? false;
            const nullable = !isRequired || samples.some(s => s === null || s === undefined);

            const field = schemaToField(propSchema, fieldPath, samples, nullable, fieldSamples);
            if (field) {
                fields.push(field);

                // Recurse into nested objects
                if (propSchema.type === 'object' && propSchema.properties) {
                    fields.push(...gensonToFields(propSchema, fieldSamples, fieldPath));
                }
            }
        }
    }

    return fields;
}

/**
 * Convert a single genson schema node to StatsField with recursive itemFields
 */
function schemaToField(
    schema: GensonSchema,
    path: string,
    samples: unknown[],
    nullable: boolean,
    allSamples: Map<string, unknown[]>
): StatsField | null {
    const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    let type = mapGensonType(schemaType);

    // Detect format from samples
    const format = detectFormat(samples);

    // Promote string to date if format indicates it
    if (type === 'string' && format && DATE_FORMATS.has(format)) {
        type = 'date';
    }

    // Detect numeric strings
    if (type === 'string') {
        const stringValues = samples.filter(s => typeof s === 'string' && s.trim() !== '');
        const numericCount = stringValues.filter(s =>
            /^-?\d+\.?\d*(?:[eE][+-]?\d+)?$/.test((s as string).trim()) &&
            !isNaN(parseFloat((s as string).trim()))
        ).length;

        if (numericCount > 0 && numericCount === stringValues.length) {
            const hasDecimals = stringValues.some(s => (s as string).includes('.'));
            type = hasDecimals ? 'number' : 'int';
        }
    }

    const role = inferRole(path, type, format);
    const aggregation = inferAggregation(role, path);
    // Only infer units for measure fields
    const unit = role === 'measure' ? inferUnit(path, format) : undefined;

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
        buildArrayItemFields(field, schema.items, path, allSamples);
    }

    return field;
}

/**
 * Build itemType and itemFields for array fields recursively
 */
function buildArrayItemFields(
    field: StatsField,
    itemSchema: GensonSchema,
    basePath: string,
    allSamples: Map<string, unknown[]>
): void {
    const itemType = Array.isArray(itemSchema.type) ? itemSchema.type[0] : itemSchema.type;
    (field as { itemType?: FieldType }).itemType = mapGensonType(itemType);

    // Array of objects
    if (itemSchema.type === 'object' && itemSchema.properties) {
        const itemFields: StatsField[] = [];

        for (const [key, propSchema] of Object.entries(itemSchema.properties)) {
            const itemSamplePath = `${basePath}.[].${key}`;
            const itemSamples = allSamples.get(itemSamplePath) ?? [];
            const isRequired = itemSchema.required?.includes(key) ?? false;
            const itemNullable = !isRequired || itemSamples.some(s => s === null);

            const itemField = schemaToField(propSchema, key, itemSamples, itemNullable, allSamples);
            if (itemField) {
                itemFields.push(itemField);
            }
        }

        if (itemFields.length > 0) {
            (field as { itemFields?: StatsField[] }).itemFields = itemFields;
        }
    }

    // Array of arrays (nested)
    else if (itemSchema.type === 'array' && itemSchema.items) {
        const nestedField: StatsField = {
            path: '[]',
            type: 'array',
            nullable: false,
            role: 'metadata',
            aggregation: 'none',
        };

        buildArrayItemFields(nestedField, itemSchema.items, `${basePath}.[]`, allSamples);
        (field as { itemFields?: StatsField[] }).itemFields = [nestedField];
    }
}

/**
 * Map genson type string to our FieldType
 */
function mapGensonType(gensonType: string): FieldType {
    const mapping: Record<string, FieldType> = {
        string: 'string',
        integer: 'int',
        number: 'number',
        boolean: 'boolean',
        object: 'object',
        array: 'array',
        null: 'null',
    };
    return mapping[gensonType] ?? 'string';
}

// ============================================================================
// Semantic Enrichment
// ============================================================================

/**
 * Detect format from samples using json-infer-types
 */
function detectFormat(samples: unknown[]): FieldFormat | undefined {
    const formatCounts = new Map<string, number>();
    let stringCount = 0;

    for (const sample of samples) {
        if (typeof sample !== 'string' || sample.trim() === '') continue;
        stringCount++;

        const inferred = inferType(sample);
        const format = extractFieldFormat(inferred);
        if (format) {
            formatCounts.set(format, (formatCounts.get(format) ?? 0) + 1);
        }
    }

    if (formatCounts.size === 0 || stringCount === 0) return undefined;

    const sorted = [...formatCounts.entries()].sort(([, a], [, b]) => b - a);
    const [topFormat, topCount] = sorted[0];

    if (topCount / stringCount >= 0.8) {
        return topFormat as FieldFormat;
    }

    return undefined;
}

/**
 * Extract format from json-infer-types result
 */
function extractFieldFormat(inferred: ReturnType<typeof inferType>): FieldFormat | undefined {
    const name = inferred.name;

    if (name === 'string' && 'format' in inferred) {
        const format = String(inferred.format);
        const formatMap: Record<string, FieldFormat> = {
            uri: 'url',
            email: 'email',
            datetime: 'datetime',
            'date-time': 'datetime',
            date: 'date',
            time: 'time',
            uuid: 'uuid',
        };
        return formatMap[format];
    }

    return undefined;
}

/**
 * Infer semantic role from path, type, and format
 */
function inferRole(
    path: string,
    type: FieldType,
    format?: FieldFormat
): FieldRole {
    const leafName = path.split('.').pop() ?? path;

    // Check patterns in priority order
    for (const pattern of ROLE_PATTERNS.identifier) {
        if (pattern.test(leafName)) return 'identifier';
    }

    for (const pattern of ROLE_PATTERNS.time) {
        if (pattern.test(leafName)) return 'time';
    }

    // Format-based inference
    if (format === 'datetime' || format === 'date') return 'time';
    if (format === 'url' || format === 'email') return 'dimension';
    if (format === 'uuid') return 'identifier';

    // Type-based inference
    if (type === 'date') return 'time';

    // Check measure patterns
    for (const pattern of ROLE_PATTERNS.measure) {
        if (pattern.test(leafName)) return 'measure';
    }

    // Check text patterns
    for (const pattern of ROLE_PATTERNS.text) {
        if (pattern.test(leafName)) return 'text';
    }

    // Numeric types are usually measures
    if (type === 'int' || type === 'number') return 'measure';

    // Boolean and string are usually dimensions
    if (type === 'boolean') return 'dimension';
    if (type === 'string') return 'dimension';

    return 'metadata';
}

/**
 * Infer aggregation based on role and path
 */
function inferAggregation(role: FieldRole, path: string): AggregationType {
    if (role !== 'measure') return 'none';

    const leafName = path.split('.').pop() ?? path;

    for (const pattern of AVG_PATTERNS) {
        if (pattern.test(leafName)) return 'avg';
    }

    return 'sum';
}

/**
 * Infer unit from path
 */
function inferUnit(path: string, _format?: FieldFormat): string | undefined {
    const leafName = path.split('.').pop() ?? path;

    for (const { pattern, unit } of UNIT_PATTERNS) {
        if (pattern.test(leafName)) return unit;
    }

    return undefined;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Compute statistics and semantic schema from data
 */
export function computeStats(
    data: unknown,
    _options: { maxSamples?: number } = {}
): StatsMultiTableSchema {
    const tables: Record<string, StatsTableSchema> = {};

    if (Array.isArray(data)) {
        // Array of objects - use compound schema
        const schema = createCompoundSchema(data) as GensonSchema;
        const fieldSamples = new Map<string, unknown[]>();

        for (const item of data) {
            collectFieldSamples(item, '', fieldSamples);
        }

        const fields = gensonToFields(schema, fieldSamples);
        tables.root = {
            fields,
        };
    } else if (typeof data === 'object' && data !== null) {
        const schema = createCompoundSchema([data]) as GensonSchema;
        const fieldSamples = collectFieldSamples(data);
        const fields = gensonToFields(schema, fieldSamples);

        tables.root = {
            fields,
        };
    }

    return { tables };
}

export type { StatsField, StatsTableSchema, StatsMultiTableSchema };