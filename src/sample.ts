/**
 * Sampling Utility
 *
 * Samples rows from large datasets while preserving distribution.
 */

type PlainObject = Record<string, unknown>;

export interface SampleResult {
    readonly rows: readonly PlainObject[];
    readonly totalRows: number;
    readonly sampled: boolean;
}

export function sampleRows(
    rows: readonly PlainObject[],
    maxRows: number
): SampleResult {
    if (rows.length <= maxRows) {
        return {
            rows,
            totalRows: rows.length,
            sampled: false,
        };
    }

    // Reservoir sampling for uniform distribution
    const sampled: PlainObject[] = [];

    for (let i = 0; i < rows.length; i++) {
        if (i < maxRows) {
            sampled.push(rows[i]);
        } else {
            // Replace with decreasing probability
            const j = Math.floor(Math.random() * (i + 1));
            if (j < maxRows) {
                sampled[j] = rows[i];
            }
        }
    }

    return {
        rows: sampled,
        totalRows: rows.length,
        sampled: true,
    };
}