/**
 * Conversions between database rows (snake_case, JSON-encoded columns) and the
 * objects the control panel sends and receives (camelCase, real JSON values).
 */
import type { CollectionSpec } from './collections';

export function toColumn(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toField(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** Columns that hold JSON in the database, derived from the field types. */
export function jsonColumns(spec: CollectionSpec): Set<string> {
  const set = new Set<string>();
  for (const [name, field] of Object.entries(spec.fields)) {
    if (field.type === 'json' || field.type === 'list' || field.type === 'pairs' || field.type === 'bilingual') {
      set.add(toColumn(name));
    }
  }
  return set;
}

export function rowToApi(row: Record<string, unknown>, spec?: CollectionSpec): Record<string, unknown> {
  const json = spec ? jsonColumns(spec) : null;
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    const field = toField(column);
    if (value === null || value === undefined) {
      out[field] = value ?? null;
      continue;
    }
    if (json?.has(column)) {
      out[field] = parseJson(value);
      continue;
    }
    if (column.endsWith('_at') && typeof value === 'number') {
      out[field] = value;
      out[`${field}Iso`] = new Date(value * 1000).toISOString();
      continue;
    }
    out[field] = value;
  }
  return out;
}

export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function rowsToApi(rows: Record<string, unknown>[], spec?: CollectionSpec) {
  return rows.map((row) => rowToApi(row, spec));
}

/** Turns validated panel input into bindable column values. */
export function apiToRow(
  input: Record<string, unknown>,
  spec: CollectionSpec,
  options: { partial?: boolean } = {},
): { columns: string[]; values: unknown[] } {
  const json = jsonColumns(spec);
  const columns: string[] = [];
  const values: unknown[] = [];

  for (const [field, value] of Object.entries(input)) {
    if (!(field in spec.fields)) continue;
    if (options.partial && value === undefined) continue;
    const column = toColumn(field);
    columns.push(column);
    if (value === null) {
      values.push(null);
      continue;
    }
    if (json.has(column)) {
      values.push(JSON.stringify(value));
      continue;
    }
    if (typeof value === 'boolean') {
      values.push(value ? 1 : 0);
      continue;
    }
    values.push(value);
  }

  return { columns, values };
}
