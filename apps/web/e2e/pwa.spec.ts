/**
 * The installable app: the manifest, the service worker, and opening offline once loaded.
 * The other specs block service workers (playwright.config.ts); this one allows them.
 */
import { expect, test } from '@playwright/test';
import { BUDGET } from '@slapdash/agent/testing';
import type { KeyholeStatus } from '@slapdash/agent';

test.use({ serviceWorkers: 'allow' });

test('the manifest makes it installable and standalone', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(manifest).toMatchObject({ name: 'Slapdash', short_name: 'Slapdash', display: 'standalone', start_url: '/' });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
});

test('with ?pwa the service worker registers, and the app opens offline with the last project', async ({ page, context, isMobile }) => {
  const status: KeyholeStatus = { configured: true, model: 'claude-test', budget: { ...BUDGET } };
  await context.route('**/api/claude', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: status }) : route.abort()));
  await page.goto('/?pwa');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New project');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Wait until the worker controls the page (clientsClaim), so everything it precached is served.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30_000 }).toBe(true);

  if (isMobile) await page.getByRole('button', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Open the sample pool house' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pool house');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pool house');
  await context.setOffline(false);
});
