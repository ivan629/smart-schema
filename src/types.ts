/**
 * SmartSchema v2 - Type Definitions
 *
 * A compressed, semantic schema format optimized for LLM understanding.
 * Structure mirrors data. Semantics inline. Redundancy eliminated via $defs.
 */

// ============================================================================
// Core Schema
// ============================================================================

export interface SmartSchema {
    readonly $version: 2;
    readonly domain: string;
    readonly description: string;
    readonly grain: string;

    readonly $defs?: Readonly<Record<string, TypeDef>>;
    readonly root: NodeDef;
    readonly capabilities: Capabilities;
    readonly entities?: readonly Entity[];
}

// ============================================================================
// Node Types (field, object, array, map, ref)
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
    readonly pii?: PiiType;
    readonly ref?: string;  // Foreign key: "users.id"
}

export interface ObjectNode {
    readonly type: 'object';
    readonly description?: string;
    readonly fields: Readonly<Record<string, NodeDef>>;
}

export interface ArrayNode {
    readonly type: 'array';
    readonly description?: string;
    readonly items: NodeDef | string;  // Inline or "$defs/typename"
}

export interface MapNode {
    readonly type: 'map';
    readonly description?: string;
    readonly keys: readonly string[];
    readonly values: NodeDef | string;  // Inline or "$defs/typename"
}

export interface RefNode {
    readonly $ref: string;  // "#/$defs/typename"
    readonly keys?: readonly string[];  // Override keys for maps
    readonly description?: string;  // Override description
}

// ============================================================================
// Type Definitions (reusable shapes)
// ============================================================================

export interface TypeDef {
    readonly description?: string;
    readonly fields: Readonly<Record<string, NodeDef>>;
}

// ============================================================================
// Capabilities
// ============================================================================

export interface Capabilities {
    readonly measures: readonly string[];      // Paths with globs: "result.*.score"
    readonly dimensions: readonly string[];
    readonly identifiers: readonly string[];
    readonly timeFields: readonly string[];
    readonly searchable?: readonly string[];
    readonly relationships?: readonly Relationship[];
}

export interface Relationship {
    readonly from: string;
    readonly to: string;
    readonly type: 'one-to-one' | 'one-to-many' | 'many-to-many';
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
// Field Types and Enums
// ============================================================================

export type FieldType =
    | 'string'
    | 'int'
    | 'number'
    | 'boolean'
    | 'date'
    | 'null'
    | 'mixed'
    | 'object'
    | 'array'
    | 'map';

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
    | 'slug'
    | 'phone'
    | 'currency'
    | 'percent'
    | 'datetime'
    | 'date'
    | 'time'
    | 'iso8601';

export type AggregationType =
    | 'sum'
    | 'avg'
    | 'count'
    | 'min'
    | 'max'
    | 'none';

export type PiiType =
    | 'name'
    | 'email'
    | 'phone'
    | 'address'
    | 'ssn'
    | 'dob'
    | 'ip'
    | 'financial'
    | 'health'
    | 'other';

// ============================================================================
// Stats Types (internal, pre-enrichment)
// ============================================================================

export interface StatsField {
    readonly path: string;
    readonly type: FieldType;
    readonly nullable: boolean;
    readonly role: FieldRole;
    readonly aggregation: AggregationType;
    readonly format?: FieldFormat;
    readonly unit?: string;
    readonly itemType?: FieldType;
    readonly sampleValues?: readonly unknown[];
}

export interface StatsTableSchema {
    readonly fields: readonly StatsField[];
}

export interface StatsMultiTableSchema {
    readonly tables: Readonly<Record<string, StatsTableSchema>>;
}

// ============================================================================
// Errors
// ============================================================================

export class InvalidInputError extends Error {
    public readonly name = 'InvalidInputError' as const;
    constructor(
        message: string,
        public readonly reason: 'primitive' | 'empty' | 'invalid'
    ) {
        super(message);
    }
}

export class AIEnrichmentError extends Error {
    public readonly name = 'AIEnrichmentError' as const;
    constructor(
        message: string,
        public readonly partialSchema: SmartSchema
    ) {
        super(message);
    }
}

export class LimitExceededError extends Error {
    public readonly name = 'LimitExceededError' as const;
}

// ============================================================================
// Logger
// ============================================================================

export interface Logger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export const silentLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

export const consoleLogger: Logger = {
    debug: (msg) => console.debug(`[smart-schema] ${msg}`),
    info: (msg) => console.info(`[smart-schema] ${msg}`),
    warn: (msg) => console.warn(`[smart-schema] ${msg}`),
    error: (msg) => console.error(`[smart-schema] ${msg}`),
};

// ============================================================================
// Type Guards
// ============================================================================

export function isFieldNode(node: NodeDef): node is FieldNode {
    const type = (node as FieldNode).type;
    return type !== undefined &&
        type !== 'object' &&
        type !== 'array' &&
        type !== 'map' &&
        !('$ref' in node);
}

export function isObjectNode(node: NodeDef): node is ObjectNode {
    return (node as ObjectNode).type === 'object' && 'fields' in node;
}

export function isArrayNode(node: NodeDef): node is ArrayNode {
    return (node as ArrayNode).type === 'array' && 'items' in node;
}

export function isMapNode(node: NodeDef): node is MapNode {
    return (node as MapNode).type === 'map' && 'keys' in node;
}

export function isRefNode(node: NodeDef): node is RefNode {
    return '$ref' in node;
}