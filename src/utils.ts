import _ from 'lodash';

export type PlainObject = Record<string, unknown>;

export function removeUndefinedValues<T extends object>(obj: T): T {
    return _.pickBy(obj, (value) => value !== undefined) as T;
}

export function escapePathSegment(segment: string): string {
    if (!/[.[\]\\]/.test(segment)) {
        return segment;
    }
    return segment
        .replace(/\\/g, '\\\\')
        .replace(/\./g, '\\.')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

export function buildFieldPath(segments: readonly string[]): string {
    return segments.join('.');
}

export function buildArrayFieldPath(basePath: string): string {
    return `${basePath}[]`;
}

export function getLastPathSegment(path: string): string {
    return path.split('.').pop() ?? path;
}

export function toReadableFieldName(fieldName: string): string {
    return fieldName
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase();
}

export function pathContainsAny(path: string, patterns: readonly string[]): boolean {
    const lowerPath = path.toLowerCase();
    return patterns.some((pattern) => lowerPath.includes(pattern));
}

export function pathEndsWithAny(path: string, suffixes: readonly string[]): boolean {
    const lowerPath = path.toLowerCase();
    return suffixes.some((suffix) => lowerPath.endsWith(suffix));
}

export function pathMatchesIdentifier(path: string): boolean {
    const lowerPath = path.toLowerCase();
    return lowerPath === 'id' || lowerPath.endsWith('.id') || lowerPath.endsWith('_id');
}

export function countTotalFields(tables: Record<string, { fields: readonly unknown[] }>): number {
    return Object.values(tables).reduce((total, table) => total + table.fields.length, 0);
}

export function extractJsonFromText(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error('No JSON object found in response');
    }
    JSON.parse(match[0]);
    return match[0];
}
