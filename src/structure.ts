/**
 * Structure Detection
 *
 * Builds a tree structure from flat stats and detects reusable $defs.
 * This runs BEFORE AI enrichment to minimize tokens sent to AI.
 */

import { LIMITS } from './constants.js';
import type {
    StatsMultiTableSchema,
    StatsField,
    FieldType,
    FieldRole,
    AggregationType,
    FieldFormat,
    NodeDef,
    FieldNode,
    ObjectNode,
    ArrayNode,
    MapNode,
    TypeDef,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface FieldShape {
    readonly type: FieldType;
    readonly role: FieldRole;
    readonly aggregation: AggregationType;
    readonly format?: FieldFormat;
    readonly unit?: string;
    readonly nullable?: boolean;
}

export interface DetectedDef {
    readonly name: string;
    readonly shape: ReadonlyMap<string, FieldShape>;
    readonly occurrences: readonly string[];  // Paths where this def appears
}

export interface DetectedMap {
    readonly path: string;
    readonly keys: readonly string[];
    readonly defName: string | null;
}

export interface StructureTree {
    readonly stats: StatsMultiTableSchema;
    readonly tree: ReadonlyMap<string, TreeNode>;  // Per table
    readonly defs: ReadonlyMap<string, DetectedDef>;
    readonly maps: ReadonlyMap<string, DetectedMap>;
}

export interface TreeNode {
    readonly path: string;
    readonly field?: StatsField;
    readonly children: Map<string, TreeNode>;
    readonly isArray: boolean;
    readonly isMap: boolean;
    readonly mapKeys?: readonly string[];
    readonly defRef?: string;
}

// ============================================================================
// Helpers
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
    return `${shape.type}:${shape.role}:${shape.aggregation}:${shape.format ?? ''}:${shape.unit ?? ''}`;
}

function fieldToShape(field: StatsField): FieldShape {
    return {
        type: field.type,
        role: field.role,
        aggregation: field.aggregation,
        ...(field.format && { format: field.format }),
        ...(field.unit && { unit: field.unit }),
        ...(field.nullable && { nullable: field.nullable }),
    };
}

function groupShapeKey(shapes: ReadonlyMap<string, FieldShape>): string {
    const entries = [...shapes.entries()].sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([name, shape]) => `${name}=${shapeKey(shape)}`).join('|');
}

// ============================================================================
// Build Tree from Flat Fields
// ============================================================================

function buildTreeFromFields(fields: readonly StatsField[]): TreeNode {
    const root: TreeNode = {
        path: '',
        children: new Map(),
        isArray: false,
        isMap: false,
    };

    for (const field of fields) {
        const parts = field.path.split('.');
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const isArrayNotation = part === '[]';

            if (!current.children.has(part)) {
                current.children.set(part, {
                    path: parts.slice(0, i + 1).join('.'),
                    children: new Map(),
                    isArray: isArrayNotation,
                    isMap: false,
                });
            }

            const child = current.children.get(part)!;

            if (isLast) {
                // Mutate to add field reference
                (child as { field?: StatsField }).field = field;
            }

            current = child;
        }
    }

    return root;
}

// ============================================================================
// Detect Maps (dynamic keys with same value structure)
// ============================================================================

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

function detectMaps(
    fields: readonly StatsField[],
    minKeys: number = LIMITS.minKeysForMap
): Map<string, DetectedMap> {
    const maps = new Map<string, DetectedMap>();
    const byParent = groupFieldsByParent(fields);

    // Group parents by grandparent
    const parentsByGrandparent = new Map<string, string[]>();
    for (const parent of byParent.keys()) {
        const grandparent = getParentPath(parent);
        if (!grandparent) continue;

        const existing = parentsByGrandparent.get(grandparent) ?? [];
        existing.push(parent);
        parentsByGrandparent.set(grandparent, existing);
    }

    // Find grandparents where all children have identical structure
    for (const [grandparent, parents] of parentsByGrandparent) {
        if (parents.length < minKeys) continue;

        // Get shape of each parent's children
        const shapes = parents.map(parent => {
            const children = byParent.get(parent) ?? [];
            const shape = new Map<string, FieldShape>();
            for (const child of children) {
                const leafName = getLeafName(child.path);
                shape.set(leafName, fieldToShape(child));
            }
            return { parent, shape };
        });

        // Check if all shapes match
        const firstKey = groupShapeKey(shapes[0].shape);
        const allMatch = shapes.every(s => groupShapeKey(s.shape) === firstKey);

        if (!allMatch) continue;

        const keys = parents.map(p => getLeafName(p)).sort();

        maps.set(grandparent, {
            path: grandparent,
            keys,
            defName: null,  // Will be set after def detection
        });
    }

    return maps;
}

// ============================================================================
// Detect $defs (reusable shapes)
// ============================================================================

function detectDefs(
    fields: readonly StatsField[],
    maps: Map<string, DetectedMap>,
    minOccurrences: number = LIMITS.minSiblingsForArchetype
): Map<string, DetectedDef> {
    const defs = new Map<string, DetectedDef>();
    const shapeToOccurrences = new Map<string, { shape: Map<string, FieldShape>; paths: string[] }>();

    // Collect shapes from map value structures
    for (const [mapPath, map] of maps) {
        if (map.keys.length === 0) continue;

        // Get the shape from first key's children
        const firstKeyPath = `${mapPath}.${map.keys[0]}`;
        const childFields = fields.filter(f =>
            f.path.startsWith(firstKeyPath + '.') &&
            getPathDepth(f.path) === getPathDepth(firstKeyPath) + 1
        );

        if (childFields.length === 0) continue;

        const shape = new Map<string, FieldShape>();
        for (const field of childFields) {
            const leafName = getLeafName(field.path);
            shape.set(leafName, fieldToShape(field));
        }

        const key = groupShapeKey(shape);

        if (shapeToOccurrences.has(key)) {
            shapeToOccurrences.get(key)!.paths.push(mapPath);
        } else {
            shapeToOccurrences.set(key, { shape, paths: [mapPath] });
        }
    }

    // Create defs for shapes with enough occurrences
    for (const [, { shape, paths }] of shapeToOccurrences) {
        if (paths.length < minOccurrences) continue;

        const defName = inferDefName(shape);

        defs.set(defName, {
            name: defName,
            shape,
            occurrences: paths,
        });

        // Update maps to reference this def
        for (const path of paths) {
            const map = maps.get(path);
            if (map) {
                maps.set(path, { ...map, defName });
            }
        }
    }

    return defs;
}

function inferDefName(shape: ReadonlyMap<string, FieldShape>): string {
    const fieldNames = [...shape.keys()];

    // Common patterns
    if (fieldNames.includes('score') && fieldNames.includes('confidence')) {
        if (fieldNames.includes('evidence')) return 'scored_assessment';
        return 'scored_metric';
    }

    if (fieldNames.includes('value') && fieldNames.includes('count')) {
        return 'value_count';
    }

    if (fieldNames.includes('id') && fieldNames.includes('name')) {
        return 'named_entity';
    }

    // Generate from field names
    const prefix = fieldNames.slice(0, 2).join('_');
    return `${prefix}_item`;
}

// ============================================================================
// Build NodeDef from Tree
// ============================================================================

function buildNodeDef(
    node: TreeNode,
    allFields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>,
    defs: ReadonlyMap<string, DetectedDef>
): NodeDef {
    const field = node.field;

    // Leaf field
    if (field && node.children.size === 0) {
        return buildFieldNode(field);
    }

    // Array
    if (node.isArray || field?.type === 'array') {
        return buildArrayNode(node, allFields, maps, defs);
    }

    // Check if this is a map
    const map = maps.get(node.path);
    if (map) {
        return buildMapNode(node, map, allFields, maps, defs);
    }

    // Object
    return buildObjectNode(node, allFields, maps, defs);
}

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

function buildObjectNode(
    node: TreeNode,
    allFields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>,
    defs: ReadonlyMap<string, DetectedDef>
): ObjectNode {
    const fields: Record<string, NodeDef> = {};

    for (const [key, child] of node.children) {
        if (key === '[]') continue;  // Skip array notation

        // Check if this child should be a $ref
        const map = maps.get(child.path);
        if (map?.defName) {
            fields[key] = {
                $ref: `#/$defs/${map.defName}`,
                keys: map.keys,
            };
            continue;
        }

        fields[key] = buildNodeDef(child, allFields, maps, defs);
    }

    return {
        type: 'object',
        fields,
    };
}

function buildArrayNode(
    node: TreeNode,
    allFields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>,
    defs: ReadonlyMap<string, DetectedDef>
): ArrayNode {
    // Find array items (children under [])
    const arrayChild = node.children.get('[]');

    if (!arrayChild) {
        // Simple array of primitives
        const field = node.field;
        return {
            type: 'array',
            items: { type: field?.itemType ?? 'string' } as FieldNode,
        };
    }

    // Array of objects - check if it has real children (not just [] notation)
    if (arrayChild.children.size === 0) {
        const field = node.field;
        return {
            type: 'array',
            items: { type: field?.itemType ?? 'string' } as FieldNode,
        };
    }

    // Check if the children are all [] (nested arrays) or real object fields
    const hasRealFields = [...arrayChild.children.keys()].some(k => k !== '[]');

    if (!hasRealFields) {
        // Nested array
        return {
            type: 'array',
            items: buildArrayNode(arrayChild, allFields, maps, defs),
        };
    }

    // Array of objects
    return {
        type: 'array',
        items: buildObjectNode(arrayChild, allFields, maps, defs),
    };
}

function buildMapNode(
    node: TreeNode,
    map: DetectedMap,
    allFields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>,
    defs: ReadonlyMap<string, DetectedDef>
): MapNode {
    // Get value structure from first key
    const firstKeyChild = node.children.get(map.keys[0]);

    let values: NodeDef | string;

    if (map.defName) {
        values = `#/$defs/${map.defName}`;
    } else if (firstKeyChild) {
        values = buildNodeDef(firstKeyChild, allFields, maps, defs);
    } else {
        values = { type: 'object', fields: {} };
    }

    return {
        type: 'map',
        keys: map.keys,
        values,
    };
}

// ============================================================================
// Build TypeDef from DetectedDef
// ============================================================================

function buildTypeDef(def: DetectedDef): TypeDef {
    const fields: Record<string, NodeDef> = {};

    for (const [name, shape] of def.shape) {
        fields[name] = {
            type: shape.type as FieldNode['type'],
            ...(shape.role !== 'metadata' && { role: shape.role }),
            ...(shape.format && { format: shape.format }),
            ...(shape.unit && { unit: shape.unit }),
            ...(shape.aggregation !== 'none' && { aggregation: shape.aggregation }),
            ...(shape.nullable && { nullable: shape.nullable }),
        };
    }

    return { fields };
}

// ============================================================================
// Main Export
// ============================================================================

export interface StructureResult {
    readonly defs: Record<string, TypeDef>;
    readonly root: NodeDef;
    readonly maps: ReadonlyMap<string, DetectedMap>;
    readonly stats: {
        readonly totalFields: number;
        readonly uniqueFields: number;
        readonly defCount: number;
        readonly mapCount: number;
        readonly reductionPercent: number;
    };
}

export function detectStructure(stats: StatsMultiTableSchema): Map<string, StructureResult> {
    const results = new Map<string, StructureResult>();

    for (const [tableName, table] of Object.entries(stats.tables)) {
        const fields = table.fields;

        // Detect maps (dynamic key objects)
        const maps = detectMaps(fields);

        // Detect reusable defs
        const detectedDefs = detectDefs(fields, maps);

        // Build tree
        const tree = buildTreeFromFields(fields);

        // Convert defs
        const defs: Record<string, TypeDef> = {};
        for (const [name, def] of detectedDefs) {
            defs[name] = buildTypeDef(def);
        }

        // Build root node
        const root = buildObjectNode(tree, fields, maps, detectedDefs);

        // Calculate stats
        const totalFields = fields.length;
        const fieldsInDefs = [...detectedDefs.values()].reduce(
            (sum, def) => sum + def.shape.size * def.occurrences.length,
            0
        );
        const uniqueFields = totalFields - fieldsInDefs + [...detectedDefs.values()].reduce(
            (sum, def) => sum + def.shape.size,
            0
        );
        const reductionPercent = Math.round((1 - uniqueFields / totalFields) * 100);

        results.set(tableName, {
            defs,
            root,
            maps,
            stats: {
                totalFields,
                uniqueFields,
                defCount: detectedDefs.size,
                mapCount: maps.size,
                reductionPercent,
            },
        });
    }

    return results;
}