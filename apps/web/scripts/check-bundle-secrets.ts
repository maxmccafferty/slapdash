/**
 * Proves no server secret can reach the browser bundle (ADR-0001 §2).
 *
 *   pnpm check:secrets
 *
 * Builds the web app into a temp folder with sentinel secrets — `ANTHROPIC_API_KEY`,
 * `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` — set both in `process.env` and in a
 * `.env` file used as the build's `envDir`, then scans every emitted file for the sentinels
 * and for signs of server code (the variable names, the `x-api-key` header, the Anthropic API
 * host, the SDK, `service_role`). Fake Supabase browser settings are set too, so the
 * Supabase chunk is built and scanned; the check also asserts that the publishable key *is*
 * in the bundle, so it can't pass by building nothing. Exits non-zero and names the file on
 * any hit.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

const sentinel = `sk-ant-SENTINEL-${randomBytes(12).toString('hex')}`;
const supabaseSecret = `sb_secret_SENTINEL${randomBytes(12).toString('hex')}`;
const serviceRole = `eyJhbGciOiJIUzI1NiJ9.SENTINEL-${randomBytes(12).toString('hex')}.service`;
const publishable = `sb_publishable_check${randomBytes(6).toString('hex')}`;
const SENTINELS = new Map([
  [sentinel, 'the sentinel API key'],
  [supabaseSecret, 'the sentinel Supabase secret key'],
  [serviceRole, 'the sentinel Supabase service-role key'],
]);
const FORBIDDEN = [
  ...SENTINELS.keys(),
  'ANTHROPIC_API_KEY',
  'x-api-key',
  'api.anthropic.com',
  '@anthropic-ai/sdk',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
];
const SECRET_ENV = {
  ANTHROPIC_API_KEY: sentinel,
  SUPABASE_SECRET_KEY: supabaseSecret,
  SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  // Browser settings, so the lazy Supabase chunk is emitted and scanned.
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const work = mkdtempSync(join(tmpdir(), 'slapdash-secrets-'));
const outDir = join(work, 'dist');
const envDir = join(work, 'env');
try {
  Object.assign(process.env, SECRET_ENV);
  mkdirSync(envDir);
  writeFileSync(
    join(envDir, '.env'),
    Object.entries(SECRET_ENV)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  );

  await build({
    root: appRoot,
    configFile: join(appRoot, 'vite.config.ts'),
    envDir,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
  });

  const emitted = files(outDir);
  const hits: string[] = [];
  let publishableSeen = false;
  let supabaseChunk = false;
  for (const path of emitted) {
    const text = readFileSync(path).toString('latin1');
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) hits.push(`${relative(outDir, path)}: contains ${SENTINELS.get(needle) ?? JSON.stringify(needle)}`);
    }
    if (text.includes(publishable)) publishableSeen = true;
    if (text.includes('auth/v1')) supabaseChunk = true;
  }
  if (!publishableSeen) hits.push('the publishable Supabase key is not in the bundle: the env never reached the build, so the check proves nothing');
  if (!supabaseChunk) hits.push('no Supabase client code in the bundle: the Supabase chunk was not built, so it was not scanned');

  if (hits.length > 0) {
    console.error(`check:secrets FAILED — server secrets or server code reached the browser bundle:\n  ${hits.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `check:secrets ok — scanned ${emitted.length} emitted files (with the Supabase chunk); no Anthropic or Supabase secret, key name, x-api-key, Anthropic host, SDK or service_role. The publishable key is present.`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
