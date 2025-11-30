import _ from 'lodash';

export interface SampleResult<T> {
    readonly rows: readonly T[];
    readonly total: number;
    readonly sampled?: number;
}

export function sampleRows<T>(rows: readonly T[], maxRows: number): SampleResult<T> {
    const totalCount = rows.length;

    if (totalCount <= maxRows) {
        return { rows, total: totalCount };
    }

    return {
        rows: _.sampleSize(rows, maxRows),
        total: totalCount,
        sampled: maxRows,
    };
}
