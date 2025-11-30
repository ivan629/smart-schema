/**
 * AI Enrichment
 *
 * Enriches schema with semantic descriptions using Claude.
 * Only sends unique elements ($defs + unique fields) to minimize tokens.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
    SmartSchema,
    TypeDef,
    NodeDef,
    ObjectNode,
    Capabilities,
    Entity,
    Logger,
} from './types.js';
import {
    consoleLogger,
    isObjectNode,
    isArrayNode,
    isMapNode,
    isRefNode,
    isFieldNode,
} from './types.js';
import { buildEnrichmentPrompt, type AIEnrichmentResponse } from './prompts.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_TOKENS = 4096;

// ============================================================================
// Errors
// ============================================================================

export class APIError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'APIError';
    }
}

export class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TimeoutError';
    }
}

// ============================================================================
// Types
// ============================================================================

export interface EnrichOptions {
    readonly model?: string;
    readonly timeout?: number;
    readonly logger?: Logger;
}

// ============================================================================
// AI Call
// ============================================================================

async function callAI(
    prompt: string,
    apiKey: string,
    options: EnrichOptions
): Promise<AIEnrichmentResponse> {
    const { model = DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT, logger = consoleLogger } = options;

    const client = new Anthropic({ apiKey });

    logger.debug(`Calling AI model: ${model}`);

    try {
        const response = await Promise.race([
            client.messages.create({
                model,
                max_tokens: MAX_TOKENS,
                messages: [{ role: 'user', content: prompt }],
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new TimeoutError(`AI request timed out after ${timeout}ms`)), timeout)
            ),
        ]);

        const content = response.content[0];
        if (content.type !== 'text') {
            throw new APIError('Unexpected response type from AI');
        }

        const text = content.text.trim();

        // Extract JSON from response
        let jsonText = text;

        // Handle markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1].trim();
        }

        try {
            return JSON.parse(jsonText) as AIEnrichmentResponse;
        } catch (parseError) {
            logger.error(`Failed to parse AI response: ${text.slice(0, 500)}`);
            throw new AIValidationError(
                'Failed to parse AI response as JSON',
                [{ message: parseError instanceof Error ? parseError.message : 'Parse error' }]
            );
        }
    } catch (error) {
        if (error instanceof TimeoutError || error instanceof AIValidationError) {
            throw error;
        }

        if (error instanceof Anthropic.APIError) {
            throw new APIError(`Anthropic API error: ${error.message}`);
        }

        throw error;
    }
}

// ============================================================================
// Apply Enrichment to Structure
// ============================================================================

function enrichDefs(
    defs: Record<string, TypeDef>,
    aiDefs?: Record<string, { description: string; fields: Record<string, { description: string }> }>
): Record<string, TypeDef> {
    const result: Record<string, TypeDef> = {};

    for (const [name, def] of Object.entries(defs)) {
        const aiDef = aiDefs?.[name];

        const fields: Record<string, NodeDef> = {};
        for (const [fieldName, fieldNode] of Object.entries(def.fields)) {
            const aiField = aiDef?.fields?.[fieldName];

            if (isFieldNode(fieldNode)) {
                fields[fieldName] = {
                    ...fieldNode,
                    ...(aiField?.description && { description: aiField.description }),
                };
            } else {
                fields[fieldName] = fieldNode;
            }
        }

        result[name] = {
            ...(aiDef?.description && { description: aiDef.description }),
            fields,
        };
    }

    return result;
}

function enrichNode(
    node: NodeDef,
    path: string,
    aiFields?: Record<string, { description: string }>
): NodeDef {
    const aiField = aiFields?.[path];

    if (isRefNode(node)) {
        return {
            ...node,
            ...(aiField?.description && { description: aiField.description }),
        };
    }

    if (isFieldNode(node)) {
        return {
            ...node,
            ...(aiField?.description && { description: aiField.description }),
        };
    }

    if (isArrayNode(node)) {
        return {
            ...node,
            ...(aiField?.description && { description: aiField.description }),
            items: typeof node.items === 'string'
                ? node.items
                : enrichNode(node.items, `${path}.[]`, aiFields),
        };
    }

    if (isMapNode(node)) {
        return {
            ...node,
            ...(aiField?.description && { description: aiField.description }),
            values: typeof node.values === 'string'
                ? node.values
                : enrichNode(node.values, path, aiFields),
        };
    }

    if (isObjectNode(node)) {
        const fields: Record<string, NodeDef> = {};
        for (const [key, child] of Object.entries(node.fields)) {
            const childPath = path ? `${path}.${key}` : key;
            fields[key] = enrichNode(child, childPath, aiFields);
        }
        return {
            ...node,
            ...(aiField?.description && { description: aiField.description }),
            fields,
        };
    }

    return node;
}

function enrichEntities(
    detected: Entity[],
    aiEntities?: readonly { name: string; description: string }[]
): Entity[] {
    if (!aiEntities || aiEntities.length === 0) {
        return detected;
    }

    // Merge AI enrichment with detected entities
    const result: Entity[] = [];
    const aiByName = new Map(aiEntities.map(e => [e.name.toLowerCase(), e]));

    for (const entity of detected) {
        const ai = aiByName.get(entity.name.toLowerCase());
        result.push({
            ...entity,
            ...(ai && { description: ai.description }),
        });
    }

    return result;
}

// ============================================================================
// Main Export
// ============================================================================

export async function enrichWithAI(
    defs: Record<string, TypeDef>,
    root: NodeDef,
    capabilities: Capabilities,
    entities: Entity[],
    apiKey: string,
    options: EnrichOptions = {}
): Promise<SmartSchema> {
    const { logger = consoleLogger } = options;

    // Build prompt
    const prompt = buildEnrichmentPrompt(defs, root, entities);
    logger.debug(`Generated prompt (${prompt.length} chars)`);

    // Call AI
    logger.info('Calling AI for enrichment...');
    const aiResponse = await callAI(prompt, apiKey, options);
    logger.info('AI enrichment received');

    // Apply enrichment
    const enrichedDefs = enrichDefs(defs, aiResponse.defs);
    const enrichedRoot = enrichNode(root, '', aiResponse.fields);
    const enrichedEntities = enrichEntities(entities, aiResponse.entities);

    return {
        $version: 2,
        domain: aiResponse.domain ?? 'unknown',
        description: aiResponse.description ?? 'Data schema',
        grain: aiResponse.grain ?? 'One record per row',
        ...(Object.keys(enrichedDefs).length > 0 && { $defs: enrichedDefs }),
        root: enrichedRoot,
        capabilities,
        ...(enrichedEntities.length > 0 && { entities: enrichedEntities }),
    };
}

// ============================================================================
// No-AI Fallback
// ============================================================================

function pathToLabel(path: string): string {
    const leaf = path.split('.').pop() ?? path;
    return leaf
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase());
}

export function applyDefaults(
    defs: Record<string, TypeDef>,
    root: NodeDef,
    capabilities: Capabilities,
    entities: Entity[]
): SmartSchema {
    // Add default descriptions to defs
    const defaultDefs: Record<string, TypeDef> = {};
    for (const [name, def] of Object.entries(defs)) {
        const fields: Record<string, NodeDef> = {};
        for (const [fieldName, fieldNode] of Object.entries(def.fields)) {
            if (isFieldNode(fieldNode)) {
                fields[fieldName] = {
                    ...fieldNode,
                    description: pathToLabel(fieldName),
                };
            } else {
                fields[fieldName] = fieldNode;
            }
        }
        defaultDefs[name] = {
            description: pathToLabel(name),
            fields,
        };
    }

    return {
        $version: 2,
        domain: 'unknown',
        description: 'Data schema',
        grain: 'One record per row',
        ...(Object.keys(defaultDefs).length > 0 && { $defs: defaultDefs }),
        root,
        capabilities,
        ...(entities.length > 0 && { entities }),
    };
}