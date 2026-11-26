import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyholeHandler } from '../src/index.ts';
import { toNodeMiddleware } from '../src/node.ts';

let server: Server | undefined;
afterEach(
  () =>
    new Promise<void>((done) => {
      if (!server) return done();
      server.closeAllConnections();
      server.close(() => done());
    }),
);

async function serve(handler: KeyholeHandler | { load: () => Promise<KeyholeHandler> }): Promise<string> {
  const mw = toNodeMiddleware(handler);
  server = createServer((req, res) => mw(req, res));
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('toNodeMiddleware', () => {
  it('passes method, path, headers and body in, and status and headers out', async () => {
    let seen: { method: string; url: string; body: string; header: string | null } | undefined;
    const base = await serve(async (request) => {
      seen = { method: request.method, url: request.url, body: await request.text(), header: request.headers.get('x-test') };
      return new Response('{"ok":true}', { status: 418, headers: { 'Content-Type': 'application/json', 'Retry-After': '7' } });
    });
    const response = await fetch(`${base}/api/claude?x=1`, { method: 'POST', body: '{"a":1}', headers: { 'x-test': 'yes' } });
    expect(response.status).toBe(418);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toEqual({ method: 'POST', url: expect.stringMatching(/\/api\/claude\?x=1$/), body: '{"a":1}', header: 'yes' });
  });

  it('streams the body in chunks as they are produced', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = await serve(
      async () =>
        new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode('first\n'));
              await gate;
              c.enqueue(new TextEncoder().encode('second\n'));
              c.close();
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const response = await fetch(`${base}/api/claude`);
    const reader = response.body!.getReader();
    // The first chunk arrives while the handler is still waiting to write the second.
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first\n');
    release();
    let rest = '';
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value);
    expect(rest).toBe('second\n');
  });

  it("fires the handler's signal when the client goes away", async () => {
    const aborted = vi.fn();
    const base = await serve(async (request) => {
      request.signal.addEventListener('abort', aborted);
      return new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('tick\n')) }));
    });
    const client = new AbortController();
    const response = await fetch(`${base}/api/claude`, { signal: client.signal });
    await response.body!.getReader().read();
    client.abort();
    await vi.waitFor(() => expect(aborted).toHaveBeenCalled());
  });

  it('loads a lazy handler once, and retries after a failed load', async () => {
    const load = vi
      .fn<() => Promise<KeyholeHandler>>()
      .mockRejectedValueOnce(new Error('bad env'))
      .mockResolvedValue(async () => new Response('ok'));
    const base = await serve({ load });
    expect((await fetch(`${base}/api/claude`)).status).toBe(500);
    expect(await (await fetch(`${base}/api/claude`)).text()).toBe('ok');
    expect(await (await fetch(`${base}/api/claude`)).text()).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
