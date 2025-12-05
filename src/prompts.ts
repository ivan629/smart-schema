/**
 * SmartSchema v2 - AI Enrichment Prompts
 *
 * Builds prompts for AI enrichment and defines response types.
 * AI only sees unique elements ($defs + unique fields), not repetitive structures.
 */

import type { TypeDef, NodeDef } from './types.js';
import {
    isObjectNode,
    isArrayNode,
    isMapNode,
    isRefNode,
    isFieldNode,
} from './types.js';

// ============================================================================
// AI Response Types
// ============================================================================

export interface AIEnrichmentResponse {
    readonly domain: string;
    readonly description: string;
    readonly grain: string;
    readonly defs?: Record<string, AIDefEnrichment>;
    readonly fields?: Record<string, AIFieldEnrichment>;
    readonly entities?: readonly AIEntityEnrichment[];
}

export interface AIDefEnrichment {
    readonly description: string;
    readonly fields: Record<string, { description: string }>;
}

export interface AIFieldEnrichment {
    readonly description: string;
}

export interface AIEntityEnrichment {
    readonly name: string;
    readonly description: string;
}

// ============================================================================
// Prompt Building
// ============================================================================

function nodeToSimpleObject(node: NodeDef): unknown {
    if (isRefNode(node)) {
        return { $ref: node.$ref, ...(node.keys && { keys: node.keys }) };
    }

    if (isFieldNode(node)) {
        return {
            type: node.type,
            ...(node.role && { role: node.role }),
            ...(node.format && { format: node.format }),
            ...(node.unit && { unit: node.unit }),
            ...(node.aggregation && { aggregation: node.aggregation }),
        };
    }

    if (isArrayNode(node)) {
        return {
            type: 'array',
            items:
                typeof node.items === 'string'
                    ? node.items
                    : nodeToSimpleObject(node.items),
        };
    }

    if (isMapNode(node)) {
        return {
            type: 'map',
            keys:
                node.keys.length > 5
                    ? [...node.keys.slice(0, 5), `... (${node.keys.length} total)`]
                    : node.keys,
            values:
                typeof node.values === 'string'
                    ? node.values
                    : nodeToSimpleObject(node.values),
        };
    }

    if (isObjectNode(node)) {
        const fields: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(node.fields)) {
            fields[key] = nodeToSimpleObject(child);
        }
        return { type: 'object', fields };
    }

    return node;
}

function defsToSimpleObject(
    defs: Record<string, TypeDef>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, def] of Object.entries(defs)) {
        const fields: Record<string, unknown> = {};
        for (const [fieldName, fieldNode] of Object.entries(def.fields)) {
            fields[fieldName] = nodeToSimpleObject(fieldNode);
        }
        result[name] = { fields };
    }

    return result;
}

function collectUniquePaths(node: NodeDef, prefix: string = ''): string[] {
    const paths: string[] = [];

    if (isRefNode(node)) {
        // Skip - covered by $defs
        return paths;
    }

    if (isFieldNode(node)) {
        if (prefix) paths.push(prefix);
        return paths;
    }

    if (isArrayNode(node)) {
        if (typeof node.items !== 'string') {
            paths.push(
                ...collectUniquePaths(node.items, prefix ? `${prefix}.[]` : '[]')
            );
        }
        return paths;
    }

    if (isMapNode(node)) {
        // Skip map internals - covered by $defs
        return paths;
    }

    if (isObjectNode(node)) {
        for (const [key, child] of Object.entries(node.fields)) {
            const childPrefix = prefix ? `${prefix}.${key}` : key;

            if (isRefNode(child)) {
                // Just record the ref path, not internals
                paths.push(childPrefix);
            } else {
                paths.push(...collectUniquePaths(child, childPrefix));
            }
        }
    }

    return paths;
}

export function buildEnrichmentPrompt(
    defs: Record<string, TypeDef>,
    root: NodeDef,
    existingEntities: readonly { name: string; idField: string }[]
): string {
    const simpleRoot = nodeToSimpleObject(root);
    const simpleDefs = defsToSimpleObject(defs);
    const uniquePaths = collectUniquePaths(root);

    const entityList =
        existingEntities.length > 0
            ? `\n\nDetected entities:\n${existingEntities.map((e) => `- ${e.name} (id: ${e.idField})`).join('\n')}`
            : '';

    return `Analyze this data schema and provide semantic enrichment.

## Structure

\`\`\`json
${JSON.stringify(simpleRoot, null, 2)}
\`\`\`

${
        Object.keys(simpleDefs).length > 0
            ? `## Reusable Types ($defs)

\`\`\`json
${JSON.stringify(simpleDefs, null, 2)}
\`\`\`
`
            : ''
    }

## Unique Field Paths

${uniquePaths.map((p) => `- ${p}`).join('\n')}
${entityList}

## Your Task

Provide JSON with:

1. **domain**: What domain/industry is this data from? (e.g., "ecommerce", "content_analysis", "finance")
2. **description**: One sentence describing what this data represents
3. **grain**: What does one record represent? (e.g., "One order per row", "One analysis per video")
4. **defs**: For each type in $defs, provide:
   - description: What this type represents
   - fields: For each field, a description of what it means
5. **fields**: For each unique path, provide a description
6. **entities**: Confirm or refine the detected entities with better names/descriptions

## Response Format

\`\`\`json
{
  "domain": "string",
  "description": "string",
  "grain": "string",
  "defs": {
    "type_name": {
      "description": "string",
      "fields": {
        "field_name": { "description": "string" }
      }
    }
  },
  "fields": {
    "path": { "description": "string" }
  },
  "entities": [
    { "name": "string", "description": "string" }
  ]
}
\`\`\`

Respond ONLY with valid JSON. No markdown, no explanation.`;
}