/**
 * Minimal D1 implementation on top of Node's built-in SQLite.
 *
 * The Worker runtime is not available in unit tests, so this shim mirrors the
 * parts of the D1 API the project actually uses (`prepare` / `bind` / `first` /
 * `all` / `run` / `batch` / `exec`). It is deliberately small, but it behaves
 * like D1 in the ways that matter: booleans are coerced to 0/1, `undefined`
 * becomes NULL, and result objects carry `meta.changes` / `meta.last_row_id`.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Param = string | number | bigint | boolean | null | undefined | Uint8Array;

function coerce(value: Param): string | number | bigint | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object' && !(value instanceof Uint8Array)) {
    return JSON.stringify(value);
  }
  return value;
}

class D1PreparedStatementShim {
  constructor(
    private db: DatabaseSyncInstance,
    private sql: string,
    private params: Param[] = [],
  ) {}

  bind(...params: Param[]) {
    return new D1PreparedStatementShim(this.db, this.sql, params);
  }

  private stmt() {
    return this.db.raw.prepare(this.sql);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...this.params.map(coerce)) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T = Record<string, unknown>>() {
    const results = this.stmt().all(...this.params.map(coerce)) as T[];
    return { success: true, results, meta: { duration: 0, rows_read: results.length, rows_written: 0 } };
  }

  async raw<T extends unknown[] = unknown[]>() {
    const rows = this.stmt().all(...this.params.map(coerce)) as Record<string, unknown>[];
    const columns = rows.length ? Object.keys(rows[0]!) : [];
    return [columns, ...rows.map((r) => columns.map((c) => r[c]))] as unknown as T[];
  }

  async run() {
    const result = this.stmt().run(...this.params.map(coerce));
    return {
      success: true,
      results: [],
      meta: {
        duration: 0,
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        rows_read: 0,
        rows_written: Number(result.changes ?? 0),
      },
    };
  }

  /** Drizzle's D1 driver expects the statement to be `then`-able via `.run()`. */
  get _sql() {
    return this.sql;
  }
}

class DatabaseSyncInstance {
  constructor(public raw: DatabaseSync) {}

  prepare(sql: string) {
    return new D1PreparedStatementShim(this, sql);
  }

  async batch(statements: D1PreparedStatementShim[]) {
    const out = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }

  async exec(sql: string) {
    // D1's exec runs multiple statements separated by newlines.
    for (const part of sql.split(';')) {
      const trimmed = part.trim();
      if (trimmed) this.raw.exec(trimmed);
    }
    return { count: 0, duration: 0 };
  }
}

export interface D1Shim {
  db: D1Database;
  raw: DatabaseSync;
  close: () => void;
}

export function createTestD1(): D1Shim {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const instance = new DatabaseSyncInstance(raw);
  return {
    db: instance as unknown as D1Database,
    raw,
    close: () => raw.close(),
  };
}

/** Applies every file in `migrations/` in order, the way `wrangler d1 migrations apply` does. */
export function applyMigrations(db: D1Database, migrationsDir = 'migrations') {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const raw = (db as unknown as DatabaseSyncInstance).raw;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return files;
}

/** Small helper used by tests that need to inspect a single scalar. */
export function scalar<T = number>(db: D1Database, sql: string, ...params: Param[]) {
  const raw = (db as unknown as DatabaseSyncInstance).raw;
  const row = raw.prepare(sql).get(...params.map(coerce)) as Record<string, T> | undefined;
  return row ? (Object.values(row)[0] as T) : null;
}

export function queryAll<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: Param[]) {
  const raw = (db as unknown as DatabaseSyncInstance).raw;
  return raw.prepare(sql).all(...params.map(coerce)) as T[];
}

export function execute(db: D1Database, sql: string, ...params: Param[]) {
  const raw = (db as unknown as DatabaseSyncInstance).raw;
  return raw.prepare(sql).run(...params.map(coerce));
}
