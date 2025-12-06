/**
 * SmartSchema v2 - Statistics
 *
 * Analyzes data structure and infers semantic roles.
 *
 * FEATURES:
 * - Cardinality tracking for better role inference
 * - Value pattern detection (Unix timestamps, boolean strings, etc.)
 * - Smarter role scoring based on data characteristics
 * - String length heuristic for text detection
 * - Nullable type merging
 *
 * All patterns are defined in constants.ts for easy maintenance.
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
import {
    DATE_FORMATS,
    IDENTIFIER_PATTERNS,
    TIME_PATTERNS,
    MEASURE_PATTERNS,
    TEXT_PATTERNS,
    DIMENSION_PATTERNS,
    AVG_AGGREGATION_PATTERNS,
    NONE_AGGREGATION_PATTERNS,
    UNIT_PATTERNS,
    VALUE_PATTERNS,
    STATS_SAMPLE_TRUNCATE_LENGTH,
    MIN_SAMPLES_FOR_CARDINALITY,
    MIN_SAMPLES_FOR_UNIQUE,
    LOW_CARDINALITY_THRESHOLD,
    MEDIUM_CARDINALITY_THRESHOLD,
    MEDIUM_SAMPLE_SIZE_THRESHOLD,
    TEXT_AVG_LENGTH_THRESHOLD,
    TEXT_MAX_LENGTH_THRESHOLD,
    MAX_SAMPLES_PER_FIELD,
    type ValuePattern,
} from './constants.js';

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
// Value Pattern Detection
// ============================================================================

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
        if (typeof sample === 'string' && sample.length > STATS_SAMPLE_TRUNCATE_LENGTH) {
            result.push(sample.slice(0, STATS_SAMPLE_TRUNCATE_LENGTH - 3) + '...');
        } else {
            result.push(sample);
        }
    }

    return result;
}

// ============================================================================
// Pattern Matching Helpers
// ============================================================================

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(value));
}

// ============================================================================
// Role Inference
// ============================================================================

function inferRole(
    path: string,
    type: FieldType,
    format: FieldFormat | undefined,
    cardinality: number | undefined,
    sampleSize: number | undefined,
    valuePatternRole: FieldRole | undefined,
    samples: unknown[]
): FieldRole {
    const leaf = path.split('.').pop() ?? path;

    // 0. Boolean flag detection by name (BEFORE value pattern check)
    // This catches is_active, has_permission, etc. even with limited samples
    if (type === 'int' && /^(is|has|can|should|allow|enable|disable)[_a-z]*$/i.test(leaf)) {
        return 'dimension';
    }

    // 1. Value pattern detection takes precedence for specific patterns
    if (valuePatternRole) {
        return valuePatternRole;
    }

    // 2. Time fields (name-based)
    if (matchesAnyPattern(leaf, TIME_PATTERNS)) {
        return 'time';
    }
    if (format === 'datetime' || format === 'date') return 'time';
    if (type === 'date') return 'time';

    // 3. Format-based
    if (format === 'url' || format === 'email') return 'dimension';
    if (format === 'uuid') return 'identifier';

    // 4. NUMERIC: Check name patterns FIRST, then use cardinality as tiebreaker
    if (type === 'int' || type === 'number') {
        // Check if name suggests it's a measure (takes precedence)
        if (matchesAnyPattern(leaf, MEASURE_PATTERNS)) {
            return 'measure';
        }

        // Use cardinality to distinguish dimension vs identifier for unnamed numerics
        if (cardinality !== undefined && sampleSize !== undefined && sampleSize >= MIN_SAMPLES_FOR_CARDINALITY) {
            // All unique values = likely identifier
            if (cardinality === sampleSize && sampleSize > MIN_SAMPLES_FOR_UNIQUE) {
                return 'identifier';
            }
            // Very low cardinality (≤10 unique values) = likely dimension (enum-like)
            if (cardinality <= LOW_CARDINALITY_THRESHOLD) {
                return 'dimension';
            }
            // Low cardinality relative to sample size = likely dimension
            if (cardinality <= MEDIUM_CARDINALITY_THRESHOLD && sampleSize >= MEDIUM_SAMPLE_SIZE_THRESHOLD) {
                return 'dimension';
            }
        }
        // Default for numeric: measure
        return 'measure';
    }

    // 5. String → text or dimension (with cardinality check and length heuristic)
    if (type === 'string') {
        // Check for text patterns first
        if (matchesAnyPattern(leaf, TEXT_PATTERNS)) {
            return 'text';
        }

        // String length heuristic - long strings are likely text, not dimensions
        const stringsSamples = samples.filter((s): s is string => typeof s === 'string');
        if (stringsSamples.length > 0) {
            const avgLength = stringsSamples.reduce((sum, s) => sum + s.length, 0) / stringsSamples.length;
            const maxLength = Math.max(...stringsSamples.map(s => s.length));

            // Long average length or any very long string → text
            if (avgLength > TEXT_AVG_LENGTH_THRESHOLD || maxLength > TEXT_MAX_LENGTH_THRESHOLD) {
                return 'text';
            }
        }

        // Check for dimension patterns
        if (matchesAnyPattern(leaf, DIMENSION_PATTERNS)) {
            return 'dimension';
        }

        // High cardinality + all unique = likely identifier
        if (cardinality !== undefined && sampleSize !== undefined && sampleSize >= MIN_SAMPLES_FOR_CARDINALITY) {
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

// ============================================================================
// Fix inferAggregation() to check parent context (around line 200)
// ============================================================================

function inferAggregation(role: FieldRole, path: string): AggregationType {
    if (role !== 'measure') return 'none';

    const leaf = path.split('.').pop() ?? path;
    const fullPathLower = path.toLowerCase();

    // Check for 'none' aggregation first (limits, configs, coordinates)
    if (matchesAnyPattern(leaf, NONE_AGGREGATION_PATTERNS)) {
        return 'none';
    }

    // Context-aware: 'value' inside a scoring structure should avg
    if (leaf === 'value' && /score/.test(fullPathLower)) {
        return 'avg';
    }

    // Context-aware: 'percentile' fields should avg
    if (leaf === 'percentile' || fullPathLower.includes('percentile')) {
        return 'avg';
    }

    // Check for 'avg' aggregation
    if (matchesAnyPattern(leaf, AVG_AGGREGATION_PATTERNS)) {
        return 'avg';
    }

    // Check full path for avg patterns (catches nested scores)
    if (matchesAnyPattern(fullPathLower, AVG_AGGREGATION_PATTERNS)) {
        return 'avg';
    }

    // Default: sum for counts, totals, amounts
    return 'sum';
}

function inferUnit(path: string): string | undefined {
    const leaf = path.split('.').pop() ?? path;
    const fullPathLower = path.toLowerCase();  // Add this

    for (const { pattern, unit } of UNIT_PATTERNS) {
        // Check both leaf AND full path for context-aware matching
        if (pattern.test(leaf) || pattern.test(fullPathLower)) {
            return unit;
        }
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

/**
 * Infer actual type from sample values when schema type is null or ambiguous
 */
function inferTypeFromSamples(samples: unknown[]): FieldType | null {
    const nonNullSample = samples.find(s => s !== null && s !== undefined);
    if (nonNullSample === undefined) return null;

    if (typeof nonNullSample === 'string') return 'string';
    if (typeof nonNullSample === 'number') {
        return Number.isInteger(nonNullSample) ? 'int' : 'number';
    }
    if (typeof nonNullSample === 'boolean') return 'boolean';
    if (Array.isArray(nonNullSample)) return 'array';
    if (typeof nonNullSample === 'object') return 'object';

    return null;
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

    // Infer type from samples when schema says null
    if (type === 'null' && samples.length > 0) {
        const inferredType = inferTypeFromSamples(samples);
        if (inferredType) {
            type = inferredType;
            nullable = true;  // Mark as nullable since some values are null
        }
    }

    // Also handle mixed types by looking at samples
    if (type === 'null' || (Array.isArray(schema.type) && schema.type.includes('null'))) {
        const inferredType = inferTypeFromSamples(samples);
        if (inferredType && inferredType !== 'null') {
            type = inferredType;
            nullable = true;
        }
    }

    const format = detectFormat(samples);

    // Promote string to date if format indicates it
    if (type === 'string' && format && DATE_FORMATS.has(format)) {
        type = 'date';
    }

    // Calculate cardinality
    const nonNullSamples = samples.filter(s => s != null);
    const cardinality = new Set(nonNullSamples.map(s =>
        typeof s === 'object' ? JSON.stringify(s) : String(s)
    )).size;
    const sampleSize = nonNullSamples.length;

    // Detect value patterns (timestamps, boolean ints, etc.)
    const valuePattern = detectValuePattern(nonNullSamples);
    if (valuePattern?.type) {
        type = valuePattern.type;
    }

    // Infer semantic role
    const role = inferRole(path, type, format, cardinality, sampleSize, valuePattern?.role, nonNullSamples);
    const aggregation = inferAggregation(role, path);
    const unit = role === 'measure' ? inferUnit(path) : undefined;

    // Collect diverse sample values for AI enrichment (max 5, unique, non-null)
    const diverseSamples = selectDiverseSamples(nonNullSamples, MAX_SAMPLES_PER_FIELD);

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
                    schemaToField(propSchema, itemPath, itemSamples, !isRequired, allSamples)
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

            // Recurse into array items
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