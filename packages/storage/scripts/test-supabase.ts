/**
 * Runs the Supabase adapter tests against a local Supabase stack:
 *
 *   pnpm --filter @slapdash/storage test:supabase          (or `pnpm test:supabase` at the root)
 *   pnpm --filter @slapdash/storage test:supabase --stop   (stop the stack afterwards)
 *
 * Needs Docker. `supabase start` applies supabase/migrations; the stack is left running so
 * the next run is quick.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const stop = process.argv.includes('--stop');
const bin = (name: string) => join(PACKAGE, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const SUPABASE = bin('supabase');

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; capture?: boolean }) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  // A missing program (no Docker, say) reads as a failed run, so the caller can explain it.
  if (res.error) return { ...res, status: 127, stdout: '' };
  return res;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (run('docker', ['info'], { cwd: REPO, capture: true }).status !== 0) {
  fail('Docker isn\'t running. The Supabase tests need a local Supabase stack, which runs in Docker.');
}
if (run(SUPABASE, ['--version'], { cwd: PACKAGE, capture: true }).status !== 0) {
  fail('The Supabase CLI is missing. Run `pnpm install`.');
}

if (run(SUPABASE, ['start', '--workdir', REPO], { cwd: PACKAGE }).status !== 0) fail('`supabase start` failed.');
const status = run(SUPABASE, ['status', '-o', 'env', '--workdir', REPO], { cwd: PACKAGE, capture: true });
if (status.status !== 0) fail('`supabase status` failed.');

const vars: Record<string, string> = {};
for (const line of status.stdout.split('\n')) {
  const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
  if (m) vars[m[1]!] = m[2]!;
}
const url = vars.API_URL;
const publishable = vars.PUBLISHABLE_KEY ?? vars.ANON_KEY;
const secret = vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY;
if (!url || !publishable || !secret) fail(`Couldn't read the stack's URL and keys from \`supabase status\`: got ${Object.keys(vars).join(', ')}.`);

const tests = run(bin('vitest'), ['run', 'test/supabase-adapter.test.ts'], {
  cwd: PACKAGE,
  env: { ...process.env, SUPABASE_TEST_URL: url, SUPABASE_TEST_PUBLISHABLE_KEY: publishable, SUPABASE_TEST_SECRET_KEY: secret },
});

if (stop) run(SUPABASE, ['stop', '--workdir', REPO], { cwd: PACKAGE });
process.exit(tests.status ?? 1);
