/**
 * Structure Detection - Runs BEFORE AI enrichment
 *
 * Detects patterns, archetypes, and maps mechanically so AI only
 * needs to enrich unique elements (70% token reduction).
 */

import type {
    StatsMultiTableSchema,
    StatsTableSchema,
    StatsField,
    FieldRole,
    FieldType,
    AggregationType,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface FieldShape {
    readonly type: FieldType;
    readonly role: FieldRole;
    readonly aggregation: AggregationType;
    readonly unit?: string;
    readonly format?: string;
}

export interface DetectedArchetype {
    readonly name: string;
    readonly fields: ReadonlyMap<string, FieldShape>;
    readonly occurrences: readonly string[]; // paths where this archetype appears
}

export interface DetectedMap {
    readonly path: string;
    readonly keys: readonly string[];
    readonly archetypeName: string | null; // null if values don't match an archetype
}

export interface UniqueField {
    readonly path: string;
    readonly type: FieldType;
    readonly role: FieldRole;
    readonly aggregation: AggregationType;
    readonly nullable: boolean;
    readonly unit?: string;
    readonly format?: string;
    readonly sampleValues?: readonly unknown[];
    readonly refKeys?: string;   // detected reference to a map
    readonly sameAs?: string;    // detected duplicate of another field
}

export interface DetectedPattern {
    readonly type: string;
    readonly [key: string]: unknown;
}

export interface PreCompressedStructure {
    readonly stats: StatsMultiTableSchema;
    readonly archetypes: ReadonlyMap<string, DetectedArchetype>;
    readonly maps: ReadonlyMap<string, DetectedMap>;
    readonly uniqueFields: ReadonlyMap<string, readonly UniqueField[]>; // by table
    readonly patterns: readonly DetectedPattern[];
    readonly containers: ReadonlySet<string>; // pure wrapper objects to skip
}

// ============================================================================
// Helper Functions
// ============================================================================

function getLeafName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1] ?? path;
}

function getParentPath(path: string): string {
    const parts = path.split('.');
    return parts.slice(0, -1).join('.');
}

function getPathDepth(path: string): number {
    return path.split('.').length;
}

function shapeKey(shape: FieldShape): string {
    return `${shape.type}:${shape.role}:${shape.aggregation}:${shape.unit ?? ''}:${shape.format ?? ''}`;
}

function fieldToShape(field: StatsField): FieldShape {
    return {
        type: field.type,
        role: field.role,
        aggregation: field.aggregation,
        ...(field.unit && { unit: field.unit }),
        ...(field.format && { format: field.format }),
    };
}

function groupFieldKey(fields: readonly StatsField[]): string {
    const sorted = [...fields].sort((a, b) =>
        getLeafName(a.path).localeCompare(getLeafName(b.path))
    );
    return sorted.map(f => `${getLeafName(f.path)}:${shapeKey(fieldToShape(f))}`).join('|');
}

// ============================================================================
// Pattern Detection
// ============================================================================

interface FieldGroup {
    readonly basePath: string;
    readonly fields: readonly StatsField[];
}

function groupFieldsByParent(fields: readonly StatsField[]): Map<string, StatsField[]> {
    const groups = new Map<string, StatsField[]>();

    for (const field of fields) {
        const parent = getParentPath(field.path);
        if (!parent) continue;

        const existing = groups.get(parent) ?? [];
        existing.push(field);
        groups.set(parent, existing);
    }

    return groups;
}

function findSiblingGroups(fields: readonly StatsField[], minSiblings: number): FieldGroup[] {
    const byParent = groupFieldsByParent(fields);
    const groups: FieldGroup[] = [];

    // Group parents by their grandparent
    const parentsByGrandparent = new Map<string, string[]>();
    for (const parent of byParent.keys()) {
        const grandparent = getParentPath(parent);
        if (!grandparent) continue;

        const existing = parentsByGrandparent.get(grandparent) ?? [];
        existing.push(parent);
        parentsByGrandparent.set(grandparent, existing);
    }

    // Find groups where all siblings have identical structure
    for (const [, parents] of parentsByGrandparent) {
        if (parents.length < minSiblings) continue;

        const parentFields = parents.map(p => ({
            basePath: p,
            fields: byParent.get(p) ?? [],
        }));

        const firstKey = groupFieldKey(parentFields[0]?.fields ?? []);
        const allMatch = parentFields.every(pf => groupFieldKey(pf.fields) === firstKey);

        if (allMatch && parentFields[0]?.fields.length) {
            groups.push(...parentFields);
        }
    }

    return groups;
}

function inferArchetypeName(fields: readonly StatsField[], context: string): string {
    const hasScore = fields.some(f => getLeafName(f.path) === 'score');
    const hasConfidence = fields.some(f => getLeafName(f.path) === 'confidence');
    const hasEvidence = fields.some(f => getLeafName(f.path) === 'evidence');
    const hasValue = fields.some(f => getLeafName(f.path) === 'value');
    const hasCount = fields.some(f => getLeafName(f.path).includes('count'));

    if (hasScore && hasConfidence && hasEvidence) {
        return 'scored_assessment';
    }
    if (hasScore && hasConfidence) {
        return 'scored_metric';
    }
    if (hasValue && hasCount) {
        return 'value_count';
    }

    // Generate from context
    return `${context}_item`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

// ============================================================================
// Main Detection Functions
// ============================================================================

export function detectArchetypes(
    stats: StatsMultiTableSchema,
    minSiblings: number = 3
): Map<string, DetectedArchetype> {
    const archetypes = new Map<string, DetectedArchetype>();
    const seenShapes = new Map<string, { name: string; fields: Map<string, FieldShape>; occurrences: string[] }>();

    for (const table of Object.values(stats.tables)) {
        const siblingGroups = findSiblingGroups(table.fields, minSiblings);

        if (siblingGroups.length < minSiblings) continue;

        const key = groupFieldKey(siblingGroups[0]?.fields ?? []);

        if (seenShapes.has(key)) {
            // Add occurrences to existing archetype
            const existing = seenShapes.get(key)!;
            for (const group of siblingGroups) {
                existing.occurrences.push(group.basePath);
            }
            continue;
        }

        const sampleFields = siblingGroups[0]?.fields ?? [];
        const basePath = siblingGroups[0]?.basePath ?? '';
        const parentName = getLeafName(getParentPath(basePath));

        const archetypeName = inferArchetypeName(sampleFields, parentName);

        const fields = new Map<string, FieldShape>();
        for (const field of sampleFields) {
            const leafName = getLeafName(field.path);
            fields.set(leafName, fieldToShape(field));
        }

        const occurrences = siblingGroups.map(g => g.basePath);

        seenShapes.set(key, { name: archetypeName, fields, occurrences });
        archetypes.set(archetypeName, {
            name: archetypeName,
            fields,
            occurrences,
        });
    }

    return archetypes;
}

export function detectMaps(
    stats: StatsMultiTableSchema,
    archetypes: Map<string, DetectedArchetype>,
    minKeys: number = 3
): Map<string, DetectedMap> {
    const maps = new Map<string, DetectedMap>();

    // Build shape → archetype lookup
    const archetypeByShape = new Map<string, string>();
    for (const [name, archetype] of archetypes) {
        const shape = [...archetype.fields.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v.type}:${v.role}`)
            .join('|');
        archetypeByShape.set(shape, name);
    }

    for (const table of Object.values(stats.tables)) {
        const byParent = groupFieldsByParent(table.fields);

        // Group parents by grandparent
        const parentsByGrandparent = new Map<string, string[]>();
        for (const parent of byParent.keys()) {
            const grandparent = getParentPath(parent);
            if (!grandparent) continue;

            const existing = parentsByGrandparent.get(grandparent) ?? [];
            existing.push(parent);
            parentsByGrandparent.set(grandparent, existing);
        }

        for (const [grandparent, parents] of parentsByGrandparent) {
            if (parents.length < minKeys) continue;

            const firstFields = byParent.get(parents[0] ?? '') ?? [];
            const shape = firstFields
                .map(f => `${getLeafName(f.path)}:${f.type}:${f.role}`)
                .sort()
                .join('|');

            // Check if all siblings match
            const allMatch = parents.every(p => {
                const fields = byParent.get(p) ?? [];
                const key = fields
                    .map(f => `${getLeafName(f.path)}:${f.type}:${f.role}`)
                    .sort()
                    .join('|');
                return key === shape;
            });

            if (!allMatch) continue;

            const keys = parents.map(p => getLeafName(p)).sort();
            const archetypeName = archetypeByShape.get(shape) ?? null;

            maps.set(grandparent, {
                path: grandparent,
                keys,
                archetypeName,
            });
        }
    }

    return maps;
}

export function detectContainers(stats: StatsMultiTableSchema): Set<string> {
    const containers = new Set<string>();

    for (const table of Object.values(stats.tables)) {
        for (const field of table.fields) {
            if (field.type === 'object' && field.role === 'metadata') {
                // Check if it only contains other objects (pure wrapper)
                const hasDirectValue = table.fields.some(f =>
                    f.path !== field.path &&
                    getParentPath(f.path) === field.path &&
                    f.type !== 'object'
                );

                if (!hasDirectValue) {
                    containers.add(field.path);
                }
            }
        }
    }

    return containers;
}

export function detectPatterns(
    stats: StatsMultiTableSchema,
    maps: Map<string, DetectedMap>
): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    for (const table of Object.values(stats.tables)) {
        // Request/Response pattern
        const hasRequest = table.fields.some(f =>
            f.path === 'request' || f.path.startsWith('request.')
        );
        const hasResult = table.fields.some(f =>
            f.path === 'result' || f.path.startsWith('result.')
        );

        if (hasRequest && hasResult) {
            patterns.push({
                type: 'request_response',
                input: 'request',
                output: 'result',
            });
        }
    }

    // Parallel analysis pattern (multiple maps under same parent)
    const mapPaths = [...maps.keys()];
    const mapsByParentParent = new Map<string, string[]>();

    for (const mapPath of mapPaths) {
        const parent = getParentPath(mapPath);
        const grandparent = getParentPath(parent);

        if (grandparent) {
            const existing = mapsByParentParent.get(grandparent) ?? [];
            existing.push(parent);
            mapsByParentParent.set(grandparent, existing);
        }
    }

    for (const [grandparent, parents] of mapsByParentParent) {
        const uniqueParents = [...new Set(parents)];
        if (uniqueParents.length >= 2) {
            patterns.push({
                type: 'parallel_analysis',
                parent: grandparent,
                analyses: uniqueParents.map(p => ({
                    path: p,
                    name: getLeafName(p),
                })),
            });
        }
    }

    // Meta summary pattern (meta object next to a map)
    for (const table of Object.values(stats.tables)) {
        const metaPaths = table.fields
            .filter(f => f.path.endsWith('.meta') || getLeafName(f.path) === 'meta')
            .map(f => f.path);

        for (const metaPath of metaPaths) {
            const parent = getParentPath(metaPath);
            const siblingMap = mapPaths.find(mp => getParentPath(mp) === parent);

            if (siblingMap) {
                patterns.push({
                    type: 'meta_summary',
                    meta: metaPath,
                    data: siblingMap,
                });
            }
        }
    }

    return patterns;
}

function detectReferences(
    fields: readonly StatsField[],
    maps: Map<string, DetectedMap>
): Map<string, { refKeys?: string; sameAs?: string }> {
    const refs = new Map<string, { refKeys?: string; sameAs?: string }>();
    const mapPaths = new Set(maps.keys());
    const seenValues = new Map<string, string>();

    for (const field of fields) {
        // Detect refKeys (references to map keys)
        if (field.type === 'string' && field.role === 'dimension') {
            const leafName = getLeafName(field.path).toLowerCase();

            for (const mapPath of mapPaths) {
                const mapLeaf = getLeafName(mapPath).toLowerCase();

                if (leafName.includes(mapLeaf.slice(0, -1)) ||
                    leafName.includes('highest') ||
                    leafName.includes('lowest') ||
                    leafName.includes('top') ||
                    leafName.includes('primary')) {

                    const parent = getParentPath(field.path);
                    const mapParent = getParentPath(mapPath);

                    if (parent.startsWith(mapParent) ||
                        mapParent.startsWith(parent.split('.').slice(0, -1).join('.'))) {
                        refs.set(field.path, { refKeys: mapPath });
                        break;
                    }
                }
            }
        }

        // Detect sameAs (duplicate fields)
        const descKey = `${field.type}:${field.role}:${getLeafName(field.path)}`;

        if (seenValues.has(descKey) && seenValues.get(descKey) !== field.path) {
            const originalPath = seenValues.get(descKey)!;
            if (getPathDepth(field.path) > getPathDepth(originalPath)) {
                const existing = refs.get(field.path) ?? {};
                refs.set(field.path, { ...existing, sameAs: originalPath });
            }
        } else {
            seenValues.set(descKey, field.path);
        }
    }

    return refs;
}

export function extractUniqueFields(
    table: StatsTableSchema,
    maps: Map<string, DetectedMap>,
    containers: Set<string>
): UniqueField[] {
    const refs = detectReferences(table.fields, maps);
    const uniqueFields: UniqueField[] = [];

    for (const field of table.fields) {
        // Skip containers
        if (containers.has(field.path)) continue;

        // Skip fields inside maps (they're covered by archetypes)
        let insideMap = false;
        for (const [mapPath, map] of maps) {
            if (map.archetypeName) {
                // Skip fields under map keys
                for (const key of map.keys) {
                    const keyPath = `${mapPath}.${key}`;
                    if (field.path.startsWith(keyPath + '.') || field.path === keyPath) {
                        insideMap = true;
                        break;
                    }
                }
            }
            if (insideMap) break;
        }

        if (insideMap) continue;

        const ref = refs.get(field.path);

        uniqueFields.push({
            path: field.path,
            type: field.type,
            role: field.role,
            aggregation: field.aggregation,
            nullable: field.nullable,
            ...(field.unit && { unit: field.unit }),
            ...(field.format && { format: field.format }),
            ...(field.sampleValues?.length && { sampleValues: field.sampleValues }),
            ...(ref?.refKeys && { refKeys: ref.refKeys }),
            ...(ref?.sameAs && { sameAs: ref.sameAs }),
        });
    }

    return uniqueFields;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export function detectStructure(stats: StatsMultiTableSchema): PreCompressedStructure {
    const archetypes = detectArchetypes(stats);
    const maps = detectMaps(stats, archetypes);
    const containers = detectContainers(stats);
    const patterns = detectPatterns(stats, maps);

    const uniqueFields = new Map<string, readonly UniqueField[]>();
    for (const [tableName, table] of Object.entries(stats.tables)) {
        uniqueFields.set(tableName, extractUniqueFields(table, maps, containers));
    }

    return {
        stats,
        archetypes,
        maps,
        uniqueFields,
        patterns,
        containers,
    };
}

// ============================================================================
// Stats for Logging
// ============================================================================

export function getStructureStats(structure: PreCompressedStructure): {
    originalFieldCount: number;
    uniqueFieldCount: number;
    archetypeCount: number;
    mapCount: number;
    patternCount: number;
    reductionPercent: number;
} {
    const originalFieldCount = Object.values(structure.stats.tables)
        .reduce((sum, t) => sum + t.fields.length, 0);

    const uniqueFieldCount = [...structure.uniqueFields.values()]
        .reduce((sum, fields) => sum + fields.length, 0);

    const archetypeCount = structure.archetypes.size;
    const mapCount = structure.maps.size;
    const patternCount = structure.patterns.length;

    const reductionPercent = Math.round((1 - uniqueFieldCount / originalFieldCount) * 100);

    return {
        originalFieldCount,
        uniqueFieldCount,
        archetypeCount,
        mapCount,
        patternCount,
        reductionPercent,
    };
}