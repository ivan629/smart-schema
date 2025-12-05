/**
 * SmartSchema v2 - AI Enrichment
 *
 * Adds semantic descriptions using Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair'
import type { SmartSchema, TypeDef, NodeDef, Capabilities, Entity } from './types.js';
import { isObjectNode, isArrayNode, isMapNode, isRefNode, isFieldNode } from './types.js';
import { buildPrompt, type AIResponse } from './prompts.js';

// ============================================================================
// Constants
// ============================================================================

const MODEL = 'claude-sonnet-4-5-20250929';
const TIMEOUT = 5 * 60 * 1000;
const MAX_TOKENS = 4096;

// ============================================================================
// AI Call
// ============================================================================

async function callAI(prompt: string, apiKey: string, verbose: boolean): Promise<AIResponse> {
    const client = new Anthropic({ apiKey });

    if (verbose) console.log(`[smart-schema] Calling ${MODEL}...`);

    const response = await Promise.race([
        client.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            messages: [{ role: 'user', content: prompt }],
        }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI request timed out')), TIMEOUT)
        ),
    ]);

    const content = response.content[0];
    if (!content || content.type !== 'text') {
        throw new Error('Unexpected AI response type');
    }
    let text = content.text.trim();

    try {
        return JSON.parse(jsonrepair(text)) as AIResponse;
    } catch {
        throw new Error('Failed to parse AI response as JSON');
    }
}

// ============================================================================
// Apply Enrichment
// ============================================================================

function enrichDefs(
    defs: Record<string, TypeDef>,
    aiDefs?: AIResponse['defs']
): Record<string, TypeDef> {
    const result: Record<string, TypeDef> = {};

    for (const [name, def] of Object.entries(defs)) {
        const ai = aiDefs?.[name];
        const fields: Record<string, NodeDef> = {};

        for (const [fieldName, node] of Object.entries(def.fields)) {
            const aiField = ai?.fields?.[fieldName];
            if (isFieldNode(node)) {
                fields[fieldName] = { ...node, ...(aiField && { description: aiField.description }) };
            } else {
                fields[fieldName] = node;
            }
        }

        result[name] = {
            ...(ai?.description && { description: ai.description }),
            fields,
        };
    }

    return result;
}

function enrichNode(
    node: NodeDef,
    path: string,
    aiFields?: AIResponse['fields']
): NodeDef {
    const ai = aiFields?.[path];

    if (isRefNode(node)) {
        return { ...node, ...(ai && { description: ai.description }) };
    }

    if (isFieldNode(node)) {
        return { ...node, ...(ai && { description: ai.description }) };
    }

    if (isArrayNode(node)) {
        return {
            ...node,
            ...(ai && { description: ai.description }),
            items: enrichNode(node.items, `${path}.[]`, aiFields),
        };
    }

    if (isMapNode(node)) {
        return {
            ...node,
            ...(ai && { description: ai.description }),
            values: enrichNode(node.values, path, aiFields),
        };
    }

    if (isObjectNode(node)) {
        const fields: Record<string, NodeDef> = {};
        for (const [key, child] of Object.entries(node.fields)) {
            fields[key] = enrichNode(child, path ? `${path}.${key}` : key, aiFields);
        }
        return { ...node, ...(ai && { description: ai.description }), fields };
    }

    return node;
}

function enrichEntities(detected: Entity[], aiEntities?: AIResponse['entities']): Entity[] {
    if (!aiEntities?.length) return detected;

    const byName = new Map(aiEntities.map(e => [e.name.toLowerCase(), e]));
    return detected.map(e => {
        const ai = byName.get(e.name.toLowerCase());
        return ai ? { ...e, description: ai.description } : e;
    });
}

// ============================================================================
// Main Exports
// ============================================================================

export async function enrichWithAI(
    defs: Record<string, TypeDef>,
    root: NodeDef,
    capabilities: Capabilities,
    entities: Entity[],
    apiKey: string,
    verbose: boolean
): Promise<SmartSchema> {
    const prompt = buildPrompt(defs, root, entities);
    if (verbose) console.log(`[smart-schema] Prompt: ${prompt.length} chars`);

    const ai = await callAI(prompt, apiKey, verbose);
    if (verbose) console.log('[smart-schema] AI enrichment complete');

    return {
        $version: 2,
        domain: ai.domain ?? 'unknown',
        description: ai.description ?? 'Data schema',
        grain: ai.grain ?? 'One record per row',
        ...(Object.keys(defs).length > 0 && { $defs: enrichDefs(defs, ai.defs) }),
        root: enrichNode(root, '', ai.fields),
        capabilities,
        ...(entities.length > 0 && { entities: enrichEntities(entities, ai.entities) }),
    };
}

export function applyDefaults(
    defs: Record<string, TypeDef>,
    root: NodeDef,
    capabilities: Capabilities,
    entities: Entity[]
): SmartSchema {
    return {
        $version: 2,
        domain: 'unknown',
        description: 'Data schema',
        grain: 'One record per row',
        ...(Object.keys(defs).length > 0 && { $defs: defs }),
        root,
        capabilities,
        ...(entities.length > 0 && { entities }),
    };
}