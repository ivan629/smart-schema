import type {
    Field,
    MultiTableSchema,
    TableSchema,
    Entity,
    Relationship,
    FieldRole,
    AggregationType,
    FieldType,
    FieldFormat,
    PersonalDataType,
} from './types.js';

export interface ArchetypeField {
    readonly type: FieldType;
    readonly role: FieldRole;
    readonly description: string;
    readonly aggregation?: AggregationType;
    readonly unit?: string;
    readonly format?: FieldFormat;
    readonly nullable?: boolean;
    readonly personalData?: PersonalDataType;
}

export interface Archetype {
    readonly description: string;
    readonly fields: Readonly<Record<string, ArchetypeField>>;
}

export interface SchemaMap {
    readonly path: string;
    readonly description: string;
    readonly keys: readonly string[];
    readonly valueArchetype: string;
}

export interface SchemaDefaults {
    readonly nullable: boolean;
    readonly personalData: boolean;
    readonly aggregation: AggregationType;
}

export interface ReferenceLink {
    readonly path: string;
    readonly refKeys?: string;
    readonly sameAs?: string;
}

export interface Pattern {
    readonly type: string;
    readonly [key: string]: unknown;
}

export interface CompressedField {
    readonly path: string;
    readonly type: FieldType;
    readonly role: FieldRole;
    readonly description?: string;
    readonly format?: FieldFormat;
    readonly unit?: string;
    readonly aggregation?: AggregationType;
    readonly nullable?: boolean;
    readonly personalData?: PersonalDataType;
    readonly refKeys?: string;
    readonly sameAs?: string;
}

export interface CompressedEntity {
    readonly name: string;
    readonly description: string;
    readonly table: string;
    readonly idField?: string;
    readonly nameField?: string;
    readonly primaryFields: readonly string[];
    readonly archetype?: string;
    readonly occursIn?: readonly string[];
}

export interface CompressedTable {
    readonly description: string;
    readonly dataGrain: string;
    readonly maps: readonly SchemaMap[];
    readonly fields: readonly CompressedField[];
    readonly entities: readonly CompressedEntity[];
    readonly capabilities: 'auto' | TableSchema['capabilities'];
}

export interface CompressedSchema {
    readonly domain: string;
    readonly description: string;
    readonly defaults: SchemaDefaults;
    readonly archetypes: Readonly<Record<string, Archetype>>;
    readonly patterns: readonly Pattern[];
    readonly tables: Readonly<Record<string, CompressedTable>>;
    readonly relationships?: readonly Relationship[];
}

interface FieldGroup {
    readonly basePath: string;
    readonly fields: readonly Field[];
}

function getLeafName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1] ?? path;
}

function getParentPath(path: string): string {
    const parts = path.split('.');
    return parts.slice(0, -1).join('.');
}

function getPathDepth(path: string): number {
    return path.split('.').length;
}

function fieldShapeKey(field: Field): string {
    return `${getLeafName(field.path)}:${field.type}:${field.role}:${field.aggregation ?? 'none'}:${field.unit ?? ''}:${field.format ?? ''}`;
}

function groupFieldKey(fields: readonly Field[]): string {
    const sorted = [...fields].sort((a, b) => getLeafName(a.path).localeCompare(getLeafName(b.path)));
    return sorted.map(fieldShapeKey).join('|');
}

export function extractDefaults(schema: MultiTableSchema): SchemaDefaults {
    const nullableCounts = { true: 0, false: 0 };
    const personalDataCounts = { true: 0, false: 0 };
    const aggregationCounts: Record<string, number> = {};

    for (const table of Object.values(schema.tables)) {
        for (const field of table.fields) {
            nullableCounts[String(field.nullable) as 'true' | 'false']++;
            const hasPersonalData = field.personalData !== false && field.personalData !== undefined;
            personalDataCounts[String(hasPersonalData) as 'true' | 'false']++;
            const agg = field.aggregation ?? 'none';
            aggregationCounts[agg] = (aggregationCounts[agg] ?? 0) + 1;
        }
    }

    const mostCommonAggregation = Object.entries(aggregationCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] as AggregationType ?? 'none';

    return {
        nullable: nullableCounts.true > nullableCounts.false,
        personalData: personalDataCounts.true > personalDataCounts.false,
        aggregation: mostCommonAggregation,
    };
}

function groupFieldsByParent(fields: readonly Field[]): Map<string, Field[]> {
    const groups = new Map<string, Field[]>();

    for (const field of fields) {
        const parent = getParentPath(field.path);
        if (!parent) continue;

        const existing = groups.get(parent) ?? [];
        existing.push(field);
        groups.set(parent, existing);
    }

    return groups;
}

function findSiblingGroups(fields: readonly Field[]): FieldGroup[] {
    const byParent = groupFieldsByParent(fields);
    const groups: FieldGroup[] = [];

    const parentsByGrandparent = new Map<string, string[]>();
    for (const parent of byParent.keys()) {
        const grandparent = getParentPath(parent);
        if (!grandparent) continue;

        const existing = parentsByGrandparent.get(grandparent) ?? [];
        existing.push(parent);
        parentsByGrandparent.set(grandparent, existing);
    }

    for (const [, parents] of parentsByGrandparent) {
        if (parents.length < 3) continue;

        const parentFields = parents.map(p => ({
            basePath: p,
            fields: byParent.get(p) ?? [],
        }));

        const firstKey = groupFieldKey(parentFields[0]?.fields ?? []);
        const allMatch = parentFields.every(pf => groupFieldKey(pf.fields) === firstKey);

        if (allMatch && parentFields[0]?.fields.length) {
            groups.push(...parentFields);
        }
    }

    return groups;
}

export function detectArchetypes(
    schema: MultiTableSchema,
    minSiblings: number = 3
): Record<string, Archetype> {
    const archetypes: Record<string, Archetype> = {};
    const seenShapes = new Map<string, string>();

    for (const table of Object.values(schema.tables)) {
        const siblingGroups = findSiblingGroups(table.fields);

        if (siblingGroups.length < minSiblings) continue;

        const key = groupFieldKey(siblingGroups[0]?.fields ?? []);

        if (seenShapes.has(key)) continue;

        const sampleFields = siblingGroups[0]?.fields ?? [];
        const basePath = siblingGroups[0]?.basePath ?? '';
        const parentName = getLeafName(getParentPath(basePath));

        const archetypeName = inferArchetypeName(sampleFields, parentName);

        const fields: Record<string, ArchetypeField> = {};
        for (const field of sampleFields) {
            const leafName = getLeafName(field.path);
            const personalData = field.personalData !== false && field.personalData !== undefined
                ? field.personalData
                : undefined;

            fields[leafName] = {
                type: field.type,
                role: field.role,
                description: generalizeDescription(field.description, basePath),
                ...(field.aggregation && field.aggregation !== 'none' && { aggregation: field.aggregation }),
                ...(field.unit && { unit: field.unit }),
                ...(field.format && { format: field.format }),
                ...(personalData && { personalData }),
            };
        }

        archetypes[archetypeName] = {
            description: inferArchetypeDescription(sampleFields, parentName),
            fields,
        };

        seenShapes.set(key, archetypeName);
    }

    return archetypes;
}

function inferArchetypeName(fields: readonly Field[], context: string): string {
    const hasScore = fields.some(f => getLeafName(f.path) === 'score');
    const hasConfidence = fields.some(f => getLeafName(f.path) === 'confidence');
    const hasEvidence = fields.some(f => getLeafName(f.path) === 'evidence');

    if (hasScore && hasConfidence && hasEvidence) {
        return 'scored_assessment';
    }

    if (hasScore && hasConfidence) {
        return 'scored_metric';
    }

    return `${context}_item`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

function inferArchetypeDescription(fields: readonly Field[], context: string): string {
    const hasScore = fields.some(f => getLeafName(f.path) === 'score');
    const hasConfidence = fields.some(f => getLeafName(f.path) === 'confidence');
    const hasEvidence = fields.some(f => getLeafName(f.path) === 'evidence');

    if (hasScore && hasConfidence && hasEvidence) {
        return 'Quantified analysis with confidence rating and supporting evidence';
    }

    return `Structured ${context} data`;
}

function generalizeDescription(description: string, basePath: string): string {
    const specificTerms = basePath.split('.').filter(p => p.length > 2);
    let result = description;

    for (const term of specificTerms) {
        const regex = new RegExp(term, 'gi');
        result = result.replace(regex, 'item');
    }

    return result;
}

export function detectMaps(
    schema: MultiTableSchema,
    archetypes: Record<string, Archetype>,
    minKeys: number = 3
): Map<string, SchemaMap> {
    const maps = new Map<string, SchemaMap>();
    const archetypeShapes = new Map<string, string>();

    for (const [name, archetype] of Object.entries(archetypes)) {
        const shape = Object.entries(archetype.fields)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v.type}:${v.role}`)
            .join('|');
        archetypeShapes.set(shape, name);
    }

    for (const table of Object.values(schema.tables)) {
        const byParent = groupFieldsByParent(table.fields);
        const parentsByGrandparent = new Map<string, string[]>();

        for (const parent of byParent.keys()) {
            const grandparent = getParentPath(parent);
            if (!grandparent) continue;

            const existing = parentsByGrandparent.get(grandparent) ?? [];
            existing.push(parent);
            parentsByGrandparent.set(grandparent, existing);
        }

        for (const [grandparent, parents] of parentsByGrandparent) {
            if (parents.length < minKeys) continue;

            const firstFields = byParent.get(parents[0] ?? '') ?? [];
            const shape = firstFields
                .map(f => `${getLeafName(f.path)}:${f.type}:${f.role}`)
                .sort()
                .join('|');

            const archetypeName = archetypeShapes.get(shape);
            if (!archetypeName) continue;

            const allMatch = parents.every(p => {
                const fields = byParent.get(p) ?? [];
                const key = fields
                    .map(f => `${getLeafName(f.path)}:${f.type}:${f.role}`)
                    .sort()
                    .join('|');
                return key === shape;
            });

            if (!allMatch) continue;

            const keys = parents.map(p => getLeafName(p)).sort();
            const parentField = table.fields.find(f => f.path === grandparent);

            maps.set(grandparent, {
                path: grandparent,
                description: parentField?.description ?? `Collection of ${archetypeName} items`,
                keys,
                valueArchetype: archetypeName,
            });
        }
    }

    return maps;
}

export function inferContainers(schema: MultiTableSchema): Set<string> {
    const containers = new Set<string>();

    for (const table of Object.values(schema.tables)) {
        for (const field of table.fields) {
            if (field.type === 'object' && field.role === 'metadata') {
                const hasDirectValue = table.fields.some(f =>
                    f.path !== field.path &&
                    getParentPath(f.path) === field.path &&
                    f.type !== 'object'
                );

                if (!hasDirectValue) {
                    containers.add(field.path);
                }
            }
        }
    }

    return containers;
}

export function detectReferences(schema: MultiTableSchema, maps: Map<string, SchemaMap>): ReferenceLink[] {
    const links: ReferenceLink[] = [];
    const mapPaths = new Set(maps.keys());
    const seenValues = new Map<string, string>();

    for (const table of Object.values(schema.tables)) {
        for (const field of table.fields) {
            if (field.type !== 'string' || field.role !== 'dimension') continue;

            const leafName = getLeafName(field.path).toLowerCase();

            for (const mapPath of mapPaths) {
                const mapLeaf = getLeafName(mapPath).toLowerCase();

                if (leafName.includes(mapLeaf.slice(0, -1)) ||
                    leafName.includes('highest') ||
                    leafName.includes('lowest') ||
                    leafName.includes('top') ||
                    leafName.includes('primary')) {

                    const parent = getParentPath(field.path);
                    const mapParent = getParentPath(mapPath);

                    if (parent.startsWith(mapParent) || mapParent.startsWith(parent.split('.').slice(0, -1).join('.'))) {
                        links.push({ path: field.path, refKeys: mapPath });
                        break;
                    }
                }
            }
        }

        for (const field of table.fields) {
            const descKey = `${field.type}:${field.role}:${field.description}`;

            if (seenValues.has(descKey) && seenValues.get(descKey) !== field.path) {
                const originalPath = seenValues.get(descKey)!;
                if (getPathDepth(field.path) > getPathDepth(originalPath)) {
                    links.push({ path: field.path, sameAs: originalPath });
                }
            } else {
                seenValues.set(descKey, field.path);
            }
        }
    }

    return links;
}

export function detectPatterns(schema: MultiTableSchema, maps: Map<string, SchemaMap>): Pattern[] {
    const patterns: Pattern[] = [];

    for (const table of Object.values(schema.tables)) {
        const hasRequest = table.fields.some(f => f.path === 'request' || f.path.startsWith('request.'));
        const hasResult = table.fields.some(f => f.path === 'result' || f.path.startsWith('result.'));

        if (hasRequest && hasResult) {
            patterns.push({
                type: 'request_response',
                input: 'request',
                output: 'result',
            });
        }
    }

    const mapPaths = [...maps.keys()];
    const mapsByParentParent = new Map<string, string[]>();

    for (const mapPath of mapPaths) {
        const parent = getParentPath(mapPath);
        const grandparent = getParentPath(parent);

        if (grandparent) {
            const existing = mapsByParentParent.get(grandparent) ?? [];
            existing.push(parent);
            mapsByParentParent.set(grandparent, existing);
        }
    }

    for (const [grandparent, parents] of mapsByParentParent) {
        if (parents.length >= 2) {
            const uniqueParents = [...new Set(parents)];
            patterns.push({
                type: 'parallel_analysis',
                parent: grandparent,
                analyses: uniqueParents.map(p => ({
                    path: p,
                    name: getLeafName(p),
                })),
            });
        }
    }

    for (const table of Object.values(schema.tables)) {
        const metaPaths = table.fields
            .filter(f => f.path.endsWith('.meta') || getLeafName(f.path) === 'meta')
            .map(f => f.path);

        for (const metaPath of metaPaths) {
            const parent = getParentPath(metaPath);
            const siblingMap = mapPaths.find(mp => getParentPath(mp) === parent);

            if (siblingMap) {
                patterns.push({
                    type: 'meta_summary',
                    meta: metaPath,
                    data: siblingMap,
                });
            }
        }
    }

    return patterns;
}

export function simplifyEntities(
    schema: MultiTableSchema,
    archetypes: Record<string, Archetype>,
    maps: Map<string, SchemaMap>
): Record<string, CompressedEntity[]> {
    const result: Record<string, CompressedEntity[]> = {};

    for (const [tableName, table] of Object.entries(schema.tables)) {
        const entities: CompressedEntity[] = [];

        for (const entity of table.entities) {
            const primaryFields = entity.fields
                .filter(f => !f.includes('.') || getPathDepth(f) <= 2)
                .slice(0, 10);

            entities.push({
                name: entity.name,
                description: entity.description,
                table: tableName,
                ...(entity.idField && { idField: entity.idField }),
                ...(entity.nameField && { nameField: entity.nameField }),
                primaryFields,
            });
        }

        for (const [archetypeName, archetype] of Object.entries(archetypes)) {
            const matchingMaps = [...maps.values()].filter(m => m.valueArchetype === archetypeName);

            if (matchingMaps.length > 0) {
                const occursIn = matchingMaps.map(m => `${m.path}.*`);

                const alreadyExists = entities.some(e => e.archetype === archetypeName);
                if (!alreadyExists) {
                    entities.push({
                        name: archetypeName,
                        description: archetype.description,
                        table: tableName,
                        archetype: archetypeName,
                        primaryFields: Object.keys(archetype.fields),
                        occursIn,
                    });
                }
            }
        }

        result[tableName] = entities;
    }

    return result;
}

function shouldIncludeField(
    field: Field,
    maps: Map<string, SchemaMap>,
    containers: Set<string>
): boolean {
    if (containers.has(field.path)) {
        return false;
    }

    for (const mapPath of maps.keys()) {
        if (field.path.startsWith(mapPath + '.') && field.path !== mapPath) {
            const relativePath = field.path.slice(mapPath.length + 1);
            if (relativePath.includes('.')) {
                return false;
            }
        }
    }

    for (const mapPath of maps.keys()) {
        const mapKeys = maps.get(mapPath)?.keys ?? [];
        for (const key of mapKeys) {
            const keyPath = `${mapPath}.${key}`;
            if (field.path.startsWith(keyPath + '.') || field.path === keyPath) {
                return false;
            }
        }
    }

    return true;
}

function compressField(
    field: Field,
    defaults: SchemaDefaults,
    references: ReferenceLink[]
): CompressedField {
    const ref = references.find(r => r.path === field.path);
    const hasPersonalData = field.personalData !== false && field.personalData !== undefined;

    const includeDescription = field.description && !isGenericDescription(field.description);
    const includeAggregation = field.aggregation && field.aggregation !== defaults.aggregation;
    const includeNullable = field.nullable !== defaults.nullable;
    const includePersonalData = hasPersonalData !== defaults.personalData && hasPersonalData && field.personalData;

    return {
        path: field.path,
        type: field.type,
        role: field.role,
        ...(includeDescription && { description: field.description }),
        ...(field.format && { format: field.format }),
        ...(field.unit && { unit: field.unit }),
        ...(includeAggregation && { aggregation: field.aggregation }),
        ...(includeNullable && { nullable: field.nullable }),
        ...(includePersonalData && { personalData: field.personalData as PersonalDataType }),
        ...(ref?.refKeys && { refKeys: ref.refKeys }),
        ...(ref?.sameAs && { sameAs: ref.sameAs }),
    };
}

function isGenericDescription(description: string): boolean {
    const generic = [
        'container object',
        'nested object',
        'metadata',
        'array of',
        'list of values',
    ];

    const lower = description.toLowerCase();
    return generic.some(g => lower.includes(g));
}

export function compress(schema: MultiTableSchema): CompressedSchema {
    const defaults = extractDefaults(schema);
    const archetypes = detectArchetypes(schema);
    const maps = detectMaps(schema, archetypes);
    const containers = inferContainers(schema);
    const references = detectReferences(schema, maps);
    const patterns = detectPatterns(schema, maps);
    const entitiesByTable = simplifyEntities(schema, archetypes, maps);

    const tables: Record<string, CompressedTable> = {};

    for (const [tableName, table] of Object.entries(schema.tables)) {
        const tableMaps = [...maps.values()].filter(m =>
            table.fields.some(f => f.path === m.path || f.path.startsWith(m.path + '.'))
        );

        const fields = table.fields
            .filter(f => shouldIncludeField(f, maps, containers))
            .map(f => compressField(f, defaults, references));

        tables[tableName] = {
            description: table.description,
            dataGrain: table.dataGrain,
            maps: tableMaps,
            fields,
            entities: entitiesByTable[tableName] ?? [],
            capabilities: 'auto',
        };
    }

    return {
        domain: schema.domain,
        description: schema.description,
        defaults,
        archetypes,
        patterns,
        tables,
        ...(schema.relationships && { relationships: schema.relationships }),
    };
}

export function expand(compressed: CompressedSchema): MultiTableSchema {
    const tables: Record<string, TableSchema> = {};

    for (const [tableName, table] of Object.entries(compressed.tables)) {
        const fields: Field[] = [];

        for (const field of table.fields) {
            fields.push({
                path: field.path,
                type: field.type,
                nullable: field.nullable ?? compressed.defaults.nullable,
                role: field.role,
                description: field.description ?? `${field.path} field`,
                ...(field.format && { format: field.format }),
                ...(field.unit && { unit: field.unit }),
                aggregation: field.aggregation ?? compressed.defaults.aggregation,
                personalData: field.personalData ?? (compressed.defaults.personalData ? 'other' : false),
            });
        }

        for (const map of table.maps) {
            const archetype = compressed.archetypes[map.valueArchetype];
            if (!archetype) continue;

            fields.push({
                path: map.path,
                type: 'object',
                nullable: compressed.defaults.nullable,
                role: 'metadata',
                description: map.description,
                aggregation: 'none',
                personalData: false,
            });

            for (const key of map.keys) {
                const keyPath = `${map.path}.${key}`;

                fields.push({
                    path: keyPath,
                    type: 'object',
                    nullable: compressed.defaults.nullable,
                    role: 'metadata',
                    description: `${key} assessment`,
                    aggregation: 'none',
                    personalData: false,
                });

                for (const [fieldName, fieldDef] of Object.entries(archetype.fields)) {
                    fields.push({
                        path: `${keyPath}.${fieldName}`,
                        type: fieldDef.type,
                        nullable: fieldDef.nullable ?? compressed.defaults.nullable,
                        role: fieldDef.role,
                        description: fieldDef.description,
                        ...(fieldDef.format && { format: fieldDef.format }),
                        ...(fieldDef.unit && { unit: fieldDef.unit }),
                        aggregation: fieldDef.aggregation ?? compressed.defaults.aggregation,
                        personalData: fieldDef.personalData ?? (compressed.defaults.personalData ? 'other' : false),
                    });
                }
            }
        }

        fields.sort((a, b) => a.path.localeCompare(b.path));

        const entities: Entity[] = table.entities
            .filter(e => !e.archetype)
            .map(e => ({
                name: e.name,
                description: e.description,
                ...(e.idField && { idField: e.idField }),
                ...(e.nameField && { nameField: e.nameField }),
                fields: e.primaryFields,
            }));

        const capabilities = table.capabilities === 'auto'
            ? deriveCapabilities(fields)
            : table.capabilities;

        tables[tableName] = {
            domain: compressed.domain,
            description: table.description,
            dataGrain: table.dataGrain,
            entities,
            fields,
            capabilities,
        };
    }

    return {
        domain: compressed.domain,
        description: compressed.description,
        tables,
        ...(compressed.relationships && { relationships: compressed.relationships }),
    };
}

function deriveCapabilities(fields: readonly Field[]): TableSchema['capabilities'] {
    const measures = fields.filter(f => f.role === 'measure').map(f => f.path);
    const dimensions = fields.filter(f => f.role === 'dimension').map(f => f.path);
    const searchable = fields.filter(f => f.role === 'text').map(f => f.path);
    const timeField = fields.find(f => f.role === 'time' && !f.path.includes('.'));

    return {
        measures,
        dimensions,
        searchable,
        ...(timeField && { timeSeries: timeField.path }),
    };
}