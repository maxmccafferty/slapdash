/**
 * Proves the Anthropic API key cannot reach the browser bundle (ADR-0001 §2).
 *
 *   pnpm check:secrets
 *
 * Builds the web app into a temp folder with a sentinel `ANTHROPIC_API_KEY` set both in
 * `process.env` and in a `.env` file used as the build's `envDir`, then scans every emitted
 * file for the sentinel and for signs of server code (the variable name, the `x-api-key`
 * header, the Anthropic API host, the SDK). Exits non-zero and names the file on any hit.
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
const FORBIDDEN = [sentinel, 'ANTHROPIC_API_KEY', 'x-api-key', 'api.anthropic.com', '@anthropic-ai/sdk'];

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
  process.env.ANTHROPIC_API_KEY = sentinel;
  mkdirSync(envDir);
  writeFileSync(join(envDir, '.env'), `ANTHROPIC_API_KEY=${sentinel}\n`);

  await build({
    root: appRoot,
    configFile: join(appRoot, 'vite.config.ts'),
    envDir,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
  });

  const emitted = files(outDir);
  const hits: string[] = [];
  for (const path of emitted) {
    const text = readFileSync(path).toString('latin1');
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) hits.push(`${relative(outDir, path)}: contains ${needle === sentinel ? 'the sentinel API key' : JSON.stringify(needle)}`);
    }
  }

  if (hits.length > 0) {
    console.error(`check:secrets FAILED — server secrets or server code reached the browser bundle:\n  ${hits.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`check:secrets ok — scanned ${emitted.length} emitted files; no API key, key name, x-api-key, Anthropic host or SDK.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
