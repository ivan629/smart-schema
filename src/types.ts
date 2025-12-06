/**
 * SmartSchema v2 - Type Definitions
 *
 * Semantic schema format for LLM understanding.
 * Structure + Meaning + Roles + Relationships.
 */

// ============================================================================
// Core Schema
// ============================================================================

export interface SmartSchema {
    readonly domain: string;
    readonly description: string;
    readonly grain: string;
    readonly $defs?: Record<string, TypeDef>;
    readonly root: NodeDef;
    readonly capabilities: Capabilities;
    readonly entities?: Entity[];
}

// ============================================================================
// Node Types
// ============================================================================

export type NodeDef = FieldNode | ObjectNode | ArrayNode | MapNode | RefNode;

export interface FieldNode {
    readonly type: FieldType;
    readonly role?: FieldRole;
    readonly description?: string;
    readonly format?: FieldFormat;
    readonly unit?: string;
    readonly aggregation?: AggregationType;
    readonly nullable?: boolean;
}

export interface ObjectNode {
    readonly type: 'object';
    readonly role?: FieldRole;
    readonly description?: string;
    readonly fields: Record<string, NodeDef>;
}

export interface ArrayNode {
    readonly type: 'array';
    readonly description?: string;
    readonly items: NodeDef;
}

export interface MapNode {
    readonly type: 'map';
    readonly description?: string;
    readonly keys: string[] | FieldNode;  // Should support both
    readonly values: NodeDef;
}

export interface RefNode {
    readonly $ref: string;
    readonly keys?: string[];
    readonly description?: string;
}

// ============================================================================
// Type Definitions ($defs)
// ============================================================================

export interface TypeDef {
    readonly description?: string;
    readonly fields: Record<string, NodeDef>;
}

// ============================================================================
// Capabilities
// ============================================================================

export interface Capabilities {
    readonly measures: string[];
    readonly dimensions: string[];
    readonly identifiers: string[];
    readonly timeFields: string[];
    readonly searchable?: string[];
    /** Documents what each wildcard (*) in patterns represents */
    readonly wildcards?: Record<string, string[]>;
}

// ============================================================================
// Entities
// ============================================================================

export interface Entity {
    readonly name: string;
    readonly description: string;
    readonly idField: string;
    readonly nameField?: string;
}

// ============================================================================
// Field Enums
// ============================================================================

export type FieldType =
    | 'string'
    | 'int'
    | 'number'
    | 'boolean'
    | 'date'
    | 'null'
    | 'object'
    | 'array';

export type FieldRole =
    | 'identifier'
    | 'measure'
    | 'dimension'
    | 'time'
    | 'text'
    | 'metadata';

export type FieldFormat =
    | 'email'
    | 'url'
    | 'uuid'
    | 'phone'
    | 'datetime'
    | 'date'
    | 'time';

export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';

// ============================================================================
// Internal Types (stats)
// ============================================================================

export interface StatsField {
    path: string;
    type: FieldType;
    nullable: boolean;
    role: FieldRole;
    aggregation: AggregationType;
    format?: FieldFormat;
    unit?: string;
    itemType?: FieldType;
    itemFields?: StatsField[];
    // Cardinality tracking for better role inference
    cardinality?: number;
    sampleSize?: number;
    // Sample values for AI enrichment context
    samples?: unknown[];
}

export interface StatsTableSchema {
    fields: StatsField[];
}

export interface StatsMultiTableSchema {
    tables: Record<string, StatsTableSchema>;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isFieldNode(node: NodeDef): node is FieldNode {
    const n = node as FieldNode;
    return (
        n.type !== undefined &&
        n.type !== 'object' &&
        n.type !== 'array' &&
        !('$ref' in node) &&
        !('keys' in node && 'values' in node)
    );
}

export function isObjectNode(node: NodeDef): node is ObjectNode {
    return (node as ObjectNode).type === 'object' && 'fields' in node;
}

export function isArrayNode(node: NodeDef): node is ArrayNode {
    return (node as ArrayNode).type === 'array' && 'items' in node;
}

export function isMapNode(node: NodeDef): node is MapNode {
    return 'keys' in node && 'values' in node && !('$ref' in node);
}

export function isRefNode(node: NodeDef): node is RefNode {
    return '$ref' in node;
}