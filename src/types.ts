export type FieldType =
    | 'string'
    | 'number'
    | 'int'
    | 'boolean'
    | 'date'
    | 'array'
    | 'object'
    | 'null'
    | 'mixed';

export type FieldRole =
    | 'identifier'
    | 'reference'
    | 'dimension'
    | 'measure'
    | 'time'
    | 'text'
    | 'metadata';

export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';

export type TimeGranularity =
    | 'year'
    | 'quarter'
    | 'month'
    | 'week'
    | 'day'
    | 'hour'
    | 'minute'
    | 'second'
    | 'millisecond';

export type PersonalDataType =
    | 'email'
    | 'phone'
    | 'address'
    | 'name'
    | 'ssn'
    | 'credit_card'
    | 'ip_address'
    | 'other';

export type FieldFormat =
    | 'email'
    | 'url'
    | 'uuid'
    | 'slug'
    | 'phone'
    | 'datetime'
    | 'date'
    | 'time'
    | 'iso8601'
    | 'currency'
    | 'percent'
    | 'ip'
    | 'ipv6'
    | 'semver'
    | (string & {});

export type RelationshipType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface Field {
    readonly path: string;
    readonly type: FieldType;
    readonly nullable: boolean;
    readonly role: FieldRole;
    readonly description: string;
    readonly format?: FieldFormat;
    readonly unit?: string;
    readonly aggregation?: AggregationType;
    readonly personalData?: PersonalDataType | false;
    readonly itemType?: FieldType;
}

export interface StatsField {
    readonly path: string;
    readonly type: FieldType;
    readonly nullable: boolean;
    readonly format?: FieldFormat;
    readonly itemType?: FieldType;
    readonly examples: readonly unknown[];
}

export interface Entity {
    readonly name: string;
    readonly description: string;
    readonly idField?: string;
    readonly nameField?: string;
    readonly fields: readonly string[];
}

export interface Relationship {
    readonly from: string;
    readonly to: string;
    readonly type: RelationshipType;
    readonly confidence: number;
    readonly description: string;
}

export interface TableCapabilities {
    readonly timeSeries?: string;
    readonly measures: readonly string[];
    readonly dimensions: readonly string[];
    readonly searchable: readonly string[];
}

export interface StatsTableSchema {
    readonly fields: readonly StatsField[];
}

export interface TableSchema {
    readonly domain: string;
    readonly description: string;
    readonly dataGrain: string;
    readonly entities: readonly Entity[];
    readonly fields: readonly Field[];
    readonly capabilities: TableCapabilities;
}

export interface StatsMultiTableSchema {
    readonly tables: Readonly<Record<string, StatsTableSchema>>;
}

export interface MultiTableSchema {
    readonly domain: string;
    readonly description: string;
    readonly tables: Readonly<Record<string, TableSchema>>;
    readonly relationships?: readonly Relationship[];
}

export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

export const nullLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

export const consoleLogger: Logger = {
    debug: (message, ...args) => console.log(`[DEBUG] ${message}`, ...args),
    info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
    error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
};

export interface AnalyzeOptions {
    readonly apiKey: string;
    readonly maxRows?: number;
    readonly maxDepth?: number;
    readonly skipAI?: boolean;
    readonly model?: string;
    readonly logger?: Logger;
    readonly timeout?: number;
    readonly formatThreshold?: number;
    readonly mixedTypeThreshold?: number;
}

export class InvalidInputError extends Error {
    public readonly name = 'InvalidInputError' as const;

    constructor(public readonly reason: 'primitive' | 'empty') {
        super(
            reason === 'primitive' ? 'Input cannot be a primitive value' : 'Input cannot be empty'
        );
    }
}

export class AIEnrichmentError extends Error {
    public readonly name = 'AIEnrichmentError' as const;
    public cause?: Error;

    constructor(
        message: string,
        public readonly partialSchema: MultiTableSchema
    ) {
        super(message);
    }
}

export class AIValidationError extends Error {
    public readonly name = 'AIValidationError' as const;

    constructor(
        message: string,
        public readonly rawResponse: string,
        public readonly validationErrors: readonly string[]
    ) {
        super(message);
    }
}

export class APIError extends Error {
    public readonly name = 'APIError' as const;

    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false
    ) {
        super(message);
    }
}

export class TimeoutError extends Error {
    public readonly name = 'TimeoutError' as const;

    constructor(message: string = 'Operation timed out') {
        super(message);
    }
}
