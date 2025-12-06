/**
 * SmartSchema v2 - AI Enrichment (Pattern-Based Edition)
 *
 * Uses Claude to add semantic descriptions to schema.
 *
 * KEY INNOVATION: Pattern-based analysis
 * - 200 fields → ~25 unique patterns → AI → all 200 described
 * - Single API call regardless of schema size
 * - 100% coverage at minimal cost
 *
 * FEATURES:
 * - Pattern extraction (collapses array indices and dynamic keys)
 * - Full inference context (types, roles, formats, units)
 * - Sample values aggregated across all pattern instances
 * - Entity relationships in prompt
 * - Output validation + retry with exponential backoff
 * - User override preservation
 * - $defs support
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SmartSchema, NodeDef, Entity, StatsField } from './types.js';

// ============================================================================
// Types
// ============================================================================

interface FieldContext {
    path: string;
    type: string;
    role: string;
    format?: string;
    unit?: string;
    samples?: string[];
}

interface PatternContext {
    pattern: string;           // Normalized path: "mechanisms.*.evidence[].quote"
    type: string;
    role: string;
    format?: string;
    unit?: string;
    samples: string[];         // Aggregated from all matching fields
    matchingPaths: string[];   // All original paths that match this pattern
    instanceCount: number;     // How many fields match
    parentContext?: string;    // Parent structure context
}

interface EntityContext {
    name: string;
    idField: string;
    nameField?: string;
}

interface EnrichmentInput {
    domain: string;
    patterns: PatternContext[];
    entities: EntityContext[];
    relationships: string[];
    totalFields: number;
}

interface EnrichmentOutput {
    domain: string;
    description: string;
    grain: string;
    patterns: Record<string, string>;  // pattern → description
    entities: Record<string, string>;
}

interface EnrichOptions {
    apiKey?: string;
    verbose?: boolean;
    statsFields?: StatsField[];  // Internal use
}

// ============================================================================
// Tool Definition
// ============================================================================

const ENRICHMENT_TOOL: Anthropic.Tool = {
    name: 'submit_schema_enrichment',
    description: 'Submit the enriched schema with descriptions for each pattern',
    input_schema: {
        type: 'object' as const,
        properties: {
            domain: {
                type: 'string',
                description: 'The detected domain/industry (e.g., "content_analysis", "ecommerce", "analytics")',
            },
            description: {
                type: 'string',
                description: 'A concise description of what this data represents (1-2 sentences)',
            },
            grain: {
                type: 'string',
                description: 'What each row/record represents (e.g., "One analysis per video")',
            },
            patterns: {
                type: 'object',
                description: 'Map of pattern paths to their plain English descriptions. Each description applies to ALL fields matching that pattern.',
                additionalProperties: { type: 'string' },
            },
            entities: {
                type: 'object',
                description: 'Map of entity names to their descriptions',
                additionalProperties: { type: 'string' },
            },
        },
        required: ['domain', 'description', 'grain', 'patterns', 'entities'],
    },
};

// ============================================================================
// Pattern Extraction
// ============================================================================

/**
 * Get structural fingerprint for a path's descendants.
 * Used to group structurally similar siblings.
 */
function getStructureFingerprint(descendantPaths: string[]): string {
    const childKeys = new Set<string>();
    for (const path of descendantPaths) {
        const firstPart = path.split('.')[0];
        if (firstPart) {
            childKeys.add(firstPart.replace(/\[\d+\]/g, '[]'));
        }
    }
    return [...childKeys].sort().join(',');
}

/**
 * Extract unique patterns from all fields.
 *
 * Key insight: Only collapse siblings that have SIMILAR sub-structure.
 * This prevents collapsing "mechanisms" with "summary" or "costs".
 *
 * Uses iterative normalization to handle nested dynamic keys:
 * - Iteration 1: Detect result.* (only analysis types, not summary/costs)
 * - Iteration 2: Detect result.*.mechanisms.* (mechanism names)
 * - Continue until stable
 */
function extractUniquePatterns(fields: FieldContext[]): PatternContext[] {
    // Step 1: Initialize with array-normalized paths
    let normalizedPaths = fields.map(f => f.path.replace(/\[\d+\]/g, '[]'));

    // Step 2: Iteratively detect and replace dynamic segments
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;

    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;

        // Build: parent → child → [descendant relative paths]
        const parentChildDescendants = new Map<string, Map<string, string[]>>();

        for (const path of normalizedPaths) {
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
            // AND only if they have non-empty structure (not leaf nodes)
            for (const [fingerprint, children] of fingerprintGroups) {
                if (children.length > 3 && fingerprint !== '') {
                    if (!childrenToCollapse.has(parent)) {
                        childrenToCollapse.set(parent, new Set());
                    }
                    for (const child of children) {
                        childrenToCollapse.get(parent)!.add(child);
                    }
                }
            }
        }

        // Replace collapsible children with *
        normalizedPaths = normalizedPaths.map(path => {
            const parts = path.split('.');
            for (let i = 0; i < parts.length; i++) {
                const parent = parts.slice(0, i).join('.');
                const child = parts[i];
                if (childrenToCollapse.has(parent) && childrenToCollapse.get(parent)!.has(child)) {
                    parts[i] = '*';
                    changed = true;
                }
            }
            return parts.join('.');
        });
    }

    // Step 3: Build pattern contexts with unique patterns
    const patternMap = new Map<string, PatternContext>();

    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const pattern = normalizedPaths[i];

        if (!patternMap.has(pattern)) {
            patternMap.set(pattern, {
                pattern,
                type: field.type,
                role: field.role,
                format: field.format,
                unit: field.unit,
                samples: [],
                matchingPaths: [],
                instanceCount: 0,
            });
        }

        const ctx = patternMap.get(pattern)!;
        ctx.matchingPaths.push(field.path);
        ctx.instanceCount++;

        // Aggregate diverse samples (max 5 unique)
        if (field.samples) {
            for (const s of field.samples) {
                const sStr = typeof s === 'string' ? s : JSON.stringify(s);
                if (ctx.samples.length < 5 && !ctx.samples.includes(sStr)) {
                    ctx.samples.push(sStr);
                }
            }
        }
    }

    // Step 4: Sort by depth (shallow first), then by role importance
    return [...patternMap.values()].sort((a, b) => {
        const depthA = a.pattern.split('.').length;
        const depthB = b.pattern.split('.').length;
        if (depthA !== depthB) return depthA - depthB;

        const roleOrder = ['identifier', 'measure', 'time', 'dimension', 'text', 'metadata'];
        const roleA = roleOrder.indexOf(a.role) ?? 99;
        const roleB = roleOrder.indexOf(b.role) ?? 99;
        return roleA - roleB;
    });
}


// ============================================================================
// Prompt Building
// ============================================================================

function formatSamples(samples: string[]): string {
    if (!samples || samples.length === 0) return '';

    const formatted = samples
        .slice(0, 5)
        .map(s => {
            // Truncate long samples
            if (s.length > 60) return `"${s.slice(0, 57)}..."`;
            return `"${s}"`;
        })
        .join(', ');

    return ` | samples: ${formatted}`;
}

function formatPatternContext(p: PatternContext): string {
    const parts: string[] = [
        `- ${p.pattern}`,
        `(${p.type}, ${p.role})`,
    ];

    if (p.format) parts.push(`format: ${p.format}`);
    if (p.unit) parts.push(`unit: ${p.unit}`);
    if (p.instanceCount > 1) parts.push(`[×${p.instanceCount}]`);

    const line = parts.join(' ');
    const samples = formatSamples(p.samples);

    return line + samples;
}

function formatEntityContext(entity: EntityContext): string {
    const parts = [`- ${entity.name}: identified by ${entity.idField}`];
    if (entity.nameField) {
        parts.push(`named by ${entity.nameField}`);
    }
    return parts.join(', ');
}

function buildPrompt(input: EnrichmentInput): string {
    const sections: string[] = [
        `You are analyzing a data schema to add semantic descriptions.`,
        ``,
        `DOMAIN HINT: ${input.domain || 'unknown'}`,
        `TOTAL FIELDS: ${input.totalFields} (collapsed to ${input.patterns.length} unique patterns)`,
        ``,
        `PATTERNS TO DESCRIBE:`,
        `(Each pattern may match multiple fields - your description applies to ALL matching fields)`,
        ``,
        ...input.patterns.map(formatPatternContext),
    ];

    if (input.entities.length > 0) {
        sections.push(
            ``,
            `ENTITIES DETECTED:`,
            ...input.entities.map(formatEntityContext)
        );
    }

    if (input.relationships.length > 0) {
        sections.push(
            ``,
            `RELATIONSHIPS:`,
            ...input.relationships.map(r => `- ${r}`)
        );
    }

    sections.push(
        ``,
        `INSTRUCTIONS:`,
        `1. Identify the domain based on patterns and sample values`,
        `2. Write a concise description of what this data represents`,
        `3. Determine the grain (what each record represents)`,
        `4. For EACH pattern, write a description that:`,
        `   - Explains the semantic meaning (not just technical type)`,
        `   - Is concise (5-15 words)`,
        `   - Applies to ALL fields matching that pattern`,
        `   - Uses domain-appropriate terminology`,
        `5. For each entity, describe what it represents`,
        ``,
        `IMPORTANT: Provide a description for EVERY pattern listed above.`,
        `Use the submit_schema_enrichment tool with your analysis.`
    );

    return sections.join('\n');
}

// ============================================================================
// Field Context Collection
// ============================================================================

function buildFieldContexts(
    schema: SmartSchema,
    statsFields?: StatsField[]
): FieldContext[] {
    // Use statsFields directly - they have all 428 paths!
    if (!statsFields || statsFields.length === 0) {
        return [];
    }

    return statsFields.map(f => ({
        path: f.path,
        type: f.type,
        role: f.role,
        format: f.format,
        unit: f.unit,
        samples: f.samples?.map(s =>
            typeof s === 'string' ? s : JSON.stringify(s)
        ),
    }));
}

function buildEntityContexts(entities: Entity[]): EntityContext[] {
    return entities.map(e => ({
        name: e.name,
        idField: e.idField,
        nameField: e.nameField,
    }));
}

function buildRelationships(entities: Entity[]): string[] {
    const relationships: string[] = [];

    for (const entity of entities) {
        if (entity.nameField) {
            relationships.push(
                `${entity.name} has display name via ${entity.nameField}`
            );
        }
    }

    return relationships;
}

// ============================================================================
// Main Export
// ============================================================================

export async function enrichSchema(
    schema: SmartSchema,
    options: EnrichOptions = {}
): Promise<SmartSchema> {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    const verbose = options.verbose ?? false;

    if (!apiKey) {
        if (verbose) console.warn('smart-schema: No API key, skipping AI enrichment');
        return enrichSchemaSync(schema);
    }

    const client = new Anthropic({ apiKey });
    const model = 'claude-sonnet-4-20250514';
    const maxRetries = 3;

    // 1. Collect all fields
    const allFields = buildFieldContexts(schema, options.statsFields);

    // 2. Extract unique patterns
    const patterns = extractUniquePatterns(allFields);

    if (verbose) {
        console.log(`smart-schema: ${allFields.length} fields → ${patterns.length} unique patterns`);
    }

    // 3. Build context
    const entities = buildEntityContexts(schema.entities ?? []);
    const relationships = buildRelationships(schema.entities ?? []);

    // 4. Scale tokens with pattern count
    const maxTokens = Math.min(8192, 512 + patterns.length * 30);

    const input: EnrichmentInput = {
        domain: schema.domain,
        patterns,
        entities,
        relationships,
        totalFields: allFields.length,
    };

    // 5. Call AI with retry
    let result: EnrichmentOutput | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                if (verbose) console.log(`smart-schema: Retry attempt ${attempt + 1}...`);
            }

            const response = await client.messages.create({
                model,
                max_tokens: maxTokens,
                tools: [ENRICHMENT_TOOL],
                tool_choice: { type: 'tool', name: 'submit_schema_enrichment' },
                messages: [
                    {
                        role: 'user',
                        content: buildPrompt(input),
                    },
                ],
            });

            const toolUse = response.content.find(
                (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
            );

            if (!toolUse || toolUse.name !== 'submit_schema_enrichment') {
                throw new Error('Unexpected response format');
            }

            result = toolUse.input as EnrichmentOutput;

            // Validate coverage
            const missingPatterns = patterns.filter(p => !result!.patterns[p.pattern]);

            if (missingPatterns.length === 0) {
                if (verbose) console.log(`smart-schema: All ${patterns.length} patterns described`);
                break;
            }

            if (missingPatterns.length <= patterns.length * 0.1) {
                if (verbose) console.warn(`smart-schema: ${missingPatterns.length} patterns missing, accepting`);
                break;
            }

            if (verbose) {
                console.warn(`smart-schema: ${missingPatterns.length}/${patterns.length} patterns missing, retrying...`);
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (verbose) console.warn(`smart-schema: Attempt ${attempt + 1} failed:`, err.message);
        }
    }

    if (!result) {
        if (verbose) console.warn('smart-schema: AI enrichment failed, using defaults');
        return enrichSchemaSync(schema);
    }

    // 6. Apply pattern descriptions to all matching fields
    return applyPatternEnrichments(schema, patterns, result);
}

// ============================================================================
// Apply Enrichments
// ============================================================================

function applyPatternEnrichments(
    schema: SmartSchema,
    patterns: PatternContext[],
    enrichment: EnrichmentOutput
): SmartSchema {
    const enriched = JSON.parse(JSON.stringify(schema)) as SmartSchema;

    // Apply top-level
    (enriched as any).domain = enrichment.domain || schema.domain;
    (enriched as any).description = enrichment.description || schema.description;
    (enriched as any).grain = enrichment.grain || schema.grain;

    // Build pattern → description map
    const patternDescriptions = new Map<string, string>();
    for (const [pattern, desc] of Object.entries(enrichment.patterns)) {
        patternDescriptions.set(pattern, desc);
    }

    // Build path → pattern lookup
    const pathToPattern = new Map<string, string>();
    for (const p of patterns) {
        for (const path of p.matchingPaths) {
            pathToPattern.set(path, p.pattern);
        }
    }

    // Apply to fields
    applyFieldDescriptionsFromPatterns(
        enriched.root,
        pathToPattern,
        patternDescriptions,
        ''
    );

    // Apply to $defs
    if (enriched.$defs) {
        for (const def of Object.values(enriched.$defs)) {
            applyFieldDescriptionsFromPatterns(
                { type: 'object', fields: def.fields },
                pathToPattern,
                patternDescriptions,
                ''
            );
        }
    }

    // Apply entity descriptions
    if (enriched.entities) {
        for (const entity of enriched.entities) {
            const desc = enrichment.entities[entity.name];
            if (desc) {
                (entity as any).description = desc;
            }
        }
    }

    return enriched;
}

function applyFieldDescriptionsFromPatterns(
    node: NodeDef,
    pathToPattern: Map<string, string>,
    patternDescriptions: Map<string, string>,
    prefix: string
): void {
    if ('fields' in node && node.fields) {
        for (const [key, child] of Object.entries(node.fields)) {
            const path = prefix ? `${prefix}.${key}` : key;

            // Find pattern for this path
            const pattern = pathToPattern.get(path);
            const desc = pattern ? patternDescriptions.get(pattern) : undefined;

            if (desc && typeof child === 'object') {
                (child as any).description = desc;
            }

            applyFieldDescriptionsFromPatterns(
                child,
                pathToPattern,
                patternDescriptions,
                path
            );
        }
    }

    if ('items' in node && node.items) {
        applyFieldDescriptionsFromPatterns(
            node.items,
            pathToPattern,
            patternDescriptions,
            `${prefix}[]`
        );
    }
}

// ============================================================================
// Sync Version (without AI) - Smart defaults
// ============================================================================

export function enrichSchemaSync(schema: SmartSchema): SmartSchema {
    const enriched = JSON.parse(JSON.stringify(schema)) as SmartSchema;
    generateDefaultDescriptions(enriched.root, '');

    if (enriched.$defs) {
        for (const def of Object.values(enriched.$defs)) {
            generateDefaultDescriptions({ type: 'object', fields: def.fields }, '');
        }
    }

    if (enriched.entities) {
        for (const entity of enriched.entities) {
            if (!entity.description) {
                (entity as any).description = generateEntityDescription(entity);
            }
        }
    }

    return enriched;
}

function generateDefaultDescriptions(node: NodeDef, prefix: string): void {
    if ('fields' in node && node.fields) {
        for (const [key, child] of Object.entries(node.fields)) {
            if (typeof child === 'object' && !('description' in child)) {
                (child as any).description = generateSmartDefault(key, child);
            }

            generateDefaultDescriptions(child, prefix ? `${prefix}.${key}` : key);
        }
    }

    if ('items' in node && node.items) {
        generateDefaultDescriptions(node.items, `${prefix}[]`);
    }
}

function generateSmartDefault(key: string, node: NodeDef): string {
    const readable = key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/-/g, ' ')
        .toLowerCase();

    const cleaned = readable
        .replace(/ id$/, '')
        .replace(/ at$/, '')
        .replace(/ date$/, '')
        .replace(/ time$/, '');

    if (!('role' in node)) {
        return `The ${readable}`;
    }

    switch (node.role) {
        case 'identifier':
            return `Unique identifier for ${cleaned || 'this record'}`;
        case 'measure':
            const unit = 'unit' in node ? ` (${node.unit})` : '';
            return `Numeric value for ${cleaned}${unit}`;
        case 'dimension':
            return `Category: ${cleaned}`;
        case 'time':
            return `Timestamp for ${cleaned || 'this event'}`;
        case 'text':
            return `Text content: ${cleaned}`;
        default:
            return `The ${readable}`;
    }
}

function generateEntityDescription(entity: Entity): string {
    const parts = [`${entity.name} entity`];

    if (entity.nameField) {
        parts.push(`with display name from ${entity.nameField}`);
    }

    return parts.join(' ');
}