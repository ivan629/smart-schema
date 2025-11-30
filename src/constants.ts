export const LIMITS = {
    maxTablesForEnrichment: 20,
    maxFieldsForEnrichment: 500,
    maxRowsToSample: 10_000,
    maxTraversalDepth: 50,
    maxExamplesPerField: 5,
} as const;

export const THRESHOLDS = {
    formatDetection: 0.9,
    mixedType: 0.1,
} as const;

export const AI_CONFIG = {
    defaultModel: 'claude-sonnet-4-5-20250929',
    defaultTimeoutMs: 300_000,
    maxTokens: {
        fieldEnrichment: 64_000,
        relationshipDetection: 4_096,
        domainSynthesis: {
            minimum: 8_192,
            tokensPerField: 30,
            maximum: 32_000,
        },
    },
    temperature: 0.1,
} as const;

export const TYPE_MAPPING: Readonly<Record<string, string>> = {
    null: 'null',
    bool: 'boolean',
    int: 'int',
    float: 'number',
    string: 'string',
    array: 'array',
    object: 'object',
};

export const FORMAT_MAPPING: Readonly<Record<string, string>> = {
    email: 'email',
    uri: 'url',
    uuid: 'uuid',
    datetime: 'datetime',
    date: 'date',
    time: 'time',
    ip: 'ip',
    ipv6: 'ipv6',
    semver: 'semver',
    phone: 'phone',
};

export const DATE_FORMATS: ReadonlySet<string> = new Set(['datetime', 'date', 'time', 'iso8601']);

export const FIELD_ROLE_PATTERNS = {
    timeIndicators: ['_at', '_date', 'timestamp'],
    identifierPatterns: ['id', '.id', '_id'],
    measureKeywords: ['price', 'amount', 'total', 'quantity', 'count', 'cost'],
    textKeywords: ['name', 'title', 'description', 'email', 'note'],
    personalDataPatterns: {
        email: ['email'],
        phone: ['phone', 'mobile', 'tel'],
        name: ['first_name', 'last_name', 'firstname', 'lastname'],
        address: ['address', 'street', 'city', 'zip', 'postal'],
        ssn: ['ssn', 'social_security'],
        creditCard: ['credit_card', 'card_number'],
        ipAddress: ['ip_address'],
    },
} as const;

export const RELATIONSHIP_INDICATORS = {
    foreignKeySuffixes: ['_id', 'Id'],
    selfReferencePatterns: ['parent', 'manager'],
} as const;
