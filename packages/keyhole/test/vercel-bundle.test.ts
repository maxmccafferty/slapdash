import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApi } from '../../../scripts/build-api.ts';

const dir = mkdtempSync(join(tmpdir(), 'keyhole-bundle-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the Vercel bundle', () => {
  it('api/claude.js re-exports the bundle that build:api writes', () => {
    const stub = readFileSync(new URL('../../../api/claude.js', import.meta.url), 'utf8');
    expect(stub).toContain("export { GET, POST } from '../packages/keyhole/dist/vercel.js';");
  });

  it('builds into one self-contained ESM file that serves GET and POST', async () => {
    const outfile = join(dir, 'vercel.mjs');
    await buildApi(outfile);
    const text = readFileSync(outfile, 'utf8');
    // No import line left pointing at a workspace package, a dependency or a .ts file.
    expect(text).not.toMatch(/^\s*(import|export)\b[^\n]*\bfrom\s+['"](@slapdash\/|@anthropic-ai\/|zod)/m);
    expect(text).not.toMatch(/^\s*(import|export)\b[^\n]*\bfrom\s+['"][^'"]+\.ts['"]/m);

    const saved = { ...process.env };
    process.env.SLAPDASH_USAGE_FILE = join(dir, 'usage.json');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.VERCEL_ENV;
    for (const name of Object.keys(process.env)) if (name.includes('SUPABASE')) delete process.env[name];
    try {
      const mod = (await import(pathToFileURL(outfile).href)) as { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
      const get = await mod.GET(new Request('http://localhost/api/claude'));
      expect(get.status).toBe(200);
      expect(await get.json()).toMatchObject({ configured: false, model: 'claude-sonnet-5-5', budget: { state: 'ok' } });
      const post = await mod.POST(new Request('http://localhost/api/claude', { method: 'POST', body: '{}' }));
      expect(post.status).toBe(503);
    } finally {
      process.env = saved;
    }
  }, 30_000);
});
