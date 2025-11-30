import { inferType } from '@jsonhero/json-infer-types';
import { DATE_FORMATS, FORMAT_MAPPING, LIMITS, THRESHOLDS, TYPE_MAPPING } from './constants.js';
import { detect } from './detect.js';
import { sampleRows } from './sample.js';
import type {
    AggregationType,
    FieldFormat,
    FieldRole,
    FieldType,
    StatsField,
    StatsMultiTableSchema,
    StatsTableSchema,
} from './types.js';
import {
    buildArrayFieldPath,
    buildFieldPath,
    escapePathSegment,
    type PlainObject,
} from './utils.js';

type InferredType = ReturnType<typeof inferType>;

interface FieldAccumulator {
    examples: Map<string, unknown>;
    typeCounts: Map<FieldType, number>;
    formatCounts: Map<string, number>;
    nullCount: number;
    totalCount: number;
    firstArrayItemType?: FieldType;
}

interface FieldBuildOptions {
    formatThreshold: number;
    mixedTypeThreshold: number;
}

export interface ComputeStatsOptions {
    maxRows?: number;
    maxDepth?: number;
    formatThreshold?: number;
    mixedTypeThreshold?: number;
}

function mapToFieldType(inferred: InferredType): FieldType {
    return (TYPE_MAPPING[inferred.name] as FieldType) ?? 'string';
}

function extractFieldFormat(inferred: InferredType): FieldFormat | undefined {
    if (inferred.name !== 'string' || !('format' in inferred)) {
        return undefined;
    }

    const formatInfo = inferred as { format?: { name: string } };
    const formatName = formatInfo.format?.name;

    if (!formatName) {
        return undefined;
    }

    return (FORMAT_MAPPING[formatName] ?? formatName) as FieldFormat;
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

function addExample(accumulator: FieldAccumulator, value: unknown): void {
    if (accumulator.examples.size >= LIMITS.maxExamplesPerField) {
        return;
    }

    const serializedKey = JSON.stringify(value);

    if (!accumulator.examples.has(serializedKey)) {
        accumulator.examples.set(serializedKey, value);
    }
}

function incrementTypeCount(accumulator: FieldAccumulator, fieldType: FieldType): void {
    const currentCount = accumulator.typeCounts.get(fieldType) ?? 0;
    accumulator.typeCounts.set(fieldType, currentCount + 1);
}

function incrementFormatCount(accumulator: FieldAccumulator, format: FieldFormat): void {
    const currentCount = accumulator.formatCounts.get(format) ?? 0;
    accumulator.formatCounts.set(format, currentCount + 1);
}

function processArrayItems(
    arrayItems: unknown[],
    accumulators: Map<string, FieldAccumulator>,
    basePath: string,
    parentAccumulator: FieldAccumulator,
    currentDepth: number,
    maxDepth: number
): void {
    for (const item of arrayItems) {
        if (item === null || item === undefined) {
            continue;
        }

        if (parentAccumulator.firstArrayItemType === undefined) {
            const inferred = inferType(item);
            parentAccumulator.firstArrayItemType = mapToFieldType(inferred);
        }

        if (typeof item === 'object' && !Array.isArray(item)) {
            collectFieldsFromObject(
                item as PlainObject,
                accumulators,
                basePath.split('.'),
                currentDepth,
                maxDepth
            );
        }
    }
}

function processFieldValue(
    value: unknown,
    accumulator: FieldAccumulator,
    accumulators: Map<string, FieldAccumulator>,
    pathSegments: readonly string[],
    currentDepth: number,
    maxDepth: number
): void {
    const inferred = inferType(value);
    const fieldType = mapToFieldType(inferred);

    incrementTypeCount(accumulator, fieldType);

    const format = extractFieldFormat(inferred);
    if (format) {
        incrementFormatCount(accumulator, format);
    }

    addExample(accumulator, value);

    if (currentDepth >= maxDepth) {
        return;
    }

    if (fieldType === 'object' && typeof value === 'object' && value !== null) {
        collectFieldsFromObject(
            value as PlainObject,
            accumulators,
            pathSegments,
            currentDepth + 1,
            maxDepth
        );
    }

    if (fieldType === 'array' && Array.isArray(value)) {
        const pathString = buildFieldPath(pathSegments);
        const arrayPath = buildArrayFieldPath(pathString);

        processArrayItems(value, accumulators, arrayPath, accumulator, currentDepth + 1, maxDepth);
    }
}

function collectFieldsFromObject(
    sourceObject: PlainObject,
    accumulators: Map<string, FieldAccumulator>,
    pathSegments: readonly string[],
    currentDepth: number,
    maxDepth: number
): void {
    for (const [key, value] of Object.entries(sourceObject)) {
        const escapedKey = escapePathSegment(key);
        const currentPath = [...pathSegments, escapedKey];
        const pathString = buildFieldPath(currentPath);

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

        processFieldValue(value, accumulator, accumulators, currentPath, currentDepth, maxDepth);
    }
}

function collectFieldsFromRows(
    rows: readonly PlainObject[],
    accumulators: Map<string, FieldAccumulator>,
    maxDepth: number
): void {
    for (const row of rows) {
        collectFieldsFromObject(row, accumulators, [], 0, maxDepth);
    }
}

function determineDominantType(
    typeCounts: Map<FieldType, number>,
    nonNullCount: number,
    mixedTypeThreshold: number
): FieldType {
    if (typeCounts.size === 0) {
        return 'null';
    }

    const mergedCounts = new Map<FieldType, number>();

    for (const [fieldType, count] of typeCounts) {
        const normalizedType = fieldType === 'int' ? 'number' : fieldType;
        const currentCount = mergedCounts.get(normalizedType) ?? 0;
        mergedCounts.set(normalizedType, currentCount + count);
    }

    const sortedTypes = [...mergedCounts.entries()].sort(
        ([, countA], [, countB]) => countB - countA
    );

    const topEntry = sortedTypes[0];
    if (!topEntry) {
        return 'null';
    }

    const [dominantType, dominantCount] = topEntry;

    if (sortedTypes.length > 1 && nonNullCount > 0) {
        const secondaryCount = nonNullCount - dominantCount;
        const secondaryRatio = secondaryCount / nonNullCount;

        if (secondaryRatio > mixedTypeThreshold) {
            return 'mixed';
        }
    }

    if (dominantType === 'number') {
        const intCount = typeCounts.get('int') ?? 0;
        const floatCount = typeCounts.get('number') ?? 0;

        if (floatCount === 0 && intCount > 0) {
            return 'int';
        }
    }

    return dominantType;
}

function determineDominantFormat(
    accumulator: FieldAccumulator,
    formatThreshold: number
): FieldFormat | undefined {
    const stringCount = accumulator.typeCounts.get('string') ?? 0;

    if (stringCount === 0 || accumulator.formatCounts.size === 0) {
        return undefined;
    }

    const sortedFormats = [...accumulator.formatCounts.entries()].sort(
        ([, countA], [, countB]) => countB - countA
    );

    const topEntry = sortedFormats[0];
    if (!topEntry) {
        return undefined;
    }

    const [topFormat, topCount] = topEntry;
    const formatRatio = topCount / stringCount;

    if (formatRatio >= formatThreshold) {
        return topFormat as FieldFormat;
    }

    return undefined;
}

// ============================================================================
// Role and Aggregation Inference
// ============================================================================

const IDENTIFIER_PATTERNS = [
    /^id$/i,
    /_id$/i,
    /Id$/,
    /^uuid$/i,
    /^guid$/i,
    /^key$/i,
    /_key$/i,
    /^code$/i,
    /_code$/i,
    /^sku$/i,
    /^slug$/i,
];

const REFERENCE_PATTERNS = [
    /_id$/i,
    /_ref$/i,
    /_key$/i,
    /^parent_/i,
    /^foreign_/i,
];

const TIME_PATTERNS = [
    /date/i,
    /time/i,
    /timestamp/i,
    /_at$/i,
    /^created/i,
    /^updated/i,
    /^deleted/i,
    /^modified/i,
];

const MEASURE_PATTERNS = [
    /^amount/i,
    /^total/i,
    /^sum/i,
    /^count/i,
    /^quantity/i,
    /^price/i,
    /^cost/i,
    /^value/i,
    /^score/i,
    /^rating/i,
    /^percent/i,
    /^ratio/i,
    /^rate/i,
    /^balance/i,
    /^weight/i,
    /^height/i,
    /^width/i,
    /^length/i,
    /^size/i,
    /^duration/i,
    /^distance/i,
    /^confidence/i,
    /^strength/i,
    /_count$/i,
    /_total$/i,
    /_sum$/i,
    /_amount$/i,
    /_score$/i,
];

const TEXT_PATTERNS = [
    /^description/i,
    /^comment/i,
    /^note/i,
    /^body/i,
    /^content/i,
    /^text/i,
    /^message/i,
    /^summary/i,
    /^bio/i,
    /^quote/i,
    /^context/i,
    /^evidence/i,
];

function getLeafName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1] ?? path;
}

function matchesAnyPattern(name: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(name));
}

function inferRole(path: string, type: FieldType, format?: FieldFormat): FieldRole {
    const leafName = getLeafName(path);

    // Type-based inference first
    if (type === 'object') return 'metadata';
    if (type === 'array') return 'metadata';
    if (type === 'date') return 'time';

    // Format-based inference
    if (format === 'uuid' || format === 'slug') return 'identifier';
    if (format === 'datetime' || format === 'date' || format === 'time' || format === 'iso8601') return 'time';

    // Pattern-based inference
    if (leafName === 'id' || (path.split('.').length === 1 && matchesAnyPattern(leafName, IDENTIFIER_PATTERNS))) {
        return 'identifier';
    }

    if (matchesAnyPattern(leafName, REFERENCE_PATTERNS) && leafName !== 'id') {
        return 'reference';
    }

    if (matchesAnyPattern(leafName, TIME_PATTERNS)) {
        return 'time';
    }

    if ((type === 'number' || type === 'int') && matchesAnyPattern(leafName, MEASURE_PATTERNS)) {
        return 'measure';
    }

    if (type === 'string' && matchesAnyPattern(leafName, TEXT_PATTERNS)) {
        return 'text';
    }

    // Numeric fields are usually measures
    if (type === 'number' || type === 'int') {
        return 'measure';
    }

    // String fields are usually dimensions
    if (type === 'string') {
        return 'dimension';
    }

    // Boolean fields are dimensions
    if (type === 'boolean') {
        return 'dimension';
    }

    return 'metadata';
}

function inferAggregation(role: FieldRole, path: string, type: FieldType): AggregationType {
    if (role !== 'measure') {
        return 'none';
    }

    const leafName = getLeafName(path).toLowerCase();

    // Count-like fields
    if (leafName.includes('count') || leafName.includes('quantity') || leafName.includes('num_')) {
        return 'sum';
    }

    // Sum-like fields
    if (leafName.includes('total') || leafName.includes('sum') || leafName.includes('amount')) {
        return 'sum';
    }

    // Average-like fields (scores, ratings, percentages)
    if (leafName.includes('score') || leafName.includes('rating') ||
        leafName.includes('percent') || leafName.includes('ratio') ||
        leafName.includes('rate') || leafName.includes('average') ||
        leafName.includes('confidence') || leafName.includes('strength')) {
        return 'avg';
    }

    // Default for measures
    return 'sum';
}

function inferUnit(path: string, type: FieldType, format?: FieldFormat): string | undefined {
    const leafName = getLeafName(path).toLowerCase();

    // Currency
    if (leafName.includes('price') || leafName.includes('cost') ||
        leafName.includes('amount') || leafName.includes('balance') ||
        format === 'currency') {
        return 'USD';
    }

    // Percentage
    if (leafName.includes('percent') || leafName.includes('ratio') || format === 'percent') {
        return '%';
    }

    // Time duration
    if (leafName.includes('duration') || leafName.includes('seconds')) {
        return 'seconds';
    }
    if (leafName.includes('minutes')) {
        return 'minutes';
    }
    if (leafName.includes('hours')) {
        return 'hours';
    }
    if (leafName.includes('days')) {
        return 'days';
    }

    // Distance/size
    if (leafName.includes('distance') || leafName.includes('length') ||
        leafName.includes('width') || leafName.includes('height')) {
        return 'meters';
    }

    // Weight
    if (leafName.includes('weight')) {
        return 'kg';
    }

    // Count
    if (leafName.includes('count') || leafName.includes('instance')) {
        return 'instances';
    }

    // Words
    if (leafName.includes('word_count') || leafName.includes('wordcount')) {
        return 'words';
    }

    // Tokens
    if (leafName.includes('token')) {
        return 'tokens';
    }

    return undefined;
}

// ============================================================================
// Field Building
// ============================================================================

function buildStatsField(
    path: string,
    accumulator: FieldAccumulator,
    options: FieldBuildOptions
): StatsField {
    const nonNullCount = accumulator.totalCount - accumulator.nullCount;

    let fieldType = determineDominantType(
        accumulator.typeCounts,
        nonNullCount,
        options.mixedTypeThreshold
    );

    const format = determineDominantFormat(accumulator, options.formatThreshold);

    if (fieldType === 'string' && format && DATE_FORMATS.has(format)) {
        fieldType = 'date';
    }

    const role = inferRole(path, fieldType, format);
    const aggregation = inferAggregation(role, path, fieldType);
    const unit = inferUnit(path, fieldType, format);

    const baseField: StatsField = {
        path,
        type: fieldType,
        nullable: accumulator.nullCount > 0,
        role,
        aggregation,
        sampleValues: Array.from(accumulator.examples.values()),
    };

    return {
        ...baseField,
        ...(format && { format }),
        ...(unit && { unit }),
        ...(fieldType === 'array' && accumulator.firstArrayItemType && { itemType: accumulator.firstArrayItemType }),
    };
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

    const buildOptions: FieldBuildOptions = {
        formatThreshold,
        mixedTypeThreshold,
    };

    for (const [tableName, rows] of Object.entries(detected.tables)) {
        const sampleResult = sampleRows(rows as PlainObject[], maxRows);
        const accumulators = new Map<string, FieldAccumulator>();

        collectFieldsFromRows(sampleResult.rows, accumulators, maxDepth);

        const fields: StatsField[] = [];

        for (const [path, accumulator] of accumulators) {
            fields.push(buildStatsField(path, accumulator, buildOptions));
        }

        fields.sort((fieldA, fieldB) => fieldA.path.localeCompare(fieldB.path));

        tables[tableName] = { fields };
    }

    return { tables };
}