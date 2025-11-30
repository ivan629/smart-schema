import _ from 'lodash';
import { InvalidInputError } from './types.js';

export interface DetectedTables {
    readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

type PlainObject = Record<string, unknown>;

function convertPrimitiveArrayToRows(array: unknown[]): PlainObject[] {
    return array.map((value) => ({ value }));
}

function convertNestedArrayToRows(array: unknown[][]): PlainObject[] {
    return array.map((row) =>
        row.reduce<PlainObject>((obj, value, index) => {
            obj[`[${index}]`] = value;
            return obj;
        }, {})
    );
}

function processArrayProperty(array: unknown[]): PlainObject[] | null {
    if (_.every(array, _.isPlainObject)) {
        return array as PlainObject[];
    }

    if (_.every(array, Array.isArray)) {
        return convertNestedArrayToRows(array as unknown[][]);
    }

    if (_.every(array, (v) => !_.isObject(v))) {
        return convertPrimitiveArrayToRows(array);
    }

    return null;
}

function detectFromArray(input: unknown[]): DetectedTables {
    if (input.length === 0) {
        throw new InvalidInputError('empty');
    }

    if (_.every(input, _.isPlainObject)) {
        return { tables: { root: input as PlainObject[] } };
    }

    if (_.every(input, Array.isArray)) {
        return { tables: { root: convertNestedArrayToRows(input as unknown[][]) } };
    }

    if (_.every(input, (v) => !_.isObject(v))) {
        return { tables: { root: convertPrimitiveArrayToRows(input) } };
    }

    const objectRows = input.filter(_.isPlainObject) as PlainObject[];
    if (objectRows.length > 0) {
        return { tables: { root: objectRows } };
    }

    throw new InvalidInputError('empty');
}

function detectFromObject(input: PlainObject): DetectedTables {
    if (_.isEmpty(input)) {
        throw new InvalidInputError('empty');
    }

    const [arrayProps, scalarProps] = _.partition(
        Object.entries(input),
        ([, value]) => Array.isArray(value) && value.length > 0
    );

    if (arrayProps.length === 0) {
        return { tables: { root: [input] } };
    }

    const tables: Record<string, PlainObject[]> = {};

    for (const [key, array] of arrayProps) {
        const processedRows = processArrayProperty(array as unknown[]);
        if (processedRows !== null) {
            tables[key] = processedRows;
        }
    }

    if (_.isEmpty(tables)) {
        throw new InvalidInputError('empty');
    }

    const metadata = Object.fromEntries(scalarProps);
    const result: DetectedTables = { tables };

    if (!_.isEmpty(metadata)) {
        return { ...result, metadata };
    }

    return result;
}

export function detect(input: unknown): DetectedTables {
    if (!_.isObject(input) || input === null) {
        throw new InvalidInputError('primitive');
    }

    if (Array.isArray(input)) {
        return detectFromArray(input);
    }

    if (_.isPlainObject(input)) {
        return detectFromObject(input as PlainObject);
    }

    throw new InvalidInputError('primitive');
}
