/**
 * The 3D view in a real browser (WebGL 2 via SwiftShader): it draws, tap selects and drag
 * orbits, the view controls change what is drawn, and snapshots never move the user's view.
 * Drives the renderer through `window.__slapdash` (present with `?e2e`).
 */
import { expect, test, type Page } from '@playwright/test';

interface Debug {
  frameStats(): { frames: number };
  camera(): { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null;
  selection(): { id: string | null; label: string | null };
  kinds(): Record<string, number>;
  screenPointOf(id: string): { x: number; y: number } | null;
  renderSnapshot(req: unknown): Promise<{ png: Blob; width: number; height: number; notes: string[] }>;
}
declare global {
  interface Window {
    __slapdash: Debug;
  }
}

async function open(page: Page, query = '') {
  await page.goto(`/?sample=pool-house&e2e${query}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.__slapdash?.frameStats?.().frames > 0, undefined, { timeout: 30_000 });
  // Let the in-progress outlines and drop-ins finish.
  await page.waitForTimeout(900);
}

const canvas = (page: Page) => page.getByTestId('scene').locator('canvas');

/** Waits until two canvas captures in a row match, so textures that are still streaming in don't count as a change. */
async function settledCanvas(page: Page): Promise<Buffer> {
  let previous = await canvas(page).screenshot();
  await expect
    .poll(async () => {
      const next = await canvas(page).screenshot();
      const same = next.equals(previous);
      previous = next;
      return same;
    }, { timeout: 15_000 })
    .toBe(true);
  return previous;
}

/** Share of pixels in a centre crop of the canvas that aren't paper white. */
async function inkShare(page: Page): Promise<number> {
  const png = await canvas(page).screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const x0 = Math.floor(img.width * 0.3);
    const y0 = Math.floor(img.height * 0.3);
    const data = ctx.getImageData(x0, y0, Math.floor(img.width * 0.4), Math.floor(img.height * 0.4)).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 235 || data[i + 1]! < 235 || data[i + 2]! < 235) ink++;
    return ink / (data.length / 4);
  }, png.toString('base64'));
}

test('draws the pool-house shell', async ({ page }, info) => {
  await open(page);
  expect(await inkShare(page)).toBeGreaterThan(0.2);
  await expect(page.getByTestId('scene')).toHaveAttribute('aria-label', /^3D model: Pool house, foundation, 4 walls, 2 openings, roof\./);
  await page.screenshot({ path: `test-results/screens/renderer-${info.project.name}.png` });
});

test('tap selects, drag orbits without selecting', async ({ page, isMobile }) => {
  await open(page);
  const box = (await canvas(page).boundingBox())!;
  const target = await page.evaluate(() => window.__slapdash.screenPointOf('O1-PN01'));
  expect(target).not.toBeNull();
  const at = { x: box.x + target!.x, y: box.y + target!.y };
  if (isMobile) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__slapdash.selection().label)).toBe('Panel, Sliding door in South wall');
  await expect(page.getByTestId('scene')).toHaveAttribute('aria-label', /Selected: Panel, Sliding door in South wall\.$/);
  await page.screenshot({ path: `test-results/screens/renderer-selected-${isMobile ? 'phone' : 'desktop'}.png` });

  const before = await page.evaluate(() => window.__slapdash.camera());
  // A drag: one pointer, well past 6 px.
  const start = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', start.x, start.y);
    for (let i = 1; i <= 10; i++) await touch('touchMove', start.x + i * 12, start.y);
    await touch('touchEnd', 0, 0);
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + i * 12, start.y);
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__slapdash.camera());
  expect(after!.position).not.toEqual(before!.position);
  expect(await page.evaluate(() => window.__slapdash.selection().id)).toBe('O1-PN01');
});

test.describe('view controls', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop: the controls are in a popover on the phone');

  test('Inside removes the roof; Floors = Foundation leaves the slab', async ({ page }) => {
    await open(page);
    const outside = await canvas(page).screenshot();
    expect((await page.evaluate(() => window.__slapdash.kinds())).roof).toBeGreaterThan(0);

    await page.getByText('Inside', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__slapdash.kinds().roof ?? 0)).toBe(0);
    await page.waitForTimeout(200);
    const inside = await canvas(page).screenshot();
    expect(inside.equals(outside)).toBe(false);
    await page.screenshot({ path: 'test-results/screens/renderer-inside.png' });

    await page.getByText('Outside', { exact: true }).click();
    await page.getByRole('button', { name: /Foundation/ }).click();
    await expect.poll(() => page.evaluate(() => window.__slapdash.kinds())).toEqual({ foundation: 5 });
    await page.screenshot({ path: 'test-results/screens/renderer-foundation.png' });
  });

  test('the Floors slider shows heights from the model', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('slider', { name: 'Floors' })).toHaveAttribute('aria-valuetext', 'Roof, 13′ 10″');
  });
});

test('snapshots never move the user’s view', async ({ page }, info) => {
  await open(page);
  const camera = await page.evaluate(() => window.__slapdash.camera());
  const screenBefore = await settledCanvas(page);

  const shots = await page.evaluate(async () => {
    const read = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
    const sheet = await window.__slapdash.renderSnapshot({});
    const iso = await window.__slapdash.renderSnapshot({ angle: 'iso', mode: 'blueprint', highlight: ['W3-H01'], labels: true });
    const inside = await window.__slapdash.renderSnapshot({ angle: 'top', lookFrom: 'inside', dimensions: true });
    return Promise.all(
      [sheet, iso, inside].map(async (s) => ({ width: s.width, height: s.height, notes: s.notes, bytes: await read(s.png) })),
    );
  });
  const [sheet, iso, inside] = shots;
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const s of shots) expect(s.bytes.slice(0, 8)).toEqual(PNG);
  expect([sheet!.width, sheet!.height]).toEqual([768, 768]);
  expect(Math.max(iso!.width, iso!.height)).toBe(768);
  expect(inside!.notes.join(' ')).toMatch(/inside/i);

  const fs = await import('node:fs');
  fs.mkdirSync('test-results/screens', { recursive: true });
  const names = ['sheet', 'iso-blueprint', 'top-inside'];
  shots.forEach((s, i) => fs.writeFileSync(`test-results/screens/snapshot-${names[i]}-${info.project.name}.png`, Buffer.from(s.bytes)));

  expect(await page.evaluate(() => window.__slapdash.camera())).toEqual(camera);
  await page.waitForTimeout(200);
  expect((await canvas(page).screenshot()).equals(screenBefore)).toBe(true);
});

test('snapshot errors are plain sentences', async ({ page }) => {
  await open(page);
  const message = await page.evaluate(() => window.__slapdash.renderSnapshot({ mode: 'stress' }).then(() => 'ok', (e: Error) => e.message));
  expect(message).toBe("Snapshots can't show the stress view. Call check_structure for the most loaded parts and their % of limit.");
});
