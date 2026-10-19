/**
 * SQLite has no JSON or boolean storage: JSON is TEXT and booleans come back
 * as 0/1. Models re-declare those columns with these options.
 */

export const jsonColumn = {
  prepare: (value: unknown) =>
    value === null || value === undefined ? null : JSON.stringify(value),
  consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}

export const booleanColumn = {
  consume: (value: unknown) => Boolean(value),
}
