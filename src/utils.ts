/**
 * SmartSchema v2 - Utilities
 */

export function getLeafName(path: string): string {
    return path.split('.').pop() ?? path;
}

export function getParentPath(path: string): string {
    const parts = path.split('.');
    return parts.slice(0, -1).join('.');
}

export function getPathDepth(path: string): number {
    return path.split('.').length;
}