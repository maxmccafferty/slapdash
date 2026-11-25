import type { KeyholeStatus } from '@slapdash/agent';

type StatusFetch = (url: string, init?: { method: 'GET'; headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function isStatus(value: unknown): value is KeyholeStatus {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<KeyholeStatus>;
  return typeof v.configured === 'boolean' && typeof v.budget === 'object' && v.budget !== null && typeof v.budget.state === 'string';
}

/**
 * `GET /api/claude`: whether Claude is set up and this month's budget. `null` when the
 * keyhole can't be reached or doesn't answer with a status (a static preview, say): the chat
 * then treats Claude as ready and lets a send surface the real error.
 */
export async function fetchKeyholeStatus(fetchImpl: StatusFetch, url = '/api/claude'): Promise<KeyholeStatus | null> {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return isStatus(body) ? body : null;
  } catch {
    return null;
  }
}
