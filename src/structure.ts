/**
 * SmartSchema v2 - Structure
 *
 * Converts stats to schema structure with:
 * - $defs for repeated structures
 * - Map detection for dynamic keys
 * - Smart naming for $defs
 *
 * IMPROVEMENTS:
 * - Intelligent $def naming based on field composition
 * - Common prefix extraction
 * - Role-based naming
 * - Semantic pattern detection
 */

import type {
    StatsField,
    StatsTableSchema,
    NodeDef,
    FieldNode,
    ObjectNode,
    ArrayNode,
    MapNode,
    RefNode,
    TypeDef,
    FieldRole,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

interface DefCandidate {
    signature: string;
    paths: string[];
    fields: StatsField[];
    keys: string[];
}

interface StructureResult {
    root: NodeDef;
    $defs: Record<string, TypeDef>;
}

// ============================================================================
// Smart $def Naming (NEW)
// ============================================================================

/**
 * Find common prefix among field names
 * e.g., ["min_price", "max_price", "avg_price"] → "price"
 */
function findCommonPrefix(fieldNames: string[]): string | null {
    if (fieldNames.length < 2) return null;

    // Try suffix-based (more common in schemas)
    // e.g., min_price, max_price → price
    const suffixes = fieldNames.map(name => {
        const parts = name.split('_');
        return parts.length > 1 ? parts.slice(1).join('_') : null;
    });

    if (suffixes.every(s => s && s === suffixes[0])) {
        return suffixes[0]!;
    }

    // Try prefix-based
    const prefixes = fieldNames.map(name => {
        const parts = name.split('_');
        return parts.length > 1 ? parts.slice(0, -1).join('_') : null;
    });

    if (prefixes.every(p => p && p === prefixes[0])) {
        return prefixes[0]!;
    }

    return null;
}

/**
 * Get dominant role in a set of fields
 */
function getDominantRole(fields: StatsField[]): FieldRole | null {
    const roleCounts = new Map<FieldRole, number>();

    for (const field of fields) {
        roleCounts.set(field.role, (roleCounts.get(field.role) ?? 0) + 1);
    }

    let maxRole: FieldRole | null = null;
    let maxCount = 0;

    for (const [role, count] of roleCounts) {
        if (count > maxCount) {
            maxCount = count;
            maxRole = role;
        }
    }

    // Only return if dominant (>50%)
    if (maxRole && maxCount > fields.length / 2) {
        return maxRole;
    }

    return null;
}

/**
 * Detect semantic patterns in field composition
 */
function detectSemanticPattern(fields: StatsField[]): string | null {
    const fieldNames = new Set(fields.map(f => f.path.split('.').pop()?.toLowerCase()));

    // Score + confidence pattern → "scored_metric" or "rating"
    if (fieldNames.has('score') && fieldNames.has('confidence')) {
        return 'scored_metric';
    }

    // ID + name pattern → "named_entity"
    const hasId = [...fieldNames].some(n => n?.endsWith('id') || n === 'id');
    const hasName = fieldNames.has('name') || fieldNames.has('title') || fieldNames.has('label');
    if (hasId && hasName) {
        return 'named_entity';
    }

    // Min/max/avg pattern → "range_metrics" or "statistics"
    if (fieldNames.has('min') && fieldNames.has('max')) {
        return 'range_metrics';
    }
    if ((fieldNames.has('min') || fieldNames.has('max')) && fieldNames.has('avg')) {
        return 'statistics';
    }

    // Start/end pattern → "time_range" or "period"
    if (fieldNames.has('start') && fieldNames.has('end')) {
        return 'time_range';
    }
    if (fieldNames.has('start_date') && fieldNames.has('end_date')) {
        return 'date_range';
    }

    // Lat/lng pattern → "coordinates" or "location"
    if ((fieldNames.has('lat') || fieldNames.has('latitude')) &&
        (fieldNames.has('lng') || fieldNames.has('longitude'))) {
        return 'coordinates';
    }

    // Width/height pattern → "dimensions"
    if (fieldNames.has('width') && fieldNames.has('height')) {
        return 'dimensions';
    }

    // Created/updated pattern → "timestamps"
    const timeFields = [...fieldNames].filter(n =>
        n?.includes('created') || n?.includes('updated') || n?.endsWith('_at')
    );
    if (timeFields.length >= 2) {
        return 'timestamps';
    }

    return null;
}

/**
 * Generate smart name for a $def based on its fields
 */
function generateDefName(fields: StatsField[], parentPath: string): string {
    const fieldNames = fields.map(f => f.path.split('.').pop() ?? f.path);

    // 1. Try semantic pattern detection
    const pattern = detectSemanticPattern(fields);
    if (pattern) {
        return pattern;
    }

    // 2. Try common prefix/suffix
    const common = findCommonPrefix(fieldNames);
    if (common) {
        const dominantRole = getDominantRole(fields);
        if (dominantRole === 'measure') {
            return `${common}_metrics`;
        }
        return `${common}_data`;
    }

    // 3. Try role-based naming
    const dominantRole = getDominantRole(fields);
    if (dominantRole) {
        const roleNames: Record<FieldRole, string> = {
            measure: 'metrics',
            dimension: 'attributes',
            identifier: 'keys',
            time: 'timestamps',
            text: 'content',
            metadata: 'metadata',
        };
        return roleNames[dominantRole];
    }

    // 4. Use parent path context
    if (parentPath) {
        const parentName = parentPath.split('.').pop()?.replace(/\[\]/g, '') ?? '';
        if (parentName && parentName !== 'root') {
            return `${parentName}_item`;
        }
    }

    // 5. Fallback: concatenate first two field names
    if (fieldNames.length >= 2) {
        return `${fieldNames[0]}_${fieldNames[1]}_group`;
    }

    return 'item';
}

// ============================================================================
// Signature Generation
// ============================================================================

function generateSignature(fields: StatsField[]): string {
    const sorted = [...fields].sort((a, b) => a.path.localeCompare(b.path));
    return sorted
        .map(f => `${f.path.split('.').pop()}:${f.type}${f.nullable ? '?' : ''}`)
        .join('|');
}

// ============================================================================
// Structure Building
// ============================================================================

function fieldToNode(field: StatsField): FieldNode {
    const node: FieldNode = {
        type: field.type,
        role: field.role,
        ...(field.nullable && { nullable: true }),
        ...(field.format && { format: field.format }),
        ...(field.unit && { unit: field.unit }),
        ...(field.aggregation !== 'none' && { aggregation: field.aggregation }),
    };
    return node;
}

function buildObjectNode(
    fields: StatsField[],
    prefix: string,
    $defs: Map<string, DefCandidate>,
    parentPath: string
): ObjectNode {
    const result: Record<string, NodeDef> = {};

    // Group fields by their immediate child key
    const groups = new Map<string, StatsField[]>();

    for (const field of fields) {
        const relativePath = prefix ? field.path.slice(prefix.length + 1) : field.path;
        const parts = relativePath.split('.');
        const key = parts[0];

        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(field);
    }

    for (const [key, groupFields] of groups) {
        const fieldPath = prefix ? `${prefix}.${key}` : key;

        // Find the field definition for this key
        const directField = groupFields.find(f => f.path === fieldPath);

        if (directField) {
            if (directField.type === 'array' && directField.itemFields) {
                // Array with object items
                const itemSig = generateSignature(directField.itemFields);

                if (!$defs.has(itemSig)) {
                    $defs.set(itemSig, {
                        signature: itemSig,
                        paths: [fieldPath],
                        fields: directField.itemFields,
                        keys: [],
                    });
                } else {
                    $defs.get(itemSig)!.paths.push(fieldPath);
                }

                result[key] = {
                    type: 'array',
                    items: { $ref: itemSig },
                } as ArrayNode;
            } else if (directField.type === 'array') {
                // Simple array
                result[key] = {
                    type: 'array',
                    items: { type: directField.itemType ?? 'string' } as FieldNode,
                } as ArrayNode;
            } else if (directField.type === 'object') {
                // Object field - check for nested fields and recurse
                const nestedFields = groupFields.filter(f =>
                    f.path !== fieldPath && f.path.startsWith(fieldPath + '.')
                );
                if (nestedFields.length > 0) {
                    // Has nested structure - build recursively
                    const nestedNode = buildObjectNode(nestedFields, fieldPath, $defs, fieldPath);
                    result[key] = {
                        ...nestedNode,
                        role: directField.role,
                    } as ObjectNode;
                } else {
                    // No nested structure - treat as opaque object
                    result[key] = fieldToNode(directField);
                }
            } else {
                // Scalar field
                result[key] = fieldToNode(directField);
            }
        } else {
            // Nested object
            const nestedFields = groupFields.filter(f => f.path.startsWith(fieldPath + '.'));
            if (nestedFields.length > 0) {
                result[key] = buildObjectNode(nestedFields, fieldPath, $defs, fieldPath);
            }
        }
    }

    return { type: 'object', fields: result };
}

// ============================================================================
// $def Resolution
// ============================================================================

function resolveRefs(
    node: NodeDef,
    defMap: Map<string, string>
): NodeDef {
    if ('$ref' in node) {
        const refNode = node as RefNode;
        const newName = defMap.get(refNode.$ref);
        if (newName) {
            return { ...refNode, $ref: newName };
        }
        return node;
    }

    if ('items' in node) {
        const arrayNode = node as ArrayNode;
        return {
            ...arrayNode,
            items: resolveRefs(arrayNode.items, defMap),
        };
    }

    if ('fields' in node) {
        const objNode = node as ObjectNode;
        const newFields: Record<string, NodeDef> = {};
        for (const [key, child] of Object.entries(objNode.fields)) {
            newFields[key] = resolveRefs(child, defMap);
        }
        return { ...objNode, fields: newFields };
    }

    return node;
}

// ============================================================================
// Main Export
// ============================================================================

export function buildStructure(schema: StatsTableSchema): StructureResult {
    const $defsMap = new Map<string, DefCandidate>();

    // Build initial structure
    const root = buildObjectNode(schema.fields, '', $defsMap, '');

    // Convert candidates to actual $defs with smart names
    const $defs: Record<string, TypeDef> = {};
    const signatureToName = new Map<string, string>();
    const usedNames = new Set<string>();

    for (const [signature, candidate] of $defsMap) {
        // Only create $def if used more than once OR has meaningful structure
        if (candidate.paths.length < 2 && candidate.fields.length < 3) {
            continue;
        }

        // Generate smart name
        let baseName = generateDefName(candidate.fields, candidate.paths[0]);

        // Ensure uniqueness
        let name = baseName;
        let counter = 1;
        while (usedNames.has(name)) {
            name = `${baseName}_${counter}`;
            counter++;
        }
        usedNames.add(name);
        signatureToName.set(signature, name);

        // Build the type definition
        const defFields: Record<string, NodeDef> = {};
        for (const field of candidate.fields) {
            const key = field.path.split('.').pop() ?? field.path;
            defFields[key] = fieldToNode(field);
        }

        $defs[name] = { fields: defFields };
    }

    // Resolve references to use new names
    const resolvedRoot = resolveRefs(root, signatureToName);

    return {
        root: resolvedRoot,
        $defs: Object.keys($defs).length > 0 ? $defs : {},
    };
}

/**
 * Detect if an object is actually a map (dynamic keys)
 */
export function detectMaps(
    node: NodeDef,
    samples: unknown[],
    path: string = ''
): NodeDef {
    // This is a simplified version - full implementation would analyze
    // key patterns across samples to detect true maps vs objects
    return node;
}