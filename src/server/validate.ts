/**
 * Tiny table-driven validator.
 *
 * Every control-panel collection describes its fields once (see
 * `collections.ts`) and this module turns incoming JSON into a clean row plus a
 * list of human-readable problems. Bills are kept small on purpose: the panel
 * needs to explain *which* field is wrong, and a hand-written validator gives
 * better messages than a generic schema library at a fraction of the size.
 */

export type FieldType = 'string' | 'text' | 'int' | 'float' | 'bool' | 'json' | 'enum' | 'bilingual' | 'pairs' | 'list';

export interface FieldSpec {
  type: FieldType;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  values?: readonly string[];
  /** Reject control characters in single-line strings. */
  singleLine?: boolean;
  default?: unknown;
}

export type FieldMap = Record<string, FieldSpec>;
export type Row = Record<string, unknown>;

export interface ValidationResult {
  ok: boolean;
  row: Row;
  errors: { field: string; code: string }[];
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function cleanString(value: unknown, spec: FieldSpec): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return null;
  let out = value.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n');
  if (spec.singleLine) out = out.replace(/\s*\n\s*/g, ' ');
  out = out.trim();
  if (spec.maxLength && out.length > spec.maxLength) out = out.slice(0, spec.maxLength);
  return out;
}

function cleanBilingual(value: unknown, spec: FieldSpec): { ar: string; en: string } | null {
  if (value === null || value === undefined) return null;
  const source = typeof value === 'object' ? (value as Record<string, unknown>) : { ar: value };
  const limit = spec.maxLength ?? 4000;
  const ar = cleanString(source.ar ?? '', { ...spec, singleLine: spec.singleLine }) ?? '';
  const en = cleanString(source.en ?? '', { ...spec, singleLine: spec.singleLine }) ?? '';
  return { ar: ar.slice(0, limit), en: en.slice(0, limit) };
}

function cleanPairs(value: unknown, spec: FieldSpec): { ar: string; en: string }[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return [];
  const limit = spec.maxLength ?? 400;
  return value
    .slice(0, 40)
    .map((entry) => {
      const item = (typeof entry === 'string' ? { ar: entry, en: entry } : entry) as Record<string, unknown>;
      return {
        ar: (cleanString(item.ar ?? '', { type: 'string', maxLength: limit }) ?? '').slice(0, limit),
        en: (cleanString(item.en ?? '', { type: 'string', maxLength: limit }) ?? '').slice(0, limit),
      };
    })
    .filter((entry) => entry.ar || entry.en);
}

function cleanJson(value: unknown, spec: FieldSpec): unknown {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized && serialized.length > (spec.maxLength ?? 20_000)) {
    throw new Error('too-large');
  }
  return value;
}

export function validateRow(input: unknown, fields: FieldMap, options: { partial?: boolean } = {}): ValidationResult {
  const errors: { field: string; code: string }[] = [];
  const row: Row = {};
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  for (const [name, spec] of Object.entries(fields)) {
    const present = Object.prototype.hasOwnProperty.call(source, name);
    if (!present) {
      if (!options.partial && spec.default !== undefined) row[name] = spec.default;
      continue;
    }
    const raw = source[name];

    switch (spec.type) {
      case 'string':
      case 'text': {
        const value = cleanString(raw, spec);
        if (value !== null && value !== '' && spec.singleLine && /\n/.test(value)) {
          errors.push({ field: name, code: 'single_line' });
        }
        if (spec.required && !value) errors.push({ field: name, code: 'required' });
        row[name] = value === '' && spec.required ? value : value;
        break;
      }
      case 'enum': {
        const value = cleanString(raw, spec);
        if (value === null || value === '') {
          if (spec.required) errors.push({ field: name, code: 'required' });
          row[name] = spec.default ?? null;
          break;
        }
        if (!spec.values?.includes(value)) {
          errors.push({ field: name, code: 'enum' });
          break;
        }
        row[name] = value;
        break;
      }
      case 'int':
      case 'float': {
        if (raw === '' || raw === null) {
          if (spec.required) errors.push({ field: name, code: 'required' });
          row[name] = spec.default ?? null;
          break;
        }
        const value = spec.type === 'int' ? Number.parseInt(String(raw), 10) : Number.parseFloat(String(raw));
        if (!Number.isFinite(value)) {
          errors.push({ field: name, code: 'not_a_number' });
          break;
        }
        let clamped = value;
        if (spec.min !== undefined) clamped = Math.max(spec.min, clamped);
        if (spec.max !== undefined) clamped = Math.min(spec.max, clamped);
        row[name] = clamped;
        break;
      }
      case 'bool': {
        row[name] = raw === true || raw === 1 || raw === '1' || raw === 'true';
        break;
      }
      case 'json': {
        try {
          row[name] = cleanJson(raw, spec);
        } catch {
          errors.push({ field: name, code: 'too_large' });
        }
        break;
      }
      case 'bilingual': {
        const value = cleanBilingual(raw, spec);
        if (spec.required && !value?.en && !value?.ar) errors.push({ field: name, code: 'required' });
        row[name] = value;
        break;
      }
      case 'pairs': {
        row[name] = cleanPairs(raw, spec);
        break;
      }
      case 'list': {
        if (Array.isArray(raw)) {
          row[name] = raw
            .slice(0, 60)
            .map((entry) => (typeof entry === 'string' ? entry.trim().slice(0, 300) : String(entry)))
            .filter(Boolean);
        } else if (typeof raw === 'string') {
          row[name] = raw
            .split(/[,\n]/)
            .map((entry) => entry.trim().slice(0, 300))
            .filter(Boolean)
            .slice(0, 60);
        } else {
          row[name] = [];
        }
        break;
      }
      default:
        row[name] = raw;
    }
  }

  return { ok: errors.length === 0, row, errors };
}

/** Compares two rows so the panel only writes what actually changed. */
export function changedFields(before: Row, after: Row): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key];
    const same = JSON.stringify(previous ?? null) === JSON.stringify(value ?? null);
    if (!same) changed.push(key);
  }
  return changed;
}
