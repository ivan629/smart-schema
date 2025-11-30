import { inferType } from '@jsonhero/json-infer-types';
import { DATE_FORMATS, FORMAT_MAPPING, LIMITS, THRESHOLDS, TYPE_MAPPING } from './constants.js';
import { detect } from './detect.js';
import { sampleRows } from './sample.js';
import type {
    FieldFormat,
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

    const baseField: StatsField = {
        path,
        type: fieldType,
        nullable: accumulator.nullCount > 0,
        examples: Array.from(accumulator.examples.values()),
    };

    if (format) {
        return { ...baseField, format };
    }

    if (fieldType === 'array' && accumulator.firstArrayItemType) {
        return { ...baseField, itemType: accumulator.firstArrayItemType };
    }

    return baseField;
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