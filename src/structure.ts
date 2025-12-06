/**
 * SmartSchema v2 - Structure
 *
 * Converts stats to schema structure with:
 * - $defs for repeated structures
 * - Map detection for dynamic keys
 * - Smart naming for $defs
 *
 * IMPROVEMENTS:
 * - Semantic pattern detection from constants.ts
 * - Intelligent $def naming based on field composition
 * - Common prefix extraction
 * - Role-based naming fallback
 * - Map detection for dynamic key objects
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
import {
    SEMANTIC_DEF_PATTERNS,
    ROLE_DEF_NAMES,
    ID_FIELD_PATTERNS,
    NAME_FIELD_PATTERNS,
    MAP_KEY_PATTERNS,
    MAP_DETECTION_THRESHOLD,
    NON_MAP_OBJECT_NAMES,
    MIN_SEMANTIC_MATCH_SCORE,
    REQUIRED_FIELD_SCORE_WEIGHT,
    EXTRA_FIELD_PENALTY,
    MAP_KEY_MATCH_RATIO,
    MIN_KEYS_FOR_VARIANCE_CHECK,
    MAX_KEY_LENGTH_VARIANCE,
    MIN_DEF_REUSE_COUNT,
    MIN_DEF_FIELD_COUNT,
    MAP_KEY_RATIO_THRESHOLD,
    type SemanticDefPattern,
} from './constants.js';

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
// Smart $def Naming
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
 * Check if field name matches ID patterns
 */
function isIdField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    return ID_FIELD_PATTERNS.some(p =>
        lower === p || lower.endsWith('_' + p) || lower.endsWith(p)
    );
}

/**
 * Check if field name matches name/label patterns
 */
function isNameField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    return NAME_FIELD_PATTERNS.some(p =>
        lower === p || lower.includes(p)
    );
}

/**
 * Detect semantic patterns in field composition using SEMANTIC_DEF_PATTERNS.
 * Returns the best matching pattern name or null.
 */
function detectSemanticPattern(fields: StatsField[]): string | null {
    const fieldNames = new Set(
        fields.map(f => f.path.split('.').pop()?.toLowerCase() ?? '')
    );

    let bestMatch: { name: string; score: number } | null = null;

    for (const pattern of SEMANTIC_DEF_PATTERNS) {
        // Check if all required fields are present
        const hasAllRequired = pattern.requiredFields.every(req =>
            fieldNames.has(req.toLowerCase())
        );

        if (!hasAllRequired) continue;

        // Check exclusions
        if (pattern.excludeFields) {
            const hasExcluded = pattern.excludeFields.some(exc =>
                fieldNames.has(exc.toLowerCase())
            );
            if (hasExcluded) continue;
        }

        // Calculate match score
        let score = pattern.requiredFields.length * REQUIRED_FIELD_SCORE_WEIGHT;  // Base score from required

        // Bonus for optional fields present
        if (pattern.optionalFields) {
            const optionalMatches = pattern.optionalFields.filter(opt =>
                fieldNames.has(opt.toLowerCase())
            ).length;
            score += optionalMatches;
        }

        // Penalty for extra fields not in pattern
        const patternFields = new Set([
            ...pattern.requiredFields,
            ...(pattern.optionalFields ?? []),
        ].map(f => f.toLowerCase()));

        const extraFields = [...fieldNames].filter(f => !patternFields.has(f)).length;
        score -= extraFields * EXTRA_FIELD_PENALTY;

        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { name: pattern.name, score };
        }
    }

    // Only return if we have a reasonable match
    if (bestMatch && bestMatch.score >= MIN_SEMANTIC_MATCH_SCORE) {
        return bestMatch.name;
    }

    // Fallback: check for ID + name pattern (very common)
    const hasId = [...fieldNames].some(isIdField);
    const hasName = [...fieldNames].some(isNameField);
    if (hasId && hasName) {
        return 'named_entity';
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

    // 3. Try role-based naming using ROLE_DEF_NAMES
    const dominantRole = getDominantRole(fields);
    if (dominantRole && ROLE_DEF_NAMES[dominantRole]) {
        return ROLE_DEF_NAMES[dominantRole];
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
        const name1 = fieldNames[0].replace(/_/g, '');
        const name2 = fieldNames[1].replace(/_/g, '');
        return `${name1}_${name2}`;
    }

    return 'item';
}

// ============================================================================
// Map Detection
// ============================================================================

/**
 * Check if a set of keys looks like dynamic map keys
 */
function looksLikeMapKeys(keys: string[]): boolean {
    if (keys.length < MAP_DETECTION_THRESHOLD) {
        return false;
    }

    // Check if all keys match one of the map key patterns
    const matchCount = keys.filter(key =>
        MAP_KEY_PATTERNS.some(pattern => pattern.test(key))
    ).length;

    // If most keys match a pattern, it's likely a map
    if (matchCount >= keys.length * MAP_KEY_MATCH_RATIO) {
        return true;
    }

    // Check if keys have similar structure (same character composition)
    const keyLengths = keys.map(k => k.length);
    const avgLength = keyLengths.reduce((a, b) => a + b, 0) / keyLengths.length;
    const lengthVariance = keyLengths.reduce((sum, len) =>
        sum + Math.pow(len - avgLength, 2), 0
    ) / keyLengths.length;

    // Low variance in length + many keys = likely a map
    if (keys.length >= MIN_KEYS_FOR_VARIANCE_CHECK && lengthVariance < MAX_KEY_LENGTH_VARIANCE) {
        return true;
    }

    return false;
}

/**
 * Check if an object name suggests it should NOT be a map
 */
function isKnownObjectType(name: string): boolean {
    const lower = name.toLowerCase();
    return NON_MAP_OBJECT_NAMES.some(known =>
        lower === known || lower.endsWith('_' + known)
    );
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

export interface BuildStructureOptions {
    /** Enable map detection for dynamic key objects */
    detectMaps?: boolean;
    /** Sample data for more accurate map detection */
    samples?: unknown[];
}

export function buildStructure(
    schema: StatsTableSchema,
    options: BuildStructureOptions = {}
): StructureResult {
    const { detectMaps: shouldDetectMaps = true, samples } = options;
    const $defsMap = new Map<string, DefCandidate>();

    // Build initial structure
    let root = buildObjectNode(schema.fields, '', $defsMap, '');

    // Convert candidates to actual $defs with smart names
    const $defs: Record<string, TypeDef> = {};
    const signatureToName = new Map<string, string>();
    const usedNames = new Set<string>();

    for (const [signature, candidate] of $defsMap) {
        // Only create $def if used more than once OR has meaningful structure
        if (candidate.paths.length < MIN_DEF_REUSE_COUNT && candidate.fields.length < MIN_DEF_FIELD_COUNT) {
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
    root = resolveRefs(root, signatureToName) as ObjectNode;

    // Optionally detect maps
    if (shouldDetectMaps) {
        if (samples && samples.length > 0) {
            // Use sample data for more accurate detection
            root = detectMapsFromSamples(root, samples[0], '') as ObjectNode;
        } else {
            // Fall back to key-pattern based detection
            root = detectMaps(root, [], '') as ObjectNode;
        }
    }

    return {
        root,
        $defs: Object.keys($defs).length > 0 ? $defs : {},
    };
}

/**
 * Detect if an object is actually a map (dynamic keys).
 * Analyzes the keys and their values to determine if this is
 * a true map vs a structured object.
 */
export function detectMaps(
    node: NodeDef,
    samples: unknown[],
    path: string = ''
): NodeDef {
    // Handle object nodes
    if ('fields' in node) {
        const objNode = node as ObjectNode;
        const keys = Object.keys(objNode.fields);
        const nodeName = path.split('.').pop() ?? '';

        // Skip if this is a known object type
        if (!isKnownObjectType(nodeName)) {
            // Check if keys look like dynamic map keys
            if (looksLikeMapKeys(keys)) {
                // Verify all values have similar structure
                const signatures = new Set<string>();

                for (const [, child] of Object.entries(objNode.fields)) {
                    if ('type' in child) {
                        signatures.add((child as FieldNode).type);
                    } else if ('fields' in child) {
                        const childKeys = Object.keys((child as ObjectNode).fields).sort().join(',');
                        signatures.add(`object:${childKeys}`);
                    }
                }

                // If all values have same structure, convert to map
                if (signatures.size === 1) {
                    const firstChild = Object.values(objNode.fields)[0];
                    const mapNode: MapNode = {
                        type: 'map',
                        keys: { type: 'string' } as FieldNode,
                        values: detectMaps(firstChild, samples, `${path}.*`),
                    };
                    return mapNode;
                }
            }
        }

        // Recurse into children
        const newFields: Record<string, NodeDef> = {};
        for (const [key, child] of Object.entries(objNode.fields)) {
            newFields[key] = detectMaps(child, samples, path ? `${path}.${key}` : key);
        }
        return { ...objNode, fields: newFields };
    }

    // Handle array nodes
    if ('items' in node) {
        const arrayNode = node as ArrayNode;
        return {
            ...arrayNode,
            items: detectMaps(arrayNode.items, samples, `${path}[]`),
        };
    }

    return node;
}

/**
 * Detect maps by analyzing sample data directly.
 * This is more accurate than key pattern matching alone.
 */
export function detectMapsFromSamples(
    node: NodeDef,
    sampleData: unknown,
    path: string = ''
): NodeDef {
    if (sampleData === null || sampleData === undefined) {
        return node;
    }

    // Handle object nodes
    if ('fields' in node && typeof sampleData === 'object' && !Array.isArray(sampleData)) {
        const objNode = node as ObjectNode;
        const nodeName = path.split('.').pop() ?? '';
        const dataKeys = Object.keys(sampleData as object);

        // Skip if this is a known object type
        if (!isKnownObjectType(nodeName)) {
            // Check if we have more keys in data than in schema (dynamic)
            const schemaKeys = Object.keys(objNode.fields);

            if (dataKeys.length > schemaKeys.length * MAP_KEY_RATIO_THRESHOLD ||
                (dataKeys.length >= MAP_DETECTION_THRESHOLD && looksLikeMapKeys(dataKeys))) {

                // Get value structures
                const valueTypes = new Set<string>();
                for (const key of dataKeys) {
                    const value = (sampleData as Record<string, unknown>)[key];
                    if (value === null || value === undefined) continue;

                    if (typeof value === 'object' && !Array.isArray(value)) {
                        const objKeys = Object.keys(value).sort().join(',');
                        valueTypes.add(`object:${objKeys}`);
                    } else {
                        valueTypes.add(typeof value);
                    }
                }

                // If consistent value types, it's a map
                if (valueTypes.size === 1) {
                    // Find a representative child from schema or create one
                    const firstSchemaChild = Object.values(objNode.fields)[0];
                    if (firstSchemaChild) {
                        const mapNode: MapNode = {
                            type: 'map',
                            keys: { type: 'string' } as FieldNode,
                            values: firstSchemaChild,
                        };
                        return mapNode;
                    }
                }
            }
        }

        // Recurse into children
        const newFields: Record<string, NodeDef> = {};
        for (const [key, child] of Object.entries(objNode.fields)) {
            const childData = (sampleData as Record<string, unknown>)[key];
            newFields[key] = detectMapsFromSamples(child, childData, path ? `${path}.${key}` : key);
        }
        return { ...objNode, fields: newFields };
    }

    // Handle arrays
    if ('items' in node && Array.isArray(sampleData)) {
        const arrayNode = node as ArrayNode;
        const firstItem = sampleData[0];
        return {
            ...arrayNode,
            items: detectMapsFromSamples(arrayNode.items, firstItem, `${path}[]`),
        };
    }

    return node;
}