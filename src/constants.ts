/**
 * SmartSchema v2 - Constants
 */

export const LIMITS = {
    maxTablesForEnrichment: 20,
    maxFieldsForEnrichment: 600,
    maxFieldsWarningThreshold: 200,
} as const;

export const DATE_FORMATS = new Set(['datetime', 'date', 'time', 'iso8601']);