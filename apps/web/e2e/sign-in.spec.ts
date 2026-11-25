/**
 * Sign-in on a hosted copy (ADR-0003 §K3), against the build made with Supabase settings
 * (playwright.config.ts, port 4174). Supabase itself is faked with `page.route`: Auth answers
 * password sign-ins, REST keeps rows in memory, Storage keeps bytes in memory.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { BUDGET } from '@slapdash/agent/testing';
import type { KeyholeStatus } from '@slapdash/agent';
import { FAKE_SUPABASE_URL, HOSTED_PORT } from '../playwright.config.ts';

test.use({ baseURL: `http://localhost:${HOSTED_PORT}` });

const EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery staple';
const USER = {
  id: '6c1b8f3e-1d2a-4f39-9a0b-6f1f1f1f1f1f',
  aud: 'authenticated',
  role: 'authenticated',
  email: EMAIL,
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-11-25T00:00:00Z',
};

/** A JWT-shaped token (supabase-js reads `exp` and `sub` from it; the signature isn't checked). */
function token(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.sig`;
}

function session() {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: token(), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-1', user: USER };
}

interface FakeSupabase {
  tables: Map<string, Map<string, Record<string, unknown>>>;
  signIns: number;
  keyholeAuth: (string | null)[];
}

/** Rows keyed by their primary key columns. */
const KEYS: Record<string, string[]> = { projects: ['id'], project_files: ['project_id', 'id'] };

async function fakeSupabase(page: Page): Promise<FakeSupabase> {
  const fake: FakeSupabase = { tables: new Map([['projects', new Map()], ['project_files', new Map()]]), signIns: 0, keyholeAuth: [] };
  const objects = new Map<string, Buffer>();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${FAKE_SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    if (url.pathname === '/auth/v1/token') {
      const body = req.postDataJSON() as { email?: string; password?: string };
      if (url.searchParams.get('grant_type') === 'refresh_token') return json(route, 200, session());
      if (body.email === EMAIL && body.password === PASSWORD) {
        fake.signIns++;
        return json(route, 200, session());
      }
      return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (url.pathname === '/auth/v1/user') return json(route, 200, USER);
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.startsWith('/auth/v1/')) return json(route, 404, { code: 404, error_code: 'not_found', msg: 'not in the fake' });

    if (url.pathname.startsWith('/rest/v1/')) {
      const name = url.pathname.slice('/rest/v1/'.length);
      const table = fake.tables.get(name);
      if (!table) return json(route, 404, { message: `no table ${name}` });
      const filters = [...url.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)] as const);
      const matches = (row: Record<string, unknown>) => filters.every(([k, v]) => String(row[k]) === v);
      if (method === 'GET') {
        const rows = [...table.values()].filter(matches).sort((a, b) => Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0));
        return json(route, 200, rows);
      }
      if (method === 'POST') {
        const posted = req.postDataJSON() as Record<string, unknown> | Record<string, unknown>[];
        for (const row of Array.isArray(posted) ? posted : [posted]) table.set(KEYS[name]!.map((k) => row[k]).join('/'), row);
        return route.fulfill({ status: 201, headers: cors });
      }
      if (method === 'DELETE') {
        for (const [k, row] of table) if (matches(row)) table.delete(k);
        return route.fulfill({ status: 204, headers: cors });
      }
    }

    if (url.pathname.startsWith('/storage/v1/object/')) {
      const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
      if (method === 'POST' || method === 'PUT') {
        objects.set(path, req.postDataBuffer() ?? Buffer.alloc(0));
        return json(route, 200, { Key: path });
      }
      if (method === 'DELETE') {
        const { prefixes } = req.postDataJSON() as { prefixes: string[] };
        for (const p of prefixes) objects.delete(`project-files/${p}`);
        return json(route, 200, []);
      }
      const found = objects.get(path.replace(/^authenticated\//, ''));
      return found ? route.fulfill({ status: 200, headers: cors, body: found }) : json(route, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    }
    return json(route, 404, { message: 'not in the fake' });
  });

  const status: KeyholeStatus = { configured: true, model: 'claude-test', budget: { ...BUDGET } };
  await page.route('**/api/claude', (route) => {
    fake.keyholeAuth.push(route.request().headers().authorization ?? null);
    return route.request().method() === 'GET' ? route.fulfill({ json: status }) : route.abort();
  });
  return fake;
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function signIn(page: Page, password: string) {
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('the card, a wrong password, a right one, and staying signed in after a reload', async ({ page, isMobile }) => {
  const fake = await fakeSupabase(page);
  await page.goto('/?e2e');

  const card = page.getByTestId('sign-in');
  await expect(card.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(card.getByText("You'll stay signed in on this device.")).toBeVisible();
  await expect(card.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  await expect(card.getByRole('img', { name: 'slapdash' })).toHaveCount(isMobile ? 0 : 1);
  await expect(card.getByText(/sign up|forgot/i)).toHaveCount(0);
  await expectNoAxeViolations(page);

  await signIn(page, 'wrong');
  await expect(page.getByRole('alert')).toHaveText("That email and password don't match.");
  await expectNoAxeViolations(page);

  await signIn(page, PASSWORD);
  // Chromium has WebAuthn, so the first password sign-in offers a passkey.
  await expect(page.getByRole('heading', { name: 'Use Face ID or a passkey next time?' })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Not now' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New project');
  expect(fake.signIns).toBe(1);
  await expect.poll(() => fake.keyholeAuth.some((h) => h?.startsWith('Bearer '))).toBe(true);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New project');
  await expect(page.getByTestId('sign-in')).toHaveCount(0);
  expect(fake.signIns).toBe(1);
});

test('a project made here is pushed to the cloud and listed as synced', async ({ page, isMobile }) => {
  const fake = await fakeSupabase(page);
  await page.goto('/?e2e');
  await signIn(page, PASSWORD);
  await page.getByRole('button', { name: 'Not now' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Open the sample pool house' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pool house');
  await expect.poll(() => [...fake.tables.get('projects')!.values()].map((r) => r.name)).toEqual(['Pool house']);
  if (isMobile) {
    await page.getByRole('button', { name: 'Close chat' }).click();
    await page.getByRole('button', { name: 'Project', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects' });
  await expect(dialog.getByText('Synced across your devices.')).toBeVisible();
  await expect(dialog.getByText(`Signed in as ${EMAIL}`)).toBeVisible();
});
