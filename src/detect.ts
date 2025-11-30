/**
 * Input Detection
 *
 * Detects the shape of input data and normalizes it to tables.
 */

import { InvalidInputError } from './types.js';

export interface DetectedInput {
    readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
    readonly shape: 'array' | 'object' | 'multi-table';
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
    return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.prototype.toString.call(value) === '[object Object]';
}

function isPrimitive(value: unknown): boolean {
    return value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'undefined';
}

function isArrayOfObjects(value: unknown): value is PlainObject[] {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every(isPlainObject);
}

function isMultiTable(value: unknown): value is Record<string, PlainObject[]> {
    if (!isPlainObject(value)) return false;

    const entries = Object.entries(value);
    if (entries.length === 0) return false;

    // Multi-table if ALL values are arrays of objects
    return entries.every(([, v]) => isArrayOfObjects(v));
}

export function detect(input: unknown): DetectedInput {
    // Reject primitives
    if (isPrimitive(input)) {
        throw new InvalidInputError('Input cannot be a primitive value', 'primitive');
    }

    // Reject empty
    if (Array.isArray(input) && input.length === 0) {
        throw new InvalidInputError('Input array is empty', 'empty');
    }

    if (isPlainObject(input) && Object.keys(input).length === 0) {
        throw new InvalidInputError('Input object is empty', 'empty');
    }

    // Array of primitives -> synthetic table
    if (Array.isArray(input) && input.every(isPrimitive)) {
        return {
            tables: {
                root: input.map((v, i) => ({ index: i, value: v })),
            },
            shape: 'array',
        };
    }

    // Array of objects -> single table
    if (isArrayOfObjects(input)) {
        return {
            tables: { root: input },
            shape: 'array',
        };
    }

    // Multi-table: { users: [...], orders: [...] }
    if (isMultiTable(input)) {
        return {
            tables: input,
            shape: 'multi-table',
        };
    }

    // Single object -> single-row table
    if (isPlainObject(input)) {
        return {
            tables: { root: [input] },
            shape: 'object',
        };
    }

    throw new InvalidInputError('Unable to detect input structure', 'invalid');
}