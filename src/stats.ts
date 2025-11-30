/**
 * Statistics Collection
 *
 * Collects type, format, and role statistics from data samples.
 * This is the foundation for structure detection.
 */

import { inferType } from '@jsonhero/json-infer-types';
import { LIMITS, THRESHOLDS, TYPE_MAPPING, FORMAT_MAPPING, DATE_FORMATS } from './constants.js';
import { detect } from './detect.js';
import { sampleRows } from './sample.js';
import type {
    FieldType,
    FieldRole,
    FieldFormat,
    AggregationType,
    StatsField,
    StatsTableSchema,
    StatsMultiTableSchema,
} from './types.js';

type PlainObject = Record<string, unknown>;
type InferredType = ReturnType<typeof inferType>;

// ============================================================================
// Field Accumulator
// ============================================================================

interface FieldAccumulator {
    examples: Map<string, unknown>;
    typeCounts: Map<FieldType, number>;
    formatCounts: Map<string, number>;
    nullCount: number;
    totalCount: number;
    firstArrayItemType?: FieldType;
}

function createAccumulator(): FieldAccumulator {
    return {
        examples: new Map(),
        typeCounts: new Map(),
        formatCounts: new Map(),
        nullCount: 0,
        totalCount: 0,
    };
}

// ============================================================================
// Type Inference
// ============================================================================

function mapToFieldType(inferred: InferredType): FieldType {
    return (TYPE_MAPPING[inferred.name] as FieldType) ?? 'string';
}

function extractFieldFormat(inferred: InferredType): FieldFormat | undefined {
    if (inferred.name !== 'string' || !('format' in inferred)) {
        return undefined;
    }

    const formatInfo = inferred as { format?: { name: string } };
    const formatName = formatInfo.format?.name;

    if (!formatName) return undefined;

    return (FORMAT_MAPPING[formatName] ?? formatName) as FieldFormat;
}

// ============================================================================
// Role and Aggregation Inference
// ============================================================================

const IDENTIFIER_PATTERNS = [/^id$/i, /_id$/i, /Id$/, /^uuid$/i, /^guid$/i, /^key$/i, /^code$/i, /^sku$/i, /^slug$/i];
const REFERENCE_PATTERNS = [/_id$/i, /_ref$/i, /_key$/i, /^parent_/i, /^foreign_/i];
const TIME_PATTERNS = [/date/i, /time/i, /timestamp/i, /_at$/i, /^created/i, /^updated/i, /^deleted/i];
const MEASURE_PATTERNS = [/^amount/i, /^total/i, /^sum/i, /^count/i, /^quantity/i, /^price/i, /^cost/i, /^value/i, /^score/i, /^rating/i, /^percent/i, /^ratio/i, /^confidence/i, /^strength/i, /_count$/i, /_total$/i, /_amount$/i, /_score$/i];
const TEXT_PATTERNS = [/^description/i, /^comment/i, /^note/i, /^body/i, /^content/i, /^text/i, /^message/i, /^summary/i, /^quote/i, /^context/i, /^evidence/i];

function getLeafName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1] ?? path;
}

function matchesAny(name: string, patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(name));
}

function inferRole(path: string, type: FieldType, format?: FieldFormat): FieldRole {
    const leaf = getLeafName(path);

    if (type === 'object' || type === 'array') return 'metadata';
    if (type === 'date') return 'time';

    if (format === 'uuid' || format === 'slug') return 'identifier';
    if (format === 'datetime' || format === 'date' || format === 'time') return 'time';

    if (leaf === 'id' || (path.split('.').length === 1 && matchesAny(leaf, IDENTIFIER_PATTERNS))) {
        return 'identifier';
    }

    if (matchesAny(leaf, REFERENCE_PATTERNS) && leaf !== 'id') return 'identifier';
    if (matchesAny(leaf, TIME_PATTERNS)) return 'time';
    if ((type === 'number' || type === 'int') && matchesAny(leaf, MEASURE_PATTERNS)) return 'measure';
    if (type === 'string' && matchesAny(leaf, TEXT_PATTERNS)) return 'text';
    if (type === 'number' || type === 'int') return 'measure';
    if (type === 'string' || type === 'boolean') return 'dimension';

    return 'metadata';
}

function inferAggregation(role: FieldRole, path: string): AggregationType {
    if (role !== 'measure') return 'none';

    const leaf = getLeafName(path).toLowerCase();

    if (leaf.includes('count') || leaf.includes('quantity') || leaf.includes('total') || leaf.includes('sum') || leaf.includes('amount')) {
        return 'sum';
    }

    if (leaf.includes('score') || leaf.includes('rating') || leaf.includes('percent') || leaf.includes('ratio') || leaf.includes('confidence') || leaf.includes('average')) {
        return 'avg';
    }

    return 'sum';
}

function inferUnit(path: string, format?: FieldFormat): string | undefined {
    const leaf = getLeafName(path).toLowerCase();

    if (leaf.includes('price') || leaf.includes('cost') || leaf.includes('amount') || format === 'currency') return 'USD';
    if (leaf.includes('percent') || leaf.includes('ratio') || format === 'percent') return '%';
    if (leaf.includes('duration') || leaf.includes('seconds')) return 'seconds';
    if (leaf.includes('minutes')) return 'minutes';
    if (leaf.includes('hours')) return 'hours';
    if (leaf.includes('count') || leaf.includes('instance')) return 'instances';
    if (leaf.includes('word')) return 'words';
    if (leaf.includes('token')) return 'tokens';

    return undefined;
}

// ============================================================================
// Field Collection
// ============================================================================

function escapePathSegment(key: string): string {
    if (key.includes('.') || key.includes('[') || key.includes(']')) {
        return `["${key}"]`;
    }
    return key;
}

function buildPath(segments: readonly string[]): string {
    return segments.join('.');
}

function processValue(
    value: unknown,
    accumulator: FieldAccumulator,
    accumulators: Map<string, FieldAccumulator>,
    pathSegments: readonly string[],
    depth: number,
    maxDepth: number
): void {
    const inferred = inferType(value);
    const fieldType = mapToFieldType(inferred);

    accumulator.typeCounts.set(fieldType, (accumulator.typeCounts.get(fieldType) ?? 0) + 1);

    const format = extractFieldFormat(inferred);
    if (format) {
        accumulator.formatCounts.set(format, (accumulator.formatCounts.get(format) ?? 0) + 1);
    }

    // Store example
    if (accumulator.examples.size < LIMITS.maxExamplesPerField) {
        const key = JSON.stringify(value);
        if (!accumulator.examples.has(key)) {
            accumulator.examples.set(key, value);
        }
    }

    if (depth >= maxDepth) return;

    // Recurse into objects
    if (fieldType === 'object' && typeof value === 'object' && value !== null) {
        collectFromObject(value as PlainObject, accumulators, pathSegments, depth + 1, maxDepth);
    }

    // Recurse into arrays
    if (fieldType === 'array' && Array.isArray(value)) {
        for (const item of value) {
            if (item === null || item === undefined) continue;

            if (accumulator.firstArrayItemType === undefined) {
                accumulator.firstArrayItemType = mapToFieldType(inferType(item));
            }

            if (typeof item === 'object' && !Array.isArray(item)) {
                collectFromObject(item as PlainObject, accumulators, [...pathSegments, '[]'], depth + 1, maxDepth);
            }
        }
    }
}

function collectFromObject(
    obj: PlainObject,
    accumulators: Map<string, FieldAccumulator>,
    pathSegments: readonly string[],
    depth: number,
    maxDepth: number
): void {
    for (const [key, value] of Object.entries(obj)) {
        const escaped = escapePathSegment(key);
        const currentPath = [...pathSegments, escaped];
        const pathString = buildPath(currentPath);

        let accumulator = accumulators.get(pathString);
        if (!accumulator) {
            accumulator = createAccumulator();
            accumulators.set(pathString, accumulator);
        }

        accumulator.totalCount++;

        if (value === null || value === undefined) {
            accumulator.nullCount++;
            continue;
        }

        processValue(value, accumulator, accumulators, currentPath, depth, maxDepth);
    }
}

// ============================================================================
// Type Determination
// ============================================================================

function determineDominantType(
    typeCounts: Map<FieldType, number>,
    nonNullCount: number,
    mixedThreshold: number
): FieldType {
    if (typeCounts.size === 0) return 'null';

    // Merge int into number for comparison
    const merged = new Map<FieldType, number>();
    for (const [type, count] of typeCounts) {
        const normalized = type === 'int' ? 'number' : type;
        merged.set(normalized, (merged.get(normalized) ?? 0) + count);
    }

    const sorted = [...merged.entries()].sort(([, a], [, b]) => b - a);
    const [dominant, dominantCount] = sorted[0] ?? ['null', 0];

    // Check for mixed types
    if (sorted.length > 1 && nonNullCount > 0) {
        const secondaryCount = nonNullCount - dominantCount;
        if (secondaryCount / nonNullCount > mixedThreshold) {
            return 'mixed';
        }
    }

    // Prefer int if all numbers are integers
    if (dominant === 'number') {
        const intCount = typeCounts.get('int') ?? 0;
        const floatCount = typeCounts.get('number') ?? 0;
        if (floatCount === 0 && intCount > 0) return 'int';
    }

    return dominant;
}

function determineDominantFormat(
    accumulator: FieldAccumulator,
    formatThreshold: number
): FieldFormat | undefined {
    const stringCount = accumulator.typeCounts.get('string') ?? 0;
    if (stringCount === 0 || accumulator.formatCounts.size === 0) return undefined;

    const sorted = [...accumulator.formatCounts.entries()].sort(([, a], [, b]) => b - a);
    const [topFormat, topCount] = sorted[0] ?? ['', 0];

    if (topCount / stringCount >= formatThreshold) {
        return topFormat as FieldFormat;
    }

    return undefined;
}

// ============================================================================
// Build Stats Field
// ============================================================================

function buildStatsField(
    path: string,
    accumulator: FieldAccumulator,
    formatThreshold: number,
    mixedThreshold: number
): StatsField {
    const nonNullCount = accumulator.totalCount - accumulator.nullCount;
    let type = determineDominantType(accumulator.typeCounts, nonNullCount, mixedThreshold);
    const format = determineDominantFormat(accumulator, formatThreshold);

    // Promote string to date if format indicates it
    if (type === 'string' && format && DATE_FORMATS.has(format)) {
        type = 'date';
    }

    const role = inferRole(path, type, format);
    const aggregation = inferAggregation(role, path);
    const unit = inferUnit(path, format);

    return {
        path,
        type,
        nullable: accumulator.nullCount > 0,
        role,
        aggregation,
        ...(format && { format }),
        ...(unit && { unit }),
        ...(type === 'array' && accumulator.firstArrayItemType && { itemType: accumulator.firstArrayItemType }),
        ...(accumulator.examples.size > 0 && { sampleValues: Array.from(accumulator.examples.values()) }),
    };
}

// ============================================================================
// Main Export
// ============================================================================

export interface ComputeStatsOptions {
    maxRows?: number;
    maxDepth?: number;
    formatThreshold?: number;
    mixedTypeThreshold?: number;
}

export function computeStats(
    input: unknown,
    options: ComputeStatsOptions = {}
): StatsMultiTableSchema {
    const {
        maxRows = LIMITS.maxRowsToSample,
        maxDepth = LIMITS.maxTraversalDepth,
        formatThreshold = THRESHOLDS.formatDetection,
        mixedTypeThreshold = THRESHOLDS.mixedType,
    } = options;

    const detected = detect(input);
    const tables: Record<string, StatsTableSchema> = {};

    for (const [tableName, rows] of Object.entries(detected.tables)) {
        const sampled = sampleRows(rows as PlainObject[], maxRows);
        const accumulators = new Map<string, FieldAccumulator>();

        for (const row of sampled.rows) {
            collectFromObject(row as PlainObject, accumulators, [], 0, maxDepth);
        }

        const fields: StatsField[] = [];
        for (const [path, accumulator] of accumulators) {
            fields.push(buildStatsField(path, accumulator, formatThreshold, mixedTypeThreshold));
        }

        fields.sort((a, b) => a.path.localeCompare(b.path));
        tables[tableName] = { fields };
    }

    return { tables };
}