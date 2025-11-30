import { z } from 'zod';
import { AIValidationError } from './types.js';

const FIELD_ROLES = [
    'identifier',
    'reference',
    'dimension',
    'measure',
    'time',
    'text',
    'metadata',
] as const;

const AGGREGATION_TYPES = ['sum', 'avg', 'count', 'min', 'max', 'none'] as const;

const PERSONAL_DATA_TYPES = [
    'email',
    'phone',
    'address',
    'name',
    'ssn',
    'credit_card',
    'ip_address',
    'other',
] as const;

const RELATIONSHIP_TYPES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const;

const FieldRoleSchema = z.enum(FIELD_ROLES);
const AggregationTypeSchema = z.enum(AGGREGATION_TYPES);
const PersonalDataTypeSchema = z.enum(PERSONAL_DATA_TYPES);
const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);

const nullToUndefined = <T>(value: T | null): T | undefined => value ?? undefined;

const FieldEnrichmentSchema = z.object({
    role: FieldRoleSchema,
    description: z.string().min(1),
    pii: z.union([PersonalDataTypeSchema, z.literal(false)]),
    unit: z.union([z.string(), z.null()]).optional().transform(nullToUndefined),
    aggregation: AggregationTypeSchema,
});

const FieldsResponseSchema = z.object({
    tables: z.record(z.string(), z.record(z.string(), FieldEnrichmentSchema)),
});

const RelationshipSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    type: RelationshipTypeSchema,
    confidence: z.number().min(0).max(1),
    description: z.string(),
});

const RelationshipsResponseSchema = z.object({
    relationships: z.array(RelationshipSchema),
});

const EntitySchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    idField: z.union([z.string().min(1), z.null()]).transform(nullToUndefined),
    nameField: z.union([z.string(), z.null()]).optional().transform(nullToUndefined),
    fields: z.array(z.string()),
    table: z.string().min(1),
});

const TableCapabilitiesSchema = z.object({
    timeSeries: z.union([z.string(), z.null()]).optional().transform(nullToUndefined),
    measures: z.array(z.string()),
    dimensions: z.array(z.string()),
    searchable: z.array(z.string()),
});

const TableDomainSchema = z.object({
    description: z.string(),
    dataGrain: z.string(),
    capabilities: TableCapabilitiesSchema,
});

const DomainResponseSchema = z.object({
    domain: z.string().min(1),
    description: z.string(),
    entities: z.array(EntitySchema),
    tables: z.record(z.string(), TableDomainSchema),
});

export type ValidatedFieldsResponse = z.infer<typeof FieldsResponseSchema>;
export type ValidatedRelationshipsResponse = z.infer<typeof RelationshipsResponseSchema>;
export type ValidatedDomainResponse = z.infer<typeof DomainResponseSchema>;

function formatZodErrors(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
    });
}

function parseAndValidate<T>(raw: string, schema: z.ZodSchema<T>, errorContext: string): T {
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new AIValidationError(`Invalid JSON in ${errorContext}`, raw, [
            'Failed to parse JSON',
        ]);
    }

    const result = schema.safeParse(parsed);

    if (!result.success) {
        throw new AIValidationError(
            `${errorContext} validation failed`,
            raw,
            formatZodErrors(result.error)
        );
    }

    return result.data;
}

export function validateFieldsResponse(raw: string): ValidatedFieldsResponse {
    return parseAndValidate(raw, FieldsResponseSchema, 'Fields response');
}

export function validateRelationshipsResponse(raw: string): ValidatedRelationshipsResponse {
    return parseAndValidate(raw, RelationshipsResponseSchema, 'Relationships response');
}

export function validateDomainResponse(raw: string): ValidatedDomainResponse {
    return parseAndValidate(raw, DomainResponseSchema, 'Domain response');
}
