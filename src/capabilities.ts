/**
 * Capabilities Extraction
 *
 * Extracts measures, dimensions, identifiers, timeFields from schema structure.
 * Uses glob patterns for repeated structures.
 */

import type {
    StatsField,
    StatsMultiTableSchema,
    Capabilities,
    Entity,
} from './types.js';
import type { DetectedMap } from './structure.js';

// ============================================================================
// Helpers
// ============================================================================

function getLeafName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1] ?? path;
}

function pathMatchesMap(path: string, maps: ReadonlyMap<string, DetectedMap>): { map: DetectedMap; keyIndex: number } | null {
    for (const [mapPath, map] of maps) {
        if (path.startsWith(mapPath + '.')) {
            const remainder = path.slice(mapPath.length + 1);
            const parts = remainder.split('.');
            const key = parts[0];

            if (map.keys.includes(key)) {
                return {
                    map,
                    keyIndex: map.keys.indexOf(key),
                };
            }
        }
    }
    return null;
}

function toGlobPath(path: string, maps: ReadonlyMap<string, DetectedMap>): string {
    // Replace map keys with *
    let result = path;

    for (const [mapPath, map] of maps) {
        for (const key of map.keys) {
            const keyPath = `${mapPath}.${key}`;
            if (result.includes(keyPath)) {
                result = result.replace(keyPath, `${mapPath}.*`);
            }
        }
    }

    // Replace array notation
    result = result.replace(/\.\[\]/g, '.*');

    return result;
}

// ============================================================================
// Extract Capabilities
// ============================================================================

export function extractCapabilities(
    fields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>
): Capabilities {
    const measures = new Set<string>();
    const dimensions = new Set<string>();
    const identifiers = new Set<string>();
    const timeFields = new Set<string>();
    const searchable = new Set<string>();

    for (const field of fields) {
        const globPath = toGlobPath(field.path, maps);

        switch (field.role) {
            case 'measure':
                measures.add(globPath);
                break;
            case 'dimension':
                dimensions.add(globPath);
                break;
            case 'identifier':
                identifiers.add(globPath);
                break;
            case 'time':
                timeFields.add(globPath);
                break;
            case 'text':
                searchable.add(globPath);
                break;
        }
    }

    // Dedupe and sort
    const dedupeAndSort = (set: Set<string>): string[] =>
        [...new Set([...set])].sort();

    return {
        measures: dedupeAndSort(measures),
        dimensions: dedupeAndSort(dimensions),
        identifiers: dedupeAndSort(identifiers),
        timeFields: dedupeAndSort(timeFields),
        ...(searchable.size > 0 && { searchable: dedupeAndSort(searchable) }),
    };
}

// ============================================================================
// Detect Entities
// ============================================================================

const ENTITY_PATTERNS: Record<string, { namePatterns: RegExp[]; idPatterns: RegExp[] }> = {
    User: {
        namePatterns: [/^user/i, /^customer/i, /^member/i, /^account/i],
        idPatterns: [/^user_id$/i, /^customer_id$/i, /^member_id$/i, /^account_id$/i],
    },
    Order: {
        namePatterns: [/^order/i, /^purchase/i, /^transaction/i],
        idPatterns: [/^order_id$/i, /^purchase_id$/i, /^transaction_id$/i],
    },
    Product: {
        namePatterns: [/^product/i, /^item/i, /^sku/i],
        idPatterns: [/^product_id$/i, /^item_id$/i, /^sku$/i],
    },
    Video: {
        namePatterns: [/^video/i, /^media/i, /^content/i],
        idPatterns: [/^video_id$/i, /^media_id$/i, /^content_id$/i],
    },
    Analysis: {
        namePatterns: [/^analysis/i, /^result/i, /^report/i],
        idPatterns: [/^analysis_id$/i, /^result_id$/i, /^report_id$/i],
    },
};

export function detectEntities(
    fields: readonly StatsField[],
    maps: ReadonlyMap<string, DetectedMap>
): Entity[] {
    const entities: Entity[] = [];
    const seenEntityTypes = new Set<string>();

    // Find identifier fields
    const idFields = fields.filter(f => f.role === 'identifier');

    for (const idField of idFields) {
        const leaf = getLeafName(idField.path);

        // Check against known patterns
        for (const [entityType, patterns] of Object.entries(ENTITY_PATTERNS)) {
            if (seenEntityTypes.has(entityType)) continue;

            const matchesId = patterns.idPatterns.some(p => p.test(leaf));
            const matchesPath = patterns.namePatterns.some(p => p.test(idField.path));

            if (matchesId || matchesPath) {
                // Find name field
                const parent = idField.path.split('.').slice(0, -1).join('.');
                const nameField = fields.find(f =>
                    f.path.startsWith(parent) &&
                    (f.path.endsWith('.name') || f.path.endsWith('_name') || f.role === 'dimension')
                );

                entities.push({
                    name: entityType,
                    description: `${entityType} entity`,
                    idField: toGlobPath(idField.path, maps),
                    ...(nameField && { nameField: toGlobPath(nameField.path, maps) }),
                });

                seenEntityTypes.add(entityType);
                break;
            }
        }
    }

    // Check for main entity from root id field
    const rootId = idFields.find(f => f.path === 'id' || !f.path.includes('.'));
    if (rootId && entities.length === 0) {
        entities.push({
            name: 'Record',
            description: 'Main data record',
            idField: rootId.path,
        });
    }

    return entities;
}