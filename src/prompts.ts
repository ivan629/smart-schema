/**
 * SmartSchema v2 - AI Prompts
 *
 * Builds prompts for semantic enrichment.
 */

import type { TypeDef, NodeDef, Entity } from './types.js';
import { isObjectNode, isArrayNode, isMapNode, isRefNode, isFieldNode } from './types.js';

// ============================================================================
// Response Types
// ============================================================================

export interface AIResponse {
    domain: string;
    description: string;
    grain: string;
    defs?: Record<string, { description: string; fields: Record<string, { description: string }> }>;
    fields?: Record<string, { description: string }>;
    entities?: { name: string; description: string }[];
}

// ============================================================================
// Prompt Building
// ============================================================================

function simplifyNode(node: NodeDef): unknown {
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
        return { type: 'array', items: simplifyNode(node.items) };
    }

    if (isMapNode(node)) {
        return {
            type: 'map',
            keys: node.keys.length > 5 ? [...node.keys.slice(0, 5), '...'] : node.keys,
            values: simplifyNode(node.values),
        };
    }

    if (isObjectNode(node)) {
        const fields: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(node.fields)) {
            fields[key] = simplifyNode(child);
        }
        return { type: 'object', fields };
    }

    return node;
}

function collectPaths(node: NodeDef, prefix: string = ''): string[] {
    if (isRefNode(node)) return prefix ? [prefix] : [];
    if (isFieldNode(node)) return prefix ? [prefix] : [];

    if (isArrayNode(node)) {
        return collectPaths(node.items, prefix ? `${prefix}.[]` : '[]');
    }

    if (isMapNode(node)) return prefix ? [prefix] : [];

    if (isObjectNode(node)) {
        const paths: string[] = [];
        for (const [key, child] of Object.entries(node.fields)) {
            const childPath = prefix ? `${prefix}.${key}` : key;
            if (isRefNode(child)) {
                paths.push(childPath);
            } else {
                paths.push(...collectPaths(child, childPath));
            }
        }
        return paths;
    }

    return [];
}

export function buildPrompt(
    defs: Record<string, TypeDef>,
    root: NodeDef,
    entities: Entity[]
): string {
    const simpleRoot = simplifyNode(root);
    const simpleDefs: Record<string, unknown> = {};

    for (const [name, def] of Object.entries(defs)) {
        const fields: Record<string, unknown> = {};
        for (const [fieldName, fieldNode] of Object.entries(def.fields)) {
            fields[fieldName] = simplifyNode(fieldNode);
        }
        simpleDefs[name] = { fields };
    }

    const paths = collectPaths(root);
    const entityList = entities.length > 0
        ? `\n\nDetected entities:\n${entities.map(e => `- ${e.name} (id: ${e.idField})`).join('\n')}`
        : '';

    return `Analyze this data schema and provide semantic enrichment.

## Structure

\`\`\`json
${JSON.stringify(simpleRoot, null, 2)}
\`\`\`

${Object.keys(simpleDefs).length > 0 ? `## Reusable Types ($defs)

\`\`\`json
${JSON.stringify(simpleDefs, null, 2)}
\`\`\`
` : ''}
## Field Paths

${paths.map(p => `- ${p}`).join('\n')}
${entityList}

## Task

Provide JSON with:
1. **domain**: Industry/domain (e.g., "ecommerce", "analytics")
2. **description**: One sentence about what this data represents
3. **grain**: What one record represents (e.g., "One order per row")
4. **defs**: For each $def type, description + field descriptions
5. **fields**: Description for each field path
6. **entities**: Refine detected entities

## Response Format

\`\`\`json
{
  "domain": "string",
  "description": "string",
  "grain": "string",
  "defs": { "type_name": { "description": "...", "fields": { "field": { "description": "..." } } } },
  "fields": { "path": { "description": "..." } },
  "entities": [{ "name": "...", "description": "..." }]
}
\`\`\`

Respond ONLY with valid JSON.`;
}