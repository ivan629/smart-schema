/**
 * SmartSchema v2 - Utilities
 *
 * Shared utility functions used across multiple modules.
 * Extracted to avoid duplication and ensure consistency.
 */

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Convert any case to PascalCase
 *
 * @example
 * toPascalCase("customer")      // "Customer"
 * toPascalCase("order_item")    // "OrderItem"
 * toPascalCase("user-profile")  // "UserProfile"
 * toPascalCase("API_KEY")       // "ApiKey"
 */
export function toPascalCase(str: string): string {
    return str
        .toLowerCase()
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

/**
 * Convert any case to camelCase
 *
 * @example
 * toCamelCase("order_item")    // "orderItem"
 * toCamelCase("user-profile")  // "userProfile"
 */
export function toCamelCase(str: string): string {
    return str
        .toLowerCase()
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

/**
 * Convert any case to snake_case
 *
 * @example
 * toSnakeCase("orderItem")     // "order_item"
 * toSnakeCase("UserProfile")   // "user_profile"
 */
export function toSnakeCase(str: string): string {
    return str
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
        .replace(/[-]/g, '_');
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get the leaf (last segment) of a dot-separated path
 *
 * @example
 * getLeafName("user.profile.name")  // "name"
 * getLeafName("items[].price")      // "price"
 */
export function getLeafName(path: string): string {
    return path.split('.').pop() ?? path;
}

/**
 * Get the parent path (everything except the last segment)
 *
 * @example
 * getParentPath("user.profile.name")  // "user.profile"
 * getParentPath("name")               // ""
 */
export function getParentPath(path: string): string {
    const parts = path.split('.');
    return parts.slice(0, -1).join('.');
}

/**
 * Calculate path complexity score for comparing/ranking paths
 * Lower score = simpler/better path
 *
 * Factors:
 * - Depth (number of segments)
 * - Array notation (penalized)
 * - Very long paths (penalized)
 *
 * @example
 * getPathComplexity("id")                    // 1
 * getPathComplexity("user.id")               // 2
 * getPathComplexity("items[].product.id")    // 5 (3 depth + 2 array penalty)
 */
export function getPathComplexity(path: string): number {
    const parts = path.split('.');
    let score = parts.length;  // Base: depth

    // Penalize array notation
    score += (path.match(/\[\]/g) || []).length * 2;

    // Penalize very long paths
    if (parts.length > 4) score += (parts.length - 4);

    return score;
}

/**
 * Normalize array indices in a path to []
 *
 * @example
 * normalizePath("items[0].name")   // "items[].name"
 * normalizePath("data[42].value")  // "data[].value"
 */
export function normalizePath(path: string): string {
    return path.replace(/\[\d+\]/g, '[]');
}

// ============================================================================
// Structure Fingerprinting
// ============================================================================

/**
 * Get structural fingerprint for a path's descendants.
 * Used to group structurally similar siblings for pattern collapsing.
 *
 * @example
 * getStructureFingerprint(["score", "confidence"])  // "confidence,score"
 * getStructureFingerprint(["items[0].x", "items[1].y"])  // "items[]"
 */
export function getStructureFingerprint(descendantPaths: string[]): string {
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

// ============================================================================
// Pattern Collapsing
// ============================================================================

export interface CollapseResult {
    /** Collapsed patterns with * for dynamic segments */
    patterns: string[];
    /** Map of wildcard patterns to their original values */
    wildcards: Map<string, Set<string>>;
}

/**
 * Collapse paths to patterns using structure-aware dynamic key detection.
 * Also tracks what values each wildcard represents.
 *
 * Key insight: Only collapse siblings that have SIMILAR sub-structure.
 * This prevents collapsing "mechanisms" with "summary" or "costs".
 *
 * @example
 * Input paths:
 *   result.cognitive_manipulation.mechanisms.fear.score
 *   result.emotional_conditioning.mechanisms.anger.score
 *   result.summary.overall_score
 *
 * Output:
 *   patterns: ["result.*.mechanisms.*.score", "result.summary.overall_score"]
 *   wildcards: {
 *     "result.*": ["cognitive_manipulation", "emotional_conditioning"],
 *     "result.*.mechanisms.*": ["fear", "anger"]
 *   }
 *
 * @param paths - Array of field paths to collapse
 * @param threshold - Minimum siblings needed to collapse (default: 3)
 */
export function collapseToPatterns(
    paths: string[],
    threshold: number = 3
): CollapseResult {
    if (paths.length === 0) return { patterns: [], wildcards: new Map() };

    // Step 1: Normalize array indices
    let normalized = paths.map(normalizePath);
    const original = paths.map(normalizePath);

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
            if (realChildren.length <= threshold) continue;

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

            // Only collapse groups with > threshold structurally similar children
            for (const [, children] of fingerprintGroups) {
                if (children.length > threshold) {
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
 *
 * @example
 * const merged = mergeWildcards(map1, map2, map3);
 * // Returns: { "path.*": ["val1", "val2", ...] }
 */
export function mergeWildcards(
    ...maps: Map<string, Set<string>>[]
): Record<string, string[]> {
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
// Array Utilities
// ============================================================================

/**
 * Check if a value matches any pattern in an array
 * Supports both string includes and regex matching
 */
export function matchesAny(
    value: string,
    patterns: (string | RegExp)[]
): boolean {
    const lower = value.toLowerCase();
    return patterns.some(p => {
        if (typeof p === 'string') {
            return lower.includes(p.toLowerCase());
        }
        return p.test(value);
    });
}

/**
 * Check if a value matches any pattern exactly or as a suffix
 */
export function matchesExact(
    value: string,
    patterns: string[]
): boolean {
    const lower = value.toLowerCase();
    return patterns.some(p =>
        lower === p.toLowerCase() ||
        lower.endsWith('_' + p.toLowerCase())
    );
}

/**
 * Deduplicate an array while preserving order
 */
export function uniquePreserveOrder<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

/**
 * Group array items by a key function
 */
export function groupBy<T, K extends string | number>(
    arr: T[],
    keyFn: (item: T) => K
): Map<K, T[]> {
    const map = new Map<K, T[]>();
    for (const item of arr) {
        const key = keyFn(item);
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key)!.push(item);
    }
    return map;
}