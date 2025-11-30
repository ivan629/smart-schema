import { FIELD_ROLE_PATTERNS } from './constants.js';
import type { AggregationType, FieldRole, PersonalDataType, StatsField } from './types.js';
import {
    getLastPathSegment,
    pathContainsAny,
    pathEndsWithAny,
    pathMatchesIdentifier,
    toReadableFieldName,
} from './utils.js';

export function inferFieldRole(field: StatsField): FieldRole {
    const lowerPath = field.path.toLowerCase();

    if (field.type === 'date') {
        return 'time';
    }

    if (
        pathEndsWithAny(lowerPath, FIELD_ROLE_PATTERNS.timeIndicators) ||
        lowerPath.includes('timestamp')
    ) {
        return 'time';
    }

    if (field.format === 'uuid') {
        return 'identifier';
    }

    if (pathMatchesIdentifier(lowerPath)) {
        return 'identifier';
    }

    const isNumeric = field.type === 'number' || field.type === 'int';

    if (isNumeric && pathContainsAny(lowerPath, FIELD_ROLE_PATTERNS.measureKeywords)) {
        return 'measure';
    }

    if (field.type === 'array' || field.type === 'object') {
        return 'metadata';
    }

    if (pathContainsAny(lowerPath, FIELD_ROLE_PATTERNS.textKeywords)) {
        return 'text';
    }

    if (isNumeric) {
        return 'measure';
    }

    return 'dimension';
}

export function inferFieldDescription(field: StatsField): string {
    const lastSegment = getLastPathSegment(field.path);
    const readable = toReadableFieldName(lastSegment);

    const typeLabel =
        field.type === 'array'
            ? 'list of values'
            : field.type === 'object'
              ? 'nested object'
              : field.type === 'date'
                ? 'timestamp'
                : field.type;

    const nullableNote = field.nullable ? ', may be null' : '';

    return `${readable} (${typeLabel})${nullableNote}`;
}

export function inferPersonalDataType(field: StatsField): PersonalDataType | false {
    const lowerPath = field.path.toLowerCase();
    const patterns = FIELD_ROLE_PATTERNS.personalDataPatterns;

    if (field.format === 'email' || pathContainsAny(lowerPath, patterns.email)) {
        return 'email';
    }

    if (pathContainsAny(lowerPath, patterns.phone)) {
        return 'phone';
    }

    const isNameField =
        pathContainsAny(lowerPath, patterns.name) ||
        lowerPath === 'name' ||
        lowerPath.endsWith('.name');

    if (isNameField) {
        return 'name';
    }

    if (pathContainsAny(lowerPath, patterns.address)) {
        return 'address';
    }

    if (pathContainsAny(lowerPath, patterns.ssn)) {
        return 'ssn';
    }

    if (pathContainsAny(lowerPath, patterns.creditCard)) {
        return 'credit_card';
    }

    if (pathContainsAny(lowerPath, patterns.ipAddress) || lowerPath === 'ip') {
        return 'ip_address';
    }

    return false;
}

export function inferAggregationType(field: StatsField): AggregationType {
    const isNumeric = field.type === 'number' || field.type === 'int';
    return isNumeric ? 'sum' : 'none';
}
