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
