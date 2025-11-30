/**
 * Constants for SmartSchema v2
 */

export const LIMITS = {
    maxRowsToSample: 10000,
    maxTraversalDepth: 50,
    maxTablesForEnrichment: 20,
    maxFieldsForEnrichment: 600,
    maxFieldsWarningThreshold: 200,
    maxExamplesPerField: 5,
    minSiblingsForArchetype: 3,
    minKeysForMap: 3,
} as const;

export const THRESHOLDS = {
    formatDetection: 0.9,
    mixedType: 0.1,
} as const;

export const TYPE_MAPPING: Record<string, string> = {
    string: 'string',
    number: 'number',
    int: 'int',
    float: 'number',
    boolean: 'boolean',
    null: 'null',
    object: 'object',
    array: 'array',
    date: 'date',
} as const;

export const FORMAT_MAPPING: Record<string, string> = {
    email: 'email',
    uri: 'url',
    url: 'url',
    uuid: 'uuid',
    'date-time': 'datetime',
    datetime: 'datetime',
    date: 'date',
    time: 'time',
    phone: 'phone',
    hostname: 'url',
} as const;

export const DATE_FORMATS = new Set([
    'datetime',
    'date',
    'time',
    'iso8601',
]);