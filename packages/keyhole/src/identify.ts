/**
 * Who is calling, for the per-user rate limit. Without sign-in the user is the client IP,
 * hashed so raw IPs are never stored. With Supabase sign-in, `supabase-identify.ts` supplies
 * the signed-in user's id instead.
 */
import { createHash } from 'node:crypto';

export type Identify = (request: Request) => string | Promise<string>;

export function clientIp(request: Request): string {
  const h = request.headers;
  const first = (value: string | null) => value?.split(',')[0]?.trim() || undefined;
  return first(h.get('x-vercel-forwarded-for')) ?? first(h.get('x-forwarded-for')) ?? first(h.get('x-real-ip')) ?? 'local';
}

export const identifyUser: Identify = (request) =>
  createHash('sha256').update(`slapdash-keyhole:${clientIp(request)}`).digest('hex').slice(0, 32);
