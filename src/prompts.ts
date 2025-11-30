/**
 * Prompt Generation for AI Enrichment
 *
 * Generates efficient prompts that only ask AI to describe unique elements
 * (archetypes + unique fields), not repetitive structures.
 */

import type { PreCompressedStructure, DetectedArchetype, DetectedMap, UniqueField } from './structure.js';

// ============================================================================
// Prompt Building
// ============================================================================

function formatArchetypeForPrompt(name: string, archetype: DetectedArchetype): string {
    const fields = [...archetype.fields.entries()]
        .map(([fieldName, shape]) => {
            const parts = [`    ${fieldName}: ${shape.type} (${shape.role})`];
            if (shape.unit) parts.push(`unit=${shape.unit}`);
            if (shape.format) parts.push(`format=${shape.format}`);
            return parts.join(', ');
        })
        .join('\n');

    const usedIn = archetype.occurrences.slice(0, 5).join(', ');
    const moreCount = archetype.occurrences.length - 5;
    const usedInStr = moreCount > 0 ? `${usedIn}, +${moreCount} more` : usedIn;

    return `ARCHETYPE "${name}":
  Fields:
${fields}
  Used in: ${usedInStr}`;
}

function formatMapForPrompt(map: DetectedMap): string {
    const keysPreview = map.keys.slice(0, 10).join(', ');
    const moreCount = map.keys.length - 10;
    const keysStr = moreCount > 0 ? `${keysPreview}, +${moreCount} more` : keysPreview;

    return `MAP "${map.path}":
  Keys: [${keysStr}]
  Value type: ${map.archetypeName ?? 'object'}`;
}

function formatFieldForPrompt(field: UniqueField): string {
    const parts = [`  ${field.path}: ${field.type} (${field.role})`];

    if (field.unit) parts.push(`unit=${field.unit}`);
    if (field.format) parts.push(`format=${field.format}`);
    if (field.nullable) parts.push('nullable');
    if (field.refKeys) parts.push(`refs=${field.refKeys}`);
    if (field.sameAs) parts.push(`sameAs=${field.sameAs}`);

    // Add sample values for context
    if (field.sampleValues?.length) {
        const samples = field.sampleValues
            .slice(0, 3)
            .map(v => JSON.stringify(v))
            .join(', ');
        parts.push(`samples=[${samples}]`);
    }

    return parts.join(', ');
}

export function buildEnrichmentPrompt(structure: PreCompressedStructure): string {
    const archetypesSection = [...structure.archetypes.entries()]
        .map(([name, arch]) => formatArchetypeForPrompt(name, arch))
        .join('\n\n');

    const mapsSection = [...structure.maps.values()]
        .map(formatMapForPrompt)
        .join('\n\n');

    const fieldsSection = [...structure.uniqueFields.entries()]
        .map(([tableName, fields]) => {
            const fieldLines = fields.map(formatFieldForPrompt).join('\n');
            return `TABLE "${tableName}":\n${fieldLines}`;
        })
        .join('\n\n');

    const patternsSection = structure.patterns
        .map(p => `  - ${p.type}: ${JSON.stringify(p)}`)
        .join('\n');

    return `Analyze this data structure and provide semantic enrichment.

## DETECTED STRUCTURE

### Archetypes (reusable field patterns)
${archetypesSection || '(none detected)'}

### Maps (objects with homogeneous keyed values)
${mapsSection || '(none detected)'}

### Detected Patterns
${patternsSection || '(none detected)'}

### Unique Fields (need descriptions)
${fieldsSection}

## YOUR TASK

Provide enrichment in JSON format:

{
  "domain": "string - the business/technical domain (e.g., analytics, ecommerce, finance)",
  "description": "string - overall description of this data structure",
  "archetypes": {
    "<archetype_name>": {
      "description": "string - what this archetype represents",
      "fields": {
        "<field_name>": {
          "description": "string - what this field means in context"
        }
      }
    }
  },
  "maps": {
    "<map_path>": {
      "description": "string - what this collection represents"
    }
  },
  "tables": {
    "<table_name>": {
      "description": "string - what this table represents",
      "dataGrain": "string - what one row represents",
      "fields": {
        "<field_path>": {
          "description": "string - what this field means"
        }
      },
      "entities": [
        {
          "name": "string - entity name",
          "description": "string - what this entity represents",
          "idField": "string - optional, primary identifier field",
          "nameField": "string - optional, display name field"
        }
      ]
    }
  }
}

IMPORTANT:
- For archetypes, provide ONE description that applies to ALL occurrences
- For map fields, the archetype description covers the values - just describe the map itself
- Keep descriptions concise but meaningful
- Focus on business meaning, not technical details
- You don't need to repeat type/role information in descriptions

Respond with ONLY the JSON object, no other text.`;
}

// ============================================================================
// Response Parsing Types
// ============================================================================

export interface AIArchetypeEnrichment {
    description: string;
    fields: Record<string, { description: string }>;
}

export interface AIMapEnrichment {
    description: string;
}

export interface AIEntityEnrichment {
    name: string;
    description: string;
    idField?: string;
    nameField?: string;
}

export interface AITableEnrichment {
    description: string;
    dataGrain: string;
    fields: Record<string, { description: string }>;
    entities: AIEntityEnrichment[];
}

export interface AIEnrichmentResponse {
    domain: string;
    description: string;
    archetypes: Record<string, AIArchetypeEnrichment>;
    maps: Record<string, AIMapEnrichment>;
    tables: Record<string, AITableEnrichment>;
}