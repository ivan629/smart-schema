/**
 * SmartSchema v2 - Capabilities
 *
 * Extracts what you can do with the data:
 * - measures (sum, avg)
 * - dimensions (group by)
 * - identifiers (join on)
 * - timeFields (time series)
 */

import type { StatsField, Capabilities, Entity } from './types.js';
import type { DetectedMap } from './structure.js';
import { getLeafName } from './utils.js';

// ============================================================================
// Glob Path Conversion
// ============================================================================

function toGlobPath(path: string, maps: Map<string, DetectedMap>): string {
    let result = path;

    for (const [mapPath, map] of maps) {
        for (const key of map.keys) {
            const keyPath = `${mapPath}.${key}`;
            if (result.includes(keyPath)) {
                result = result.replace(keyPath, `${mapPath}.*`);
            }
        }
    }

    return result.replace(/\.\[\]/g, '.*');
}

// ============================================================================
// Extract Capabilities
// ============================================================================

export function extractCapabilities(
    fields: StatsField[],
    maps: Map<string, DetectedMap>
): Capabilities {
    const measures = new Set<string>();
    const dimensions = new Set<string>();
    const identifiers = new Set<string>();
    const timeFields = new Set<string>();
    const searchable = new Set<string>();

    for (const field of fields) {
        const glob = toGlobPath(field.path, maps);

        switch (field.role) {
            case 'measure': measures.add(glob); break;
            case 'dimension': dimensions.add(glob); break;
            case 'identifier': identifiers.add(glob); break;
            case 'time': timeFields.add(glob); break;
            case 'text': searchable.add(glob); break;
        }
    }

    return {
        measures: [...measures].sort(),
        dimensions: [...dimensions].sort(),
        identifiers: [...identifiers].sort(),
        timeFields: [...timeFields].sort(),
        ...(searchable.size > 0 && { searchable: [...searchable].sort() }),
    };
}

// ============================================================================
// Entity Detection
// ============================================================================

const ENTITY_PATTERNS: Record<string, { name: RegExp[]; id: RegExp[] }> = {
    User: {
        name: [/^user/i, /^customer/i, /^member/i, /^account/i],
        id: [/^user_id$/i, /^customer_id$/i, /^member_id$/i, /^account_id$/i],
    },
    Order: {
        name: [/^order/i, /^purchase/i, /^transaction/i],
        id: [/^order_id$/i, /^purchase_id$/i, /^transaction_id$/i],
    },
    Product: {
        name: [/^product/i, /^item/i, /^sku/i],
        id: [/^product_id$/i, /^item_id$/i, /^sku$/i],
    },
    Video: {
        name: [/^video/i, /^media/i, /^content/i],
        id: [/^video_id$/i, /^media_id$/i, /^content_id$/i],
    },
};

export function detectEntities(
    fields: StatsField[],
    maps: Map<string, DetectedMap>
): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    const idFields = fields.filter(f => f.role === 'identifier');

    for (const idField of idFields) {
        const leaf = getLeafName(idField.path);

        for (const [entityType, patterns] of Object.entries(ENTITY_PATTERNS)) {
            if (seen.has(entityType)) continue;

            const matchesId = patterns.id.some(p => p.test(leaf));
            const matchesPath = patterns.name.some(p => p.test(idField.path));

            if (matchesId || matchesPath) {
                entities.push({
                    name: entityType,
                    description: `${entityType} entity`,
                    idField: toGlobPath(idField.path, maps),
                });
                seen.add(entityType);
                break;
            }
        }
    }

    // Fallback: root id field
    if (entities.length === 0) {
        const rootId = idFields.find(f => f.path === 'id' || !f.path.includes('.'));
        if (rootId) {
            entities.push({
                name: 'Record',
                description: 'Main data record',
                idField: rootId.path,
            });
        }
    }

    return entities;
}