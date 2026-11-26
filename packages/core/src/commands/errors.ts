/**
 * Plain-language errors (ADR-0002 §A7). A refused command is information: Claude
 * reads the message, adjusts and tries again, so every message names the field,
 * says what was wrong and, where possible, what would work.
 */
import type { z } from 'zod';

export type CommandErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'not_allowed'
  | 'unknown_command'
  | 'internal';

export interface CommandError {
  code: CommandErrorCode;
  /** One or two sentences, readable by a person and by Claude. */
  message: string;
  /** Dotted path of the input field at fault, e.g. "position.y". */
  path?: string;
  /** What to try instead, e.g. `Did you mean "spf-no2"?`. */
  hint?: string;
}

export function commandError(
  code: CommandErrorCode,
  message: string,
  extra: { path?: string; hint?: string } = {},
): CommandError {
  const err: CommandError = { code, message };
  if (extra.path !== undefined) err.path = extra.path;
  if (extra.hint !== undefined) err.hint = extra.hint;
  return err;
}

/** Join errors into one block of text, e.g. for a tool result. */
export function formatErrors(errors: readonly CommandError[]): string {
  return errors.map((e) => (e.hint ? `${e.message} ${e.hint}` : e.message)).join('\n');
}

export function pathToString(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

function valueAt(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `text ("${v.length > 40 ? `${v.slice(0, 40)}…` : v}")`;
  return `${typeof v === 'number' ? 'a number' : typeof v} (${String(v)})`;
}

const TYPE_WORDS: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
  null: 'null',
};

/** Prefix a predicate ("must be…") or sentence with the field name. */
function withField(field: string, message: string): string {
  if (field === '') return message.charAt(0).toUpperCase() + message.slice(1);
  return /^[a-z]/.test(message) ? `"${field}" ${message}` : `"${field}": ${message}`;
}

function ensureStop(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * Turn Zod issues into one plain sentence each, naming the field in words:
 * `"length" must be more than zero (you gave -610 mm (-2' 0")).`, `"materialId" is required.`
 * Pass the raw input so missing fields can be told apart from wrong types.
 */
export function zodIssuesToErrors(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  rawInput?: unknown,
): CommandError[] {
  return issues.map((issue) => {
    const field = pathToString(issue.path);
    const value = valueAt(rawInput, issue.path);
    const missing = issue.path.length > 0 && value === undefined;
    let message: string;
    let hint: string | undefined;

    switch (issue.code) {
      case 'invalid_type': {
        const expected = TYPE_WORDS[issue.expected] ?? issue.expected;
        if (missing) message = `"${field}" is required`;
        else if (field === '') message = `The input should be ${expected}, but got ${describeValue(value ?? rawInput)}`;
        else message = `"${field}" should be ${expected}, but got ${describeValue(value)}`;
        break;
      }
      case 'invalid_union':
        message = missing ? `"${field}" is required` : withField(field, issue.message);
        break;
      case 'invalid_value': {
        const options = issue.values.map((v) => JSON.stringify(v)).join(', ');
        message = missing
          ? `"${field}" is required; use one of ${options}`
          : `"${field}" must be one of ${options} (you gave ${JSON.stringify(value)})`;
        if (typeof value === 'string') {
          const close = suggest(value, issue.values.filter((v): v is string => typeof v === 'string'));
          if (close !== undefined) hint = `Did you mean "${close}"?`;
        }
        break;
      }
      case 'too_small': {
        const min = Number(issue.minimum);
        if (issue.origin === 'array' || issue.origin === 'set') {
          message = `"${field}" needs at least ${min} item${min === 1 ? '' : 's'}`;
        } else if (issue.origin === 'string') {
          message = min <= 1 ? `"${field}" can't be blank` : `"${field}" needs at least ${min} characters`;
        } else {
          const op = issue.inclusive ? 'at least' : 'more than';
          message = `"${field}" must be ${op} ${min} (you gave ${String(value)})`;
        }
        break;
      }
      case 'too_big': {
        const max = Number(issue.maximum);
        if (issue.origin === 'array' || issue.origin === 'set') {
          message = `"${field}" can have at most ${max} item${max === 1 ? '' : 's'}`;
        } else if (issue.origin === 'string') {
          message = `"${field}" can be at most ${max} characters`;
        } else {
          const op = issue.inclusive ? 'at most' : 'less than';
          message = `"${field}" must be ${op} ${max} (you gave ${String(value)})`;
        }
        break;
      }
      case 'unrecognized_keys': {
        const keys = issue.keys.map((k) => `"${k}"`).join(', ');
        const where = field === '' ? '' : ` in "${field}"`;
        message = `Unknown field${issue.keys.length === 1 ? '' : 's'} ${keys}${where}`;
        break;
      }
      case 'invalid_format':
        message = withField(field, issue.message);
        break;
      default:
        message = withField(field, issue.message);
    }

    return commandError('invalid_input', ensureStop(message), {
      ...(field !== '' ? { path: field } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
  });
}

/** Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * The closest candidate to `input`, if any is close enough to be a likely typo.
 * Case-insensitive; also matches when one contains the other ("2x4" → "spf-2x4").
 */
export function suggest(input: string, candidates: Iterable<string>): string | undefined {
  const needle = input.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const hay = c.toLowerCase();
    let score = editDistance(needle, hay);
    if (needle.length >= 2 && (hay.includes(needle) || needle.includes(hay))) score = Math.min(score, 1.5);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const limit = Math.max(2, Math.floor(needle.length / 3));
  return bestScore <= limit ? best : undefined;
}

/** `There's no material "spf-2x4".` plus a "Did you mean" hint when one is close. */
export function notFound(
  kind: string,
  id: string,
  candidates: Iterable<string>,
  path?: string,
): CommandError {
  const close = suggest(id, candidates);
  return commandError('not_found', `There's no ${kind} "${id}".`, {
    ...(path !== undefined ? { path } : {}),
    ...(close !== undefined ? { hint: `Did you mean "${close}"?` } : {}),
  });
}
