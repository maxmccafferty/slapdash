/**
 * Adapts the Web `Request → Response` keyhole to Node's `http` / Connect middleware, for the
 * Vite dev server. Vercel calls the Web handler directly.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { KeyholeHandler } from './handler.ts';

export function toWebRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl ?? req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
  } as RequestInit);
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  const body = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
  res.on('close', () => body.destroy());
  for await (const chunk of body) {
    if (res.destroyed) break;
    res.write(chunk);
  }
  res.end();
}

/**
 * `(req, res, next)` middleware. Mount it at the endpoint's path. Pass `{ load }` to build
 * the handler on the first request instead of at startup.
 */
export function toNodeMiddleware(source: KeyholeHandler | { load: () => Promise<KeyholeHandler> }) {
  let resolved: Promise<KeyholeHandler> | undefined;
  const get = (): Promise<KeyholeHandler> =>
    (resolved ??= (typeof source === 'function' ? Promise.resolve(source) : source.load()).catch((error: unknown) => {
      resolved = undefined; // try again on the next request, e.g. after fixing the .env
      throw error;
    }));

  return (req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void): void => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    void (async () => {
      const keyhole = await get();
      const response = await keyhole(toWebRequest(req, controller.signal));
      await sendWebResponse(res, response);
    })().catch((error: unknown) => {
      if (next) next(error);
      else if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      } else res.destroy();
    });
  };
}

declare module 'node:http' {
  interface IncomingMessage {
    /** Set by Connect when a middleware is mounted at a path. */
    originalUrl?: string;
  }
}
