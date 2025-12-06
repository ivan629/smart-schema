/**
 * SmartSchema v2 - Capabilities
 *
 * Extracts semantic capabilities from stats:
 * - Measures: fields that can be summed/averaged
 * - Dimensions: fields to group by
 * - Identifiers: unique keys
 * - Time fields: for filtering/trending
 * - Entities: detected domain objects
 *
 * DESIGN PRINCIPLES:
 * - No hardcoded entity lists - works with any domain
 * - Name-based entity detection (not role-dependent)
 * - Supports all naming conventions (snake, camel, kebab, UPPER)
 * - Preserves data order (first entity = primary)
 */

import type { StatsField, Capabilities, Entity } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert any case to PascalCase
 * Examples:
 *   "customer" → "Customer"
 *   "order_item" → "OrderItem"
 *   "user-profile" → "UserProfile"
 */
function toPascalCase(str: string): string {
    return str
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

/**
 * Extract entity name from field path by NAME pattern
 * Works with any naming convention - does NOT depend on role classification
 *
 * Examples:
 *   "customer_id" → "Customer"
 *   "userId" → "User"
 *   "order-id" → "Order"
 *   "ORDER_ID" → "Order"
 *   "user.id" → "User" (from parent)
 */
function extractEntityName(path: string): string | null {
    const leaf = path.split('.').pop() ?? path;

    // All common ID naming patterns
    const patterns = [
        /^(.+?)_id$/i,      // snake_case: customer_id, CUSTOMER_ID
        /^(.+?)-id$/i,      // kebab-case: customer-id
        /^(.+?)Id$/,        // camelCase: customerId
        /^(.+?)ID$/,        // mixed: customerID
    ];

    for (const pattern of patterns) {
        const match = leaf.match(pattern);
        if (match?.[1]) {
            const raw = match[1];
            // Skip too-short matches (likely just "id" variants)
            if (raw.length < 2) continue;
            return toPascalCase(raw);
        }
    }

    // Handle standalone "id" → derive from parent path
    if (leaf.toLowerCase() === 'id') {
        const parts = path.split('.');
        const parent = parts[parts.length - 2];
        if (parent && parent !== '[]') {
            return toPascalCase(parent);
        }
    }

    return null;
}

/**
 * Check if a field name looks like an ID field (by pattern, not role)
 */
function isIdFieldByName(path: string): boolean {
    const leaf = path.split('.').pop() ?? path;
    return /(_id|Id|ID|-id)$/.test(leaf) || leaf.toLowerCase() === 'id';
}

/**
 * Find a likely name/label field for an entity
 * Prioritizes entity-specific patterns, then generic patterns
 */
function findNameField(
    entityName: string,
    idFieldPath: string,
    allFields: StatsField[]
): string | undefined {
    const prefix = idFieldPath.split('.').slice(0, -1).join('.');
    const entityLower = entityName.toLowerCase();

    // Prioritized patterns (most specific → generic)
    const patterns = [
        // Entity-specific patterns
        `${entityLower}_name`,          // customer_name
        `${entityLower}Name`,           // customerName
        `${entityLower}-name`,          // customer-name
        `${entityLower}_title`,         // product_title
        `${entityLower}Title`,          // productTitle
        // Generic patterns
        'name',
        'title',
        'label',
        'display_name',
        'displayName',
        'display-name',
        'full_name',
        'fullName',
        'full-name',
        'username',
        'user_name',
        'firstName',
        'first_name',
        'email',                        // fallback display identifier
    ];

    for (const pattern of patterns) {
        const targetPath = prefix ? `${prefix}.${pattern}` : pattern;
        const found = allFields.find(f =>
            f.path.toLowerCase() === targetPath.toLowerCase() &&
            f.type === 'string'
        );
        if (found) return found.path;
    }

    return undefined;
}

// ============================================================================
// Pattern Collapsing (Structure-Aware)
// ============================================================================

/**
 * Get structural fingerprint for a path's descendants.
 * Used to group structurally similar siblings.
 */
function getStructureFingerprint(descendantPaths: string[]): string {
    // Extract immediate child keys from descendants
    const childKeys = new Set<string>();
    for (const path of descendantPaths) {
        const firstPart = path.split('.')[0];
        if (firstPart) {
            // Normalize array markers
            childKeys.add(firstPart.replace(/\[\d+\]/g, '[]'));
        }
    }
    return [...childKeys].sort().join(',');
}

interface CollapseResult {
    patterns: string[];
    wildcards: Map<string, Set<string>>;
}

/**
 * Collapse paths to patterns using structure-aware dynamic key detection.
 * Also tracks what values each wildcard represents.
 *
 * Key insight: Only collapse siblings that have SIMILAR sub-structure.
 * This prevents collapsing "mechanisms" with "summary" or "costs".
 *
 * Example:
 *   result.cognitive_manipulation.mechanisms.fear.score  } same structure
 *   result.emotional_conditioning.mechanisms.anger.score } → result.*.mechanisms.*.score
 *   result.summary.overall_score                         } different structure
 *   result.costs.totalTokens                             } → kept as-is
 *
 * Returns:
 *   patterns: ["result.*.mechanisms.*.score", ...]
 *   wildcards: { "result.*": ["cognitive_manipulation", ...], "result.*.mechanisms.*": ["fear", ...] }
 */
function collapseToPatterns(paths: string[]): CollapseResult {
    if (paths.length === 0) return { patterns: [], wildcards: new Map() };

    // Step 1: Normalize array indices
    let normalized = paths.map(p => p.replace(/\[\d+\]/g, '[]'));
    const original = paths.map(p => p.replace(/\[\d+\]/g, '[]'));

    // Track: wildcardPattern → Set of original values
    const wildcards = new Map<string, Set<string>>();

    // Step 2: Iteratively detect and replace dynamic segments
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;

    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;

        // Build: parent → child → [descendant relative paths]
        const parentChildDescendants = new Map<string, Map<string, string[]>>();

        for (const path of normalized) {
            const parts = path.split('.');
            for (let i = 0; i < parts.length; i++) {
                const parent = parts.slice(0, i).join('.');
                const child = parts[i];
                const descendant = parts.slice(i + 1).join('.');

                if (!parentChildDescendants.has(parent)) {
                    parentChildDescendants.set(parent, new Map());
                }
                const childMap = parentChildDescendants.get(parent)!;
                if (!childMap.has(child)) {
                    childMap.set(child, []);
                }
                if (descendant) {
                    childMap.get(child)!.push(descendant);
                }
            }
        }

        // For each parent, group children by structural fingerprint
        const childrenToCollapse = new Map<string, Set<string>>();

        for (const [parent, childMap] of parentChildDescendants) {
            // Skip wildcards and array markers
            const realChildren = [...childMap.keys()].filter(c => c !== '*' && c !== '[]');
            if (realChildren.length <= 3) continue;

            // Group children by their structural fingerprint
            const fingerprintGroups = new Map<string, string[]>();
            for (const child of realChildren) {
                const descendants = childMap.get(child)!;
                const fingerprint = getStructureFingerprint(descendants);

                if (!fingerprintGroups.has(fingerprint)) {
                    fingerprintGroups.set(fingerprint, []);
                }
                fingerprintGroups.get(fingerprint)!.push(child);
            }

            // Only collapse groups with >3 structurally similar children
            for (const [, children] of fingerprintGroups) {
                if (children.length > 3) {
                    if (!childrenToCollapse.has(parent)) {
                        childrenToCollapse.set(parent, new Set());
                    }
                    for (const child of children) {
                        childrenToCollapse.get(parent)!.add(child);
                    }
                }
            }
        }

        // Replace collapsible children with * and track wildcards
        normalized = normalized.map((path, idx) => {
            const parts = path.split('.');
            const origParts = original[idx].split('.');

            for (let i = 0; i < parts.length; i++) {
                const parent = parts.slice(0, i).join('.');
                const child = parts[i];

                if (childrenToCollapse.has(parent) && childrenToCollapse.get(parent)!.has(child)) {
                    // Record the wildcard pattern and original value
                    const wildcardPattern = parent ? `${parent}.*` : '*';
                    if (!wildcards.has(wildcardPattern)) {
                        wildcards.set(wildcardPattern, new Set());
                    }
                    // Use original value, not the already-collapsed one
                    wildcards.get(wildcardPattern)!.add(origParts[i]);

                    parts[i] = '*';
                    changed = true;
                }
            }
            return parts.join('.');
        });
    }

    // Step 3: Deduplicate and sort patterns
    const unique = [...new Set(normalized)];
    const patterns = unique.sort((a, b) => {
        const depthA = a.split('.').length;
        const depthB = b.split('.').length;
        if (depthA !== depthB) return depthA - depthB;
        return a.localeCompare(b);
    });

    return { patterns, wildcards };
}

/**
 * Merge wildcard maps from multiple collapse operations
 */
function mergeWildcards(...maps: Map<string, Set<string>>[]): Record<string, string[]> {
    const merged = new Map<string, Set<string>>();

    for (const map of maps) {
        for (const [key, values] of map) {
            if (!merged.has(key)) {
                merged.set(key, new Set());
            }
            for (const v of values) {
                merged.get(key)!.add(v);
            }
        }
    }

    // Convert to sorted arrays
    const result: Record<string, string[]> = {};
    for (const [key, values] of merged) {
        result[key] = [...values].sort();
    }
    return result;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Extract queryable capabilities from field roles.
 * Paths are collapsed to patterns for LLM efficiency.
 * Wildcards are documented so LLMs know what * represents.
 */
export function extractCapabilities(fields: StatsField[]): Capabilities {
    const measures: string[] = [];
    const dimensions: string[] = [];
    const identifiers: string[] = [];
    const timeFields: string[] = [];
    const searchable: string[] = [];

    for (const field of fields) {
        switch (field.role) {
            case 'measure':
                measures.push(field.path);
                break;
            case 'dimension':
                dimensions.push(field.path);
                break;
            case 'identifier':
                identifiers.push(field.path);
                break;
            case 'time':
                timeFields.push(field.path);
                break;
            case 'text':
                searchable.push(field.path);
                break;
        }
    }

    // Collapse to patterns and collect wildcards
    const measuresResult = collapseToPatterns(measures);
    const dimensionsResult = collapseToPatterns(dimensions);
    const identifiersResult = collapseToPatterns(identifiers);
    const timeFieldsResult = collapseToPatterns(timeFields);
    const searchableResult = collapseToPatterns(searchable);

    // Merge all wildcard mappings
    const wildcards = mergeWildcards(
        measuresResult.wildcards,
        dimensionsResult.wildcards,
        identifiersResult.wildcards,
        timeFieldsResult.wildcards,
        searchableResult.wildcards
    );

    return {
        measures: measuresResult.patterns,
        dimensions: dimensionsResult.patterns,
        identifiers: identifiersResult.patterns,
        timeFields: timeFieldsResult.patterns,
        ...(searchableResult.patterns.length > 0 && { searchable: searchableResult.patterns }),
        ...(Object.keys(wildcards).length > 0 && { wildcards }),
    };
}

/**
 * Detect entities from ANY *_id/*Id field by NAME pattern
 *
 * Key design decisions:
 * - Uses NAME pattern, not role (robust against role misclassification)
 * - No hardcoded entity list (works with any domain)
 * - Preserves data order (first entity encountered = primary)
 * - Deduplicates by entity name (case-insensitive)
 */
export function detectEntities(fields: StatsField[]): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    for (const field of fields) {
        // NAME-based detection - works regardless of role classification
        if (!isIdFieldByName(field.path)) continue;

        const entityName = extractEntityName(field.path);
        if (!entityName) continue;

        // Dedupe by lowercase name
        const key = entityName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        // Find associated name field
        const nameField = findNameField(entityName, field.path, fields);

        entities.push({
            name: entityName,
            description: `${entityName} identified by ${field.path}`,
            idField: field.path,
            ...(nameField && { nameField }),
        });
    }

    // Preserve original data order - first entity is primary
    return entities;
}

/**
 * Infer the grain (what each row represents)
 * Uses first entity or first identifier field
 */
export function inferGrain(fields: StatsField[], entities: Entity[]): string {
    // Use first entity (already in data order)
    if (entities.length > 0) {
        return `One row per ${entities[0].name.toLowerCase()}`;
    }

    // Fallback to first identifier
    const firstId = fields.find(f => f.role === 'identifier');
    if (firstId) {
        const name = extractEntityName(firstId.path);
        if (name) {
            return `One row per ${name.toLowerCase()}`;
        }
        return `One row per unique ${firstId.path}`;
    }

    return 'One row per record';
}