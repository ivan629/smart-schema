/**
 * Structure Module - Schema Structure Detection
 *
 * Detects structural patterns in stats output:
 * - Maps (objects with dynamic keys sharing same structure)
 * - $defs (reusable type definitions)
 * - Builds final schema tree with $ref references
 */

import type {
    StatsField,
    StatsTableSchema,
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

// ============================================================================
// Constants
// ============================================================================

const LIMITS = {
    minKeysForMap: 3,
    minSiblingsForArchetype: 3,
} as const;

// ============================================================================
// Types
// ============================================================================

interface FieldShape {
    readonly type: FieldType;
    readonly role: FieldRole;
    readonly aggregation: AggregationType;
    readonly format?: FieldFormat;
    readonly unit?: string;
    readonly nullable?: boolean;
    readonly itemType?: FieldType;
    readonly itemFields?: readonly StatsField[];
}

interface DetectedDef {
    readonly name: string;
    readonly shape: ReadonlyMap<string, FieldShape>;
    readonly occurrences: readonly string[];
}

interface DetectedMap {
    readonly path: string;
    readonly keys: readonly string[];
    defName: string | null;
}

interface TreeNode {
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
    return `${shape.type}:${shape.role}:${shape.aggregation}:${shape.format ?? ''}:${shape.unit ?? ''}`;
}

function groupShapeKey(shapes: ReadonlyMap<string, FieldShape>): string {
    const entries = [...shapes.entries()].sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([name, shape]) => `${name}=${shapeKey(shape)}`).join('|');
}

// ============================================================================
// Tree Building
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
            const currentPath = parts.slice(0, i + 1).join('.');

            if (!current.children.has(part)) {
                current.children.set(part, {
                    path: currentPath,
                    children: new Map(),
                    isArray: part === '[]' || field.type === 'array' && i === parts.length - 1,
                    isMap: false,
                });
            }

            const child = current.children.get(part)!;

            // Attach field data at the leaf
            if (i === parts.length - 1) {
                (child as { field?: StatsField }).field = field;
            }

            current = child;
        }
    }

    return root;
}

// ============================================================================
// Map Detection
// ============================================================================

function groupFieldsByParent(fields: readonly StatsField[]): Map<string, StatsField[]> {
    const groups = new Map<string, StatsField[]>();

    for (const field of fields) {
        const parent = getParentPath(field.path);
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
                if (getPathDepth(child.path) !== getPathDepth(parent) + 1) continue;
                const leafName = getLeafName(child.path);
                shape.set(leafName, fieldToShape(child));
            }
            return { parent, shape };
        });

        // Check if all shapes match
        if (shapes.length === 0 || shapes[0].shape.size === 0) continue;

        const firstKey = groupShapeKey(shapes[0].shape);
        const allMatch = shapes.every(s => groupShapeKey(s.shape) === firstKey);

        if (!allMatch) continue;

        const keys = parents.map(p => getLeafName(p)).sort();

        maps.set(grandparent, {
            path: grandparent,
            keys,
            defName: null,
        });
    }

    return maps;
}

// ============================================================================
// $defs Detection
// ============================================================================

function detectDefs(
    fields: readonly StatsField[],
    maps: Map<string, DetectedMap>,
    minOccurrences: number = LIMITS.minSiblingsForArchetype
): Map<string, DetectedDef> {
    const defs = new Map<string, DetectedDef>();
    const shapeToOccurrences = new Map<string, {
        shape: Map<string, FieldShape>;
        paths: string[];
        allFieldsByName: Map<string, StatsField[]>;
    }>();

    // Collect shapes from map value structures
    for (const [mapPath, map] of maps) {
        if (map.keys.length === 0) continue;

        const firstKeyPath = `${mapPath}.${map.keys[0]}`;
        const childFields = fields.filter(f =>
            f.path.startsWith(firstKeyPath + '.') &&
            getPathDepth(f.path) === getPathDepth(firstKeyPath) + 1
        );

        if (childFields.length === 0) continue;

        const shape = new Map<string, FieldShape>();
        const fieldsByName = new Map<string, StatsField[]>();

        for (const field of childFields) {
            const leafName = getLeafName(field.path);
            shape.set(leafName, fieldToShape(field));
            fieldsByName.set(leafName, [field]);
        }

        const key = groupShapeKey(shape);

        if (shapeToOccurrences.has(key)) {
            const existing = shapeToOccurrences.get(key)!;
            existing.paths.push(mapPath);
            for (const [name, fieldList] of fieldsByName) {
                const existingList = existing.allFieldsByName.get(name) ?? [];
                existingList.push(...fieldList);
                existing.allFieldsByName.set(name, existingList);
            }
        } else {
            shapeToOccurrences.set(key, { shape, paths: [mapPath], allFieldsByName: fieldsByName });
        }
    }

    // Create defs for shapes with enough occurrences
    for (const [, { shape, paths, allFieldsByName }] of shapeToOccurrences) {
        if (paths.length < minOccurrences) continue;

        // Enrich array fields with itemFields from any occurrence that has them
        const enrichedShape = new Map<string, FieldShape>();
        for (const [name, baseShape] of shape) {
            if (baseShape.type === 'array') {
                const allFields = allFieldsByName.get(name) ?? [];
                // Search across all keys in all maps for this field
                for (const mapPath of paths) {
                    const map = maps.get(mapPath);
                    if (!map) continue;
                    for (const key of map.keys) {
                        const fieldPath = `${mapPath}.${key}.${name}`;
                        const field = fields.find(f => f.path === fieldPath);
                        if (field && !allFields.includes(field)) {
                            allFields.push(field);
                        }
                    }
                }

                const fieldWithItems = allFields.find(f => f.itemFields && f.itemFields.length > 0);
                if (fieldWithItems) {
                    enrichedShape.set(name, fieldToShape(fieldWithItems));
                } else {
                    enrichedShape.set(name, baseShape);
                }
            } else {
                enrichedShape.set(name, baseShape);
            }
        }

        const defName = inferDefName(enrichedShape);

        defs.set(defName, {
            name: defName,
            shape: enrichedShape,
            occurrences: paths,
        });

        // Update maps to reference this def
        for (const path of paths) {
            const map = maps.get(path);
            if (map) {
                map.defName = defName;
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
// Node Building
// ============================================================================

/**
 * Build a NodeDef from a StatsField, handling arrays recursively
 */
function buildNodeDefFromStatsField(field: StatsField): NodeDef {
    if (field.type === 'array') {
        // Check for nested array (single itemField with path '[]' and type 'array')
        if (field.itemFields?.length === 1 && field.itemFields[0].path === '[]' && field.itemFields[0].type === 'array') {
            return {
                type: 'array',
                items: buildNodeDefFromStatsField(field.itemFields[0]),
            } as ArrayNode;
        }

        // Array of objects with itemFields
        if (field.itemFields && field.itemFields.length > 0) {
            const itemObject: ObjectNode = {
                type: 'object',
                fields: {},
            };

            for (const itemField of field.itemFields) {
                const leafName = getLeafName(itemField.path);
                (itemObject.fields as Record<string, NodeDef>)[leafName] = buildNodeDefFromStatsField(itemField);
            }

            return {
                type: 'array',
                items: itemObject,
            } as ArrayNode;
        }

        // Simple array of primitives
        return {
            type: 'array',
            items: { type: field.itemType ?? 'string' } as FieldNode,
        } as ArrayNode;
    }

    // Non-array field
    return buildFieldNode(field);
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

function buildNodeDef(
    node: TreeNode,
    allFields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>,
    defs: ReadonlyMap<string, DetectedDef>
): NodeDef {
    const field = node.field;

    // Check if this is a map
    const map = maps.get(node.path);
    if (map) {
        return buildMapNode(node, map, allFields, maps, defs);
    }

    // Check if this is an array (before leaf check)
    if (field?.type === 'array') {
        return buildArrayNode(node, allFields, maps, defs);
    }

    // Leaf field
    if (field && node.children.size === 0) {
        return buildFieldNode(field);
    }

    // Object with children
    if (node.children.size > 0) {
        return buildObjectNode(node, allFields, maps, defs);
    }

    // Fallback
    if (field) {
        return buildFieldNode(field);
    }

    return { type: 'object', fields: {} };
}

function buildObjectNode(
    node: TreeNode,
    allFields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>,
    defs: ReadonlyMap<string, DetectedDef>
): ObjectNode {
    const fields: Record<string, NodeDef> = {};

    for (const [key, child] of node.children) {
        if (key === '[]') continue;

        // Check if this child should be a $ref
        const map = maps.get(child.path);
        if (map?.defName) {
            fields[key] = {
                $ref: `#/$defs/${map.defName}`,
                keys: [...map.keys],
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
    const arrayChild = node.children.get('[]');
    const field = node.field;

    // Use itemFields from stats if available
    if (field?.itemFields && field.itemFields.length > 0) {
        // Check for nested array
        if (field.itemFields.length === 1 && field.itemFields[0].path === '[]' && field.itemFields[0].type === 'array') {
            return {
                type: 'array',
                items: buildNodeDefFromStatsField(field.itemFields[0]),
            };
        }

        // Build object from itemFields
        const itemObject: ObjectNode = {
            type: 'object',
            fields: {},
        };

        for (const itemField of field.itemFields) {
            const leafName = getLeafName(itemField.path);
            (itemObject.fields as Record<string, NodeDef>)[leafName] = buildNodeDefFromStatsField(itemField);
        }

        return {
            type: 'array',
            items: itemObject,
        };
    }

    // Simple array of primitives
    if (!arrayChild) {
        const itemType = field?.itemType ?? 'string';
        return {
            type: 'array',
            items: { type: itemType } as FieldNode,
        };
    }

    // Array with tree children
    if (arrayChild.children.size === 0) {
        const itemType = field?.itemType ?? arrayChild.field?.type ?? 'object';
        return {
            type: 'array',
            items: { type: itemType } as FieldNode,
        };
    }

    // Array of complex objects
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
    const firstKey = map.keys[0];
    const firstKeyNode = node.children.get(firstKey);

    let values: NodeDef;
    if (map.defName) {
        values = {
            $ref: `#/$defs/${map.defName}`,
        };
    } else if (firstKeyNode) {
        values = buildObjectNode(firstKeyNode, allFields, maps, defs);
    } else {
        values = { type: 'object', fields: {} };
    }

    return {
        type: 'map',
        keys: [...map.keys],
        values,
    };
}

function buildTypeDef(def: DetectedDef): TypeDef {
    const fields: Record<string, NodeDef> = {};

    for (const [name, shape] of def.shape) {
        const pseudoField: StatsField = {
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

        fields[name] = buildNodeDefFromStatsField(pseudoField);
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

        // Detect maps and defs
        const maps = detectMaps(fields);
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

        results.set(tableName, {
            defs,
            root,
            maps,
            stats: {
                totalFields,
                uniqueFields,
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

export type { DetectedMap, DetectedDef, TreeNode };