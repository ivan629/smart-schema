export { analyze, LimitExceededError } from './analyze.js';
export type { DetectedTables } from './detect.js';
export type { EnrichOptions } from './enrich.js';
export type { SampleResult } from './sample.js';
export type { ComputeStatsOptions } from './stats.js';
export { computeStats } from './stats.js';

export { expand } from './compress.js';

export type {
    Archetype,
    ArchetypeField,
    CompressedEntity,
    CompressedField,
    CompressedSchema as Schema,
    CompressedTable,
    Pattern,
    ReferenceLink,
    SchemaDefaults,
    SchemaMap,
} from './compress.js';

export type {
    AggregationType,
    AnalyzeOptions,
    Entity,
    Field,
    FieldFormat,
    FieldRole,
    FieldType,
    Logger,
    PersonalDataType,
    Relationship,
    RelationshipType,
    StatsField,
    StatsMultiTableSchema,
    StatsTableSchema,
    TableCapabilities,
    TimeGranularity,
} from './types.js';

export {
    AIEnrichmentError,
    AIValidationError,
    APIError,
    consoleLogger,
    InvalidInputError,
    nullLogger,
    TimeoutError,
} from './types.js';