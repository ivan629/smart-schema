/**
 * SmartSchema v2 - Structure Detection
 *
 * Detects maps and reusable $defs to compress schema.
 */

import type {
    StatsField,
    StatsMultiTableSchema,
    FieldType,
    FieldRole,
    AggregationType,
    FieldFormat,
    NodeDef,
    ObjectNode,
    ArrayNode,
    FieldNode,
    MapNode,
    TypeDef,
} from './types.js';
import { getLeafName, getParentPath, getPathDepth } from './utils.js';

// ============================================================================
// Types
// ============================================================================

interface FieldShape {
    type: FieldType;
    role: FieldRole;
    aggregation: AggregationType;
    format?: FieldFormat;
    unit?: string;
    nullable?: boolean;
    itemType?: FieldType;
    itemFields?: StatsField[];
}

export interface DetectedMap {
    path: string;
    keys: string[];
    defName: string | null;
}

interface DetectedDef {
    name: string;
    shape: Map<string, FieldShape>;
    occurrences: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function fieldToShape(field: StatsField): FieldShape {
    return {
        type: field.type,
        role: field.role,
        aggregation: field.aggregation,
        ...(field.format && { format: field.format }),
        ...(field.unit && { unit: field.unit }),
        ...(field.nullable && { nullable: field.nullable }),
        ...(field.itemType && { itemType: field.itemType }),
        ...(field.itemFields && { itemFields: field.itemFields }),
    };
}

function shapeKey(shape: FieldShape): string {
    return `${shape.type}:${shape.role}:${shape.aggregation}`;
}

function groupKey(shapes: Map<string, FieldShape>): string {
    return [...shapes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, shape]) => `${name}=${shapeKey(shape)}`)
        .join('|');
}

// ============================================================================
// Map Detection
// ============================================================================

function groupByParent(fields: StatsField[]): Map<string, StatsField[]> {
    const groups = new Map<string, StatsField[]>();
    for (const field of fields) {
        const parent = getParentPath(field.path);
        const list = groups.get(parent) ?? [];
        list.push(field);
        groups.set(parent, list);
    }
    return groups;
}

function detectMaps(fields: StatsField[]): Map<string, DetectedMap> {
    const maps = new Map<string, DetectedMap>();
    const byParent = groupByParent(fields);

    const byGrandparent = new Map<string, string[]>();
    for (const parent of byParent.keys()) {
        const grandparent = getParentPath(parent);
        if (!grandparent) continue;
        const list = byGrandparent.get(grandparent) ?? [];
        list.push(parent);
        byGrandparent.set(grandparent, list);
    }

    for (const [grandparent, parents] of byGrandparent) {
        if (parents.length < 3) continue;

        const shapes = parents.map(parent => {
            const children = byParent.get(parent) ?? [];
            const shape = new Map<string, FieldShape>();
            for (const child of children) {
                if (getPathDepth(child.path) !== getPathDepth(parent) + 1) continue;
                shape.set(getLeafName(child.path), fieldToShape(child));
            }
            return { parent, shape };
        });

        if (shapes.length === 0) continue;
        const firstShape = shapes[0];
        if (!firstShape || firstShape.shape.size === 0) continue;

        const firstKey = groupKey(firstShape.shape);
        if (!shapes.every(s => groupKey(s.shape) === firstKey)) continue;

        maps.set(grandparent, {
            path: grandparent,
            keys: parents.map(p => getLeafName(p)).sort(),
            defName: null,
        });
    }

    return maps;
}

// ============================================================================
// $defs Detection
// ============================================================================

function detectDefs(
    fields: StatsField[],
    maps: Map<string, DetectedMap>
): { defs: Map<string, DetectedDef>; maps: Map<string, DetectedMap> } {
    const defs = new Map<string, DetectedDef>();
    const updatedMaps = new Map<string, DetectedMap>();
    const shapeGroups = new Map<string, { shape: Map<string, FieldShape>; paths: string[] }>();

    for (const [mapPath, map] of maps) {
        if (map.keys.length === 0) continue;

        const firstKeyPath = `${mapPath}.${map.keys[0]}`;
        const childFields = fields.filter(
            f => f.path.startsWith(firstKeyPath + '.') &&
                getPathDepth(f.path) === getPathDepth(firstKeyPath) + 1
        );

        if (childFields.length === 0) continue;

        const shape = new Map<string, FieldShape>();
        for (const field of childFields) {
            shape.set(getLeafName(field.path), fieldToShape(field));
        }

        const key = groupKey(shape);
        const existing = shapeGroups.get(key);
        if (existing) {
            existing.paths.push(mapPath);
        } else {
            shapeGroups.set(key, { shape, paths: [mapPath] });
        }
    }

    for (const { shape, paths } of shapeGroups.values()) {
        if (paths.length < 3) continue;

        const defName = inferDefName(shape);
        defs.set(defName, { name: defName, shape, occurrences: paths });

        for (const path of paths) {
            const map = maps.get(path);
            if (map) {
                updatedMaps.set(path, { ...map, defName });
            }
        }
    }

    for (const [path, map] of maps) {
        if (!updatedMaps.has(path)) {
            updatedMaps.set(path, map);
        }
    }

    return { defs, maps: updatedMaps };
}

function inferDefName(shape: Map<string, FieldShape>): string {
    const names = [...shape.keys()];
    if (names.includes('score') && names.includes('confidence')) {
        return names.includes('evidence') ? 'scored_assessment' : 'scored_metric';
    }
    if (names.includes('value') && names.includes('count')) return 'value_count';
    if (names.includes('id') && names.includes('name')) return 'named_entity';
    return `${names.slice(0, 2).join('_')}_item`;
}

// ============================================================================
// Node Building
// ============================================================================

function buildFieldNode(field: StatsField): FieldNode {
    return {
        type: field.type as FieldNode['type'],
        ...(field.role !== 'metadata' && { role: field.role }),
        ...(field.format && { format: field.format }),
        ...(field.unit && { unit: field.unit }),
        ...(field.aggregation !== 'none' && { aggregation: field.aggregation }),
        ...(field.nullable && { nullable: field.nullable }),
    };
}

function buildNodeFromField(field: StatsField): NodeDef {
    if (field.type === 'array') {
        if (field.itemFields && field.itemFields.length > 0) {
            const itemFields: Record<string, NodeDef> = {};
            for (const f of field.itemFields) {
                itemFields[getLeafName(f.path)] = buildNodeFromField(f);
            }
            return { type: 'array', items: { type: 'object', fields: itemFields } };
        }
        return { type: 'array', items: { type: field.itemType ?? 'string' } as FieldNode };
    }
    return buildFieldNode(field);
}

function buildTree(fields: StatsField[]): Map<string, { field?: StatsField; children: Set<string> }> {
    const tree = new Map<string, { field?: StatsField; children: Set<string> }>();
    tree.set('', { children: new Set() });

    for (const field of fields) {
        const parts = field.path.split('.');
        for (let i = 0; i < parts.length; i++) {
            const path = parts.slice(0, i + 1).join('.');
            const parent = parts.slice(0, i).join('.');

            if (!tree.has(path)) {
                tree.set(path, { children: new Set() });
            }
            tree.get(parent)!.children.add(path);

            if (i === parts.length - 1) {
                tree.get(path)!.field = field;
            }
        }
    }

    return tree;
}

function buildObjectNode(
    path: string,
    tree: Map<string, { field?: StatsField; children: Set<string> }>,
    maps: Map<string, DetectedMap>,
    fields: StatsField[]
): ObjectNode {
    const node = tree.get(path);
    const result: Record<string, NodeDef> = {};

    for (const childPath of node?.children ?? []) {
        const key = getLeafName(childPath);
        if (key === '[]') continue;

        const map = maps.get(childPath);
        if (map?.defName) {
            result[key] = { $ref: `#/$defs/${map.defName}`, keys: [...map.keys] };
            continue;
        }

        if (map) {
            const firstKey = map.keys[0];
            const firstKeyPath = `${childPath}.${firstKey}`;
            result[key] = {
                type: 'map',
                keys: [...map.keys],
                values: buildObjectNode(firstKeyPath, tree, maps, fields),
            } as MapNode;
            continue;
        }

        const childNode = tree.get(childPath);
        const field = childNode?.field;

        if (field?.type === 'array') {
            result[key] = buildNodeFromField(field) as ArrayNode;
        } else if (childNode && childNode.children.size > 0) {
            result[key] = buildObjectNode(childPath, tree, maps, fields);
        } else if (field) {
            result[key] = buildFieldNode(field);
        }
    }

    return { type: 'object', fields: result };
}

function buildTypeDef(def: DetectedDef): TypeDef {
    const fields: Record<string, NodeDef> = {};
    for (const [name, shape] of def.shape) {
        const field: StatsField = {
            path: name,
            type: shape.type,
            nullable: shape.nullable ?? false,
            role: shape.role,
            aggregation: shape.aggregation,
            ...(shape.format && { format: shape.format }),
            ...(shape.unit && { unit: shape.unit }),
            ...(shape.itemType && { itemType: shape.itemType }),
            ...(shape.itemFields && { itemFields: shape.itemFields }),
        };
        fields[name] = buildNodeFromField(field);
    }
    return { fields };
}

// ============================================================================
// Main Export
// ============================================================================

export interface StructureResult {
    defs: Record<string, TypeDef>;
    root: NodeDef;
    maps: Map<string, DetectedMap>;
    stats: {
        totalFields: number;
        defCount: number;
        mapCount: number;
        reductionPercent: number;
    };
}

export function detectStructure(stats: StatsMultiTableSchema): Map<string, StructureResult> {
    const results = new Map<string, StructureResult>();

    for (const [tableName, table] of Object.entries(stats.tables)) {
        const fields = [...table.fields];
        const initialMaps = detectMaps(fields);
        const { defs: detectedDefs, maps } = detectDefs(fields, initialMaps);

        const defs: Record<string, TypeDef> = {};
        for (const [name, def] of detectedDefs) {
            defs[name] = buildTypeDef(def);
        }

        const tree = buildTree(fields);
        const root = buildObjectNode('', tree, maps, fields);

        const totalFields = fields.length;
        const fieldsInDefs = [...detectedDefs.values()].reduce(
            (sum, d) => sum + d.shape.size * d.occurrences.length, 0
        );
        const uniqueFields = totalFields - fieldsInDefs +
            [...detectedDefs.values()].reduce((sum, d) => sum + d.shape.size, 0);

        results.set(tableName, {
            defs,
            root,
            maps,
            stats: {
                totalFields,
                defCount: detectedDefs.size,
                mapCount: maps.size,
                reductionPercent: totalFields > 0
                    ? Math.round((1 - uniqueFields / totalFields) * 100)
                    : 0,
            },
        });
    }

    return results;
}