/**
 * Keyhole configuration, read once from the server environment. Invalid numbers throw at
 * startup with a plain message. The API key is redacted from JSON and `util.inspect`.
 */
import { inspect } from 'node:util';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface KeyholeConfig {
  /** `ANTHROPIC_API_KEY`. Undefined means "Claude isn't connected". */
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly maxTokens: number;
  readonly effort: Effort;
  /** Refusal fallback (`fallbacks: "default"`). */
  readonly fallbacks: boolean;
  readonly monthlyBudgetUsd: number;
  readonly ratePerMinute: number;
  readonly ratePerDay: number;
  readonly maxBodyBytes: number;
  readonly maxMessages: number;
  /** Extra origins allowed to POST besides the request's own host, e.g. `https://slapdash.example`. */
  readonly allowedOrigins: readonly string[];
  readonly usageFile: string;
  readonly upstash: { readonly url: string; readonly token: string } | undefined;
  /**
   * `SLAPDASH_DEFAULT_LOCATION`, e.g. "Bend, OR": the app's default location for design
   * loads, served on `GET /api/claude` so it never goes into the browser bundle.
   */
  readonly defaultLocation: string | undefined;
}

export type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function str(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function num(env: Env, name: string, fallback: number, opts: { integer?: boolean; min?: number } = {}): number {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  const min = opts.min ?? 0;
  if (!Number.isFinite(n) || n < min || (opts.integer && !Number.isInteger(n))) {
    const kind = opts.integer ? 'a whole number' : 'a number';
    throw new Error(`${name} must be ${kind} of at least ${min}; got "${raw}".`);
  }
  return n;
}

function redact<T extends { apiKey: string | undefined }>(config: T): T {
  const hidden = (value: T) => ({ ...value, apiKey: value.apiKey === undefined ? undefined : '[redacted]' });
  Object.defineProperties(config, {
    toJSON: { value: () => hidden(config), enumerable: false },
    [inspect.custom]: {
      value: (_depth: number, options: object) => inspect(hidden(config), options),
      enumerable: false,
    },
  });
  return Object.freeze(config);
}

export function readConfig(env: Env): KeyholeConfig {
  const effort = (str(env, 'SLAPDASH_EFFORT') ?? 'medium') as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`SLAPDASH_EFFORT must be one of ${EFFORTS.join(', ')}; got "${effort}".`);

  const fallbacksRaw = (str(env, 'SLAPDASH_FALLBACKS') ?? 'on').toLowerCase();
  if (!['on', 'off', 'true', 'false', '1', '0'].includes(fallbacksRaw)) {
    throw new Error(`SLAPDASH_FALLBACKS must be "on" or "off"; got "${fallbacksRaw}".`);
  }

  const upstashUrl = str(env, 'KV_REST_API_URL') ?? str(env, 'UPSTASH_REDIS_REST_URL');
  const upstashToken = str(env, 'KV_REST_API_TOKEN') ?? str(env, 'UPSTASH_REDIS_REST_TOKEN');

  return redact({
    apiKey: str(env, 'ANTHROPIC_API_KEY'),
    model: str(env, 'SLAPDASH_MODEL') ?? DEFAULT_MODEL,
    maxTokens: num(env, 'SLAPDASH_MAX_TOKENS', 32000, { integer: true, min: 1 }),
    effort,
    fallbacks: ['on', 'true', '1'].includes(fallbacksRaw),
    monthlyBudgetUsd: num(env, 'SLAPDASH_MONTHLY_BUDGET_USD', 10),
    ratePerMinute: num(env, 'SLAPDASH_RATE_PER_MINUTE', 30, { integer: true, min: 1 }),
    ratePerDay: num(env, 'SLAPDASH_RATE_PER_DAY', 1000, { integer: true, min: 1 }),
    maxBodyBytes: num(env, 'SLAPDASH_MAX_BODY_BYTES', 8 * 1024 * 1024, { integer: true, min: 1 }),
    maxMessages: num(env, 'SLAPDASH_MAX_MESSAGES', 400, { integer: true, min: 1 }),
    allowedOrigins: (str(env, 'SLAPDASH_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    usageFile: str(env, 'SLAPDASH_USAGE_FILE') ?? '.data/usage.json',
    defaultLocation: str(env, 'SLAPDASH_DEFAULT_LOCATION'),
    upstash: upstashUrl && upstashToken ? { url: upstashUrl.replace(/\/+$/, ''), token: upstashToken } : undefined,
  });
}
