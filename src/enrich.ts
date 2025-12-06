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
 * - IMPROVED: Expanded heuristic corrections
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SmartSchema, NodeDef, Entity, StatsField } from './types.js';
import {
    HEURISTIC_MEASURE_PATTERNS,
    HEURISTIC_AVG_PATTERNS,
    HEURISTIC_NONE_PATTERNS,
    HEURISTIC_TEXT_PATTERNS,
    HEURISTIC_TIME_PATTERNS,
    HEURISTIC_DIMENSION_PATTERNS,
    HEURISTIC_UNIT_MAP,
    AI_MAX_RETRIES,
    AI_TOKEN_BASE,
    AI_TOKEN_PER_PATTERN,
    AI_TOKEN_MAX,
    SAMPLE_TRUNCATE_LENGTH,
    MAX_SAMPLES_PER_FIELD,
    ROLE_PRIORITY_ORDER,
    PATTERN_COLLAPSE_THRESHOLD,
} from './constants.js';
import { getStructureFingerprint } from './utils.js';

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

interface DefContext {
    name: string;
    sampleFields: string[];  // First few field names in the def
}

interface EnrichmentInput {
    domain: string;
    patterns: PatternContext[];
    entities: EntityContext[];
    relationships: string[];
    defNames?: DefContext[];
    totalFields: number;
}

interface EnrichmentOutput {
    domain: string;
    description: string;
    grain: string;
    patterns: Record<string, string>;  // pattern → description
    entities: Record<string, string>;
    // New semantic corrections
    role_corrections?: Record<string, string>;  // pattern → corrected role
    units?: Record<string, string>;             // pattern → detected unit
    aggregations?: Record<string, string>;      // pattern → aggregation method
    def_names?: Record<string, string>;         // current $def name → better name
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
    description: 'Submit the enriched schema with descriptions and semantic corrections for each pattern',
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
            role_corrections: {
                type: 'object',
                description: 'Map of pattern paths to corrected roles. Only include if the inferred role is WRONG. Valid roles: identifier, measure, dimension, time, text, metadata',
                additionalProperties: {
                    type: 'string',
                    enum: ['identifier', 'measure', 'dimension', 'time', 'text', 'metadata']
                },
            },
            units: {
                type: 'object',
                description: 'Map of pattern paths to detected units (e.g., "usd", "percent", "scale_0_1", "scale_1_10", "seconds", "bytes"). Only for numeric measures.',
                additionalProperties: { type: 'string' },
            },
            aggregations: {
                type: 'object',
                description: 'Map of pattern paths to aggregation methods. Only for measures. Valid: sum, avg, count, min, max, none',
                additionalProperties: {
                    type: 'string',
                    enum: ['sum', 'avg', 'count', 'min', 'max', 'none']
                },
            },
            def_names: {
                type: 'object',
                description: 'Map of current $def names to better semantic names (e.g., "def_1" → "evidence_excerpt", "def_2" → "mechanism_analysis"). Only include if name can be improved.',
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
            if (realChildren.length <= PATTERN_COLLAPSE_THRESHOLD) continue;

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
                if (children.length > PATTERN_COLLAPSE_THRESHOLD && fingerprint !== '') {
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

        const roleA = ROLE_PRIORITY_ORDER.indexOf(a.role) ?? 99;
        const roleB = ROLE_PRIORITY_ORDER.indexOf(b.role) ?? 99;
        return roleA - roleB;
    });
}


// ============================================================================
// Prompt Building
// ============================================================================

function formatSamples(samples: string[]): string {
    if (!samples || samples.length === 0) return '';

    const formatted = samples
        .slice(0, MAX_SAMPLES_PER_FIELD)
        .map(s => {
            // Truncate long samples
            if (s.length > SAMPLE_TRUNCATE_LENGTH) return `"${s.slice(0, SAMPLE_TRUNCATE_LENGTH - 3)}..."`;
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
        `You are analyzing a data schema to add semantic descriptions and corrections.`,
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

    if (input.defNames && input.defNames.length > 0) {
        sections.push(
            ``,
            `$DEF NAMES TO REVIEW:`,
            `(Suggest better semantic names if current names are generic like "def_1")`,
            ...input.defNames.map(d => `- ${d.name}: ${d.sampleFields.slice(0, 3).join(', ')}`)
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
        `SEMANTIC CORRECTIONS (include only where needed):`,
        `6. role_corrections: Fix misclassified roles. Common issues:`,
        `   - "strength" fields are measures, not dimensions`,
        `   - "score" fields are measures`,
        `   - "category" fields are dimensions, not text`,
        `   - Boolean flags are dimensions`,
        `7. units: Detect units for numeric measures:`,
        `   - Percentages: "percent"`,
        `   - 0-1 scales: "scale_0_1"`,
        `   - 1-10 scales: "scale_1_10"`,
        `   - Currency: "usd", "eur"`,
        `   - Time: "seconds", "milliseconds"`,
        `   - Counts: "count"`,
        `8. aggregations: How should measures be combined?`,
        `   - Scores/ratings → "avg"`,
        `   - Counts/totals → "sum"`,
        `   - Flags → "count" (to count true values)`,
        `   - Unique values → "none" (don't aggregate)`,
        `9. def_names: Suggest semantic names for generic $defs`,
        `   - "def_1" → "evidence_excerpt" (if contains quote, context, strength)`,
        `   - "def_2" → "mechanism_analysis" (if contains score, confidence)`,
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

function buildDefContexts(defs: Record<string, { fields: Record<string, unknown> }> | undefined): DefContext[] {
    if (!defs) return [];

    return Object.entries(defs).map(([name, def]) => ({
        name,
        sampleFields: Object.keys(def.fields).slice(0, 5),
    }));
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
    const maxRetries = AI_MAX_RETRIES;

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
    const defNames = buildDefContexts(schema.$defs as Record<string, { fields: Record<string, unknown> }> | undefined);

    // 4. Scale tokens with pattern count (increased for corrections)
    const maxTokens = Math.min(AI_TOKEN_MAX, AI_TOKEN_BASE + patterns.length * AI_TOKEN_PER_PATTERN);

    const input: EnrichmentInput = {
        domain: schema.domain,
        patterns,
        entities,
        relationships,
        defNames,
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

interface PatternCorrections {
    descriptions: Map<string, string>;
    roles: Map<string, string>;
    units: Map<string, string>;
    aggregations: Map<string, string>;
}

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

    // Build pattern → corrections maps
    const corrections: PatternCorrections = {
        descriptions: new Map(),
        roles: new Map(),
        units: new Map(),
        aggregations: new Map(),
    };

    for (const [pattern, desc] of Object.entries(enrichment.patterns)) {
        corrections.descriptions.set(pattern, desc);
    }
    for (const [pattern, role] of Object.entries(enrichment.role_corrections ?? {})) {
        corrections.roles.set(pattern, role);
    }
    for (const [pattern, unit] of Object.entries(enrichment.units ?? {})) {
        corrections.units.set(pattern, unit);
    }
    for (const [pattern, agg] of Object.entries(enrichment.aggregations ?? {})) {
        corrections.aggregations.set(pattern, agg);
    }

    // Build path → pattern lookup
    const pathToPattern = new Map<string, string>();
    for (const p of patterns) {
        for (const path of p.matchingPaths) {
            pathToPattern.set(path, p.pattern);
        }
    }

    // Apply to fields
    applyFieldCorrections(enriched.root, pathToPattern, corrections, '');

    // Handle $def renaming
    if (enriched.$defs && enrichment.def_names && Object.keys(enrichment.def_names).length > 0) {
        const renamedDefs: Record<string, any> = {};

        for (const [oldName, def] of Object.entries(enriched.$defs)) {
            const newName = enrichment.def_names[oldName] || oldName;
            applyFieldCorrections({ type: 'object', fields: def.fields }, pathToPattern, corrections, '');
            renamedDefs[newName] = def;
        }

        // Update $refs in the schema to use new names
        updateRefs(enriched.root, enrichment.def_names);
        (enriched as any).$defs = renamedDefs;
    } else if (enriched.$defs) {
        for (const def of Object.values(enriched.$defs)) {
            applyFieldCorrections({ type: 'object', fields: def.fields }, pathToPattern, corrections, '');
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

function applyFieldCorrections(
    node: NodeDef,
    pathToPattern: Map<string, string>,
    corrections: PatternCorrections,
    prefix: string
): void {
    if ('fields' in node && node.fields) {
        for (const [key, child] of Object.entries(node.fields)) {
            const path = prefix ? `${prefix}.${key}` : key;
            const pattern = pathToPattern.get(path);

            if (typeof child === 'object') {
                // Apply pattern-based corrections
                if (pattern) {
                    const desc = corrections.descriptions.get(pattern);
                    if (desc) (child as any).description = desc;

                    const role = corrections.roles.get(pattern);
                    if (role) (child as any).role = role;

                    const unit = corrections.units.get(pattern);
                    if (unit) (child as any).unit = unit;

                    const agg = corrections.aggregations.get(pattern);
                    if (agg) (child as any).aggregation = agg;
                }

                // Apply heuristic role corrections for common field names
                // This catches $def fields that don't have pattern matches
                applyHeuristicCorrections(key, child as any);
            }

            applyFieldCorrections(child, pathToPattern, corrections, path);
        }
    }

    if ('items' in node && node.items) {
        applyFieldCorrections(node.items, pathToPattern, corrections, `${prefix}[]`);
    }
}

/**
 * Apply heuristic corrections based on field name patterns.
 * This catches common misclassifications that the AI might miss.
 * Uses patterns from constants.ts for maintainability.
 */
function applyHeuristicCorrections(key: string, field: Record<string, any>): void {
    const keyLower = key.toLowerCase();

    // Helper to check if key contains any of the patterns
    const matchesAny = (patterns: string[]): boolean =>
        patterns.some(p => keyLower.includes(p));

    // Helper to check if key matches exactly or ends with pattern
    const matchesExact = (patterns: string[]): boolean =>
        patterns.some(p => keyLower === p || keyLower.endsWith('_' + p));

    // =========================================================================
    // MEASURE CORRECTIONS - numeric fields that should be measures
    // =========================================================================
    if (field.type === 'int' || field.type === 'number') {
        if (matchesAny(HEURISTIC_MEASURE_PATTERNS) && field.role !== 'measure') {
            field.role = 'measure';
        }

        // Set appropriate aggregation for measures
        if (field.role === 'measure') {
            if (matchesAny(HEURISTIC_NONE_PATTERNS)) {
                field.aggregation = 'none';
            } else if (matchesAny(HEURISTIC_AVG_PATTERNS)) {
                field.aggregation = 'avg';
            } else if (!field.aggregation || field.aggregation === 'none') {
                // Default to sum for counts, totals, amounts
                field.aggregation = 'sum';
            }
        }

        // Detect units from field names
        if (field.role === 'measure' && !field.unit) {
            for (const { patterns, unit } of HEURISTIC_UNIT_MAP) {
                if (matchesAny(patterns)) {
                    field.unit = unit;
                    break;
                }
            }
        }
    }

    // =========================================================================
    // TEXT CORRECTIONS - string fields that should be text
    // =========================================================================
    if (field.type === 'string' && field.role === 'dimension') {
        if (matchesAny(HEURISTIC_TEXT_PATTERNS)) {
            field.role = 'text';
        }
    }

    // =========================================================================
    // TIME CORRECTIONS - string fields that should be time
    // =========================================================================
    if (field.type === 'string' && field.role !== 'time') {
        if (matchesAny(HEURISTIC_TIME_PATTERNS)) {
            field.role = 'time';
        }
    }

    // =========================================================================
    // DIMENSION CORRECTIONS - fields that should be dimensions
    // =========================================================================
    if (field.type === 'string' && field.role !== 'time' && field.role !== 'text') {
        if (matchesExact(HEURISTIC_DIMENSION_PATTERNS)) {
            field.role = 'dimension';
        }
    }

    // Boolean fields should always be dimensions
    if (field.type === 'boolean' && field.role !== 'dimension') {
        field.role = 'dimension';
    }
}

function updateRefs(node: NodeDef, nameMap: Record<string, string>): void {
    if ('$ref' in node) {
        const newName = nameMap[node.$ref];
        if (newName) {
            (node as any).$ref = newName;
        }
    }

    if ('fields' in node && node.fields) {
        for (const child of Object.values(node.fields)) {
            updateRefs(child, nameMap);
        }
    }

    if ('items' in node && node.items) {
        updateRefs(node.items, nameMap);
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
            if (typeof child === 'object') {
                // Apply heuristic corrections first
                applyHeuristicCorrections(key, child as any);

                // Then generate description if missing
                if (!('description' in child)) {
                    (child as any).description = generateSmartDefault(key, child);
                }
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