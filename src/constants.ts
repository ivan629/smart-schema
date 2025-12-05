/**
 * SmartSchema v2 - Constants
 */

export const LIMITS = {
    maxTables: 20,
    maxFields: 600,
    warnFieldsThreshold: 200,
} as const;

export const DATE_FORMATS = new Set(['datetime', 'date', 'time']);