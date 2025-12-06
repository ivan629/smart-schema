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
 * - Deduplicates entities by name, picking simplest path
 */

import type { StatsField, Capabilities, Entity } from './types.js';
import {
    toPascalCase,
    getPathComplexity,
    collapseToPatterns,
    mergeWildcards,
} from './utils.js';
import {
    ENTITY_ID_EXTRACT_PATTERNS,
    ID_FIELD_DETECT_PATTERN,
    ENTITY_NAME_FIELD_PATTERNS,
    MIN_ENTITY_NAME_LENGTH,
} from './constants.js';

// ============================================================================
// Entity Detection Helpers
// ============================================================================

/**
 * Extract entity name from field path by NAME pattern
 * Works with any naming convention - does NOT depend on role classification
 *
 * @example
 * extractEntityName("customer_id")  // "Customer"
 * extractEntityName("userId")       // "User"
 * extractEntityName("order-id")     // "Order"
 * extractEntityName("ORDER_ID")     // "Order"
 * extractEntityName("user.id")      // "User" (from parent)
 */
function extractEntityName(path: string): string | null {
    const leaf = path.split('.').pop() ?? path;

    for (const pattern of ENTITY_ID_EXTRACT_PATTERNS) {
        const match = leaf.match(pattern);
        if (match?.[1]) {
            const raw = match[1];
            // Skip too-short matches (likely just "id" variants)
            if (raw.length < MIN_ENTITY_NAME_LENGTH) continue;
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
    return ID_FIELD_DETECT_PATTERN.test(leaf) || leaf.toLowerCase() === 'id';
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
        ...ENTITY_NAME_FIELD_PATTERNS
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
 * - Picks simplest path when multiple exist for same entity
 */
export function detectEntities(fields: StatsField[]): Entity[] {
    // First pass: collect all ID fields grouped by entity name
    const entityCandidates = new Map<string, { paths: string[]; fields: StatsField[] }>();

    for (const field of fields) {
        // NAME-based detection - works regardless of role classification
        if (!isIdFieldByName(field.path)) continue;

        const entityName = extractEntityName(field.path);
        if (!entityName) continue;

        const key = entityName.toLowerCase();

        if (!entityCandidates.has(key)) {
            entityCandidates.set(key, { paths: [], fields: [] });
        }

        entityCandidates.get(key)!.paths.push(field.path);
        entityCandidates.get(key)!.fields.push(field);
    }

    // Second pass: for each entity, pick the best (simplest) path
    const entities: Entity[] = [];
    const processedNames = new Set<string>();

    for (const field of fields) {
        if (!isIdFieldByName(field.path)) continue;

        const entityName = extractEntityName(field.path);
        if (!entityName) continue;

        const key = entityName.toLowerCase();

        // Skip if we've already processed this entity
        if (processedNames.has(key)) continue;
        processedNames.add(key);

        const candidates = entityCandidates.get(key);
        if (!candidates) continue;

        // Pick the path with lowest complexity (shortest, least nesting)
        const sortedPaths = [...candidates.paths].sort((a, b) => {
            const complexityA = getPathComplexity(a);
            const complexityB = getPathComplexity(b);
            if (complexityA !== complexityB) return complexityA - complexityB;
            return a.localeCompare(b);  // Alphabetical tiebreaker
        });

        const bestPath = sortedPaths[0];

        // Find associated name field using the best path
        const nameField = findNameField(entityName, bestPath, fields);

        entities.push({
            name: entityName,
            description: `${entityName} identified by ${bestPath}`,
            idField: bestPath,
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