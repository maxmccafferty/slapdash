/**
 * The 2D drawing sheet in a real browser: it replaces the model in 2D, shows the plan and
 * four elevations around it with legible labels, drags and zooms toward the pointer, and
 * exports the same drawing as standalone SVG. Uses `window.__slapdash` (present with `?e2e`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface SheetDebug {
  sheetView(): { cx: number; cy: number; scale: number } | null;
  sheetSvg(): Promise<string>;
}
type ViewState = { cx: number; cy: number; scale: number };
const sheetView = (page: Page) => page.evaluate(() => (window as unknown as { __slapdash: SheetDebug }).__slapdash.sheetView()) as Promise<ViewState>;

const isDesktop = (name: string) => name === 'desktop';

async function open2d(page: Page, desktop: boolean) {
  await page.goto('/?sample=pool-house&e2e');
  await page.evaluate(() => document.fonts.ready);
  if (desktop) {
    await page.getByText('2D', { exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByText('2D', { exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByTestId('sheet')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __slapdash?: SheetDebug }).__slapdash?.sheetView?.());
}

const readout = (page: Page) => page.getByTestId('zoom-readout');

test('the sheet replaces the model and shows every view around the plan', async ({ page }, info) => {
  await open2d(page, isDesktop(info.project.name));
  const sheet = page.getByTestId('sheet');
  await expect(page.getByTestId('scene')).toBeHidden();
  for (const text of ['North', 'South', 'East', 'West', 'Plan at 4′ 0″', '6 in 12']) {
    await expect(sheet.locator('text', { hasText: text }).first()).toBeAttached();
  }
  const box = async (id: string) => (await sheet.locator(`[data-view="${id}"]`).boundingBox())!;
  const plan = await box('plan');
  const north = await box('north');
  const west = await box('west');
  expect(north.y + north.height).toBeLessThan(plan.y);
  expect((await box('south')).y).toBeGreaterThan(plan.y + plan.height);
  expect(west.x + west.width).toBeLessThan(plan.x);
  expect((await box('east')).x).toBeGreaterThan(plan.x + plan.width);
  await page.screenshot({ path: `test-results/screens/sheet-${info.project.name}.png` });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('labels are at least 14px at the fitted zoom', async ({ page }) => {
    await open2d(page, true);
    await expect(readout(page)).toContainText('100%');
    const heights = await page.getByTestId('sheet').evaluate((el) =>
      [...el.querySelectorAll('[data-dim] text, [data-mark] text, [data-view] > text')].map((t) => {
        const r = t.getBoundingClientRect();
        // Vertical labels are rotated −90°: their text height is the box's width.
        const px = t.hasAttribute('transform') ? r.width : r.height;
        return { text: t.textContent, px: Math.round(px * 10) / 10 };
      }),
    );
    expect(heights.length).toBeGreaterThan(20);
    expect(heights.filter((h) => h.px < 14)).toEqual([]);
    test.info().annotations.push({ type: 'smallest label', description: `${Math.min(...heights.map((h) => h.px))}px` });
  });

  test('drag pans without zooming; the wheel zooms toward the pointer', async ({ page }) => {
    await open2d(page, true);
    const box = (await page.getByTestId('sheet').boundingBox())!;
    const before = await sheetView(page);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 250, { steps: 5 });
    await page.mouse.up();
    const panned = await sheetView(page);
    expect(Math.abs(panned.cx - before.cx)).toBeGreaterThan(1);
    expect(Math.abs(panned.cy - before.cy)).toBeGreaterThan(1);
    expect(panned.scale).toBe(before.scale);
    await expect(readout(page)).toContainText('100%');

    // The sheet point under the cursor stays put.
    const cursor = { x: 250, y: 420 };
    const under = (s: ViewState) => ({ x: s.cx + (cursor.x - box.width / 2) / s.scale, y: s.cy + (cursor.y - box.height / 2) / s.scale });
    const p0 = under(panned);
    await page.mouse.move(box.x + cursor.x, box.y + cursor.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await sheetView(page)).scale).toBeGreaterThan(panned.scale);
    const zoomed = await sheetView(page);
    const p1 = under(zoomed);
    expect(Math.abs(p1.x - p0.x) * zoomed.scale).toBeLessThan(1);
    expect(Math.abs(p1.y - p0.y) * zoomed.scale).toBeLessThan(1);
    await expect(readout(page)).not.toContainText('100%');
  });

  test('exports the same drawing as standalone SVG', async ({ page }) => {
    await open2d(page, true);
    const svg = await page.evaluate(() => (window as unknown as { __slapdash: SheetDebug }).__slapdash.sheetSvg());
    const ok = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return doc.getElementsByTagName('parsererror').length === 0 && doc.documentElement.getAttribute('xmlns') === 'http://www.w3.org/2000/svg';
    }, svg);
    expect(ok).toBe(true);
    for (const label of ['20′ 0″', '16′ 0″', '9′ 0″', '13′ 6″', '6′ 0″', '3′ 0″', '6 in 12', 'Plan at 4′ 0″']) expect(svg).toContain(label);
    expect(svg).not.toContain('var(--');
    mkdirSync('test-results/screens', { recursive: true });
    writeFileSync('test-results/screens/sheet.svg', svg);
  });

  test('back to 3D, the readout shows the 3D zoom again', async ({ page }) => {
    await open2d(page, true);
    await page.getByTestId('sheet').focus();
    await page.keyboard.press('+');
    await expect(readout(page)).toContainText('125%');
    await page.getByText('3D', { exact: true }).click();
    await expect(readout(page)).toContainText('100%');
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone only');

  test('a two-finger pinch zooms', async ({ page }) => {
    await open2d(page, false);
    const box = (await page.getByTestId('sheet').boundingBox())!;
    const before = await sheetView(page);
    const cdp = await page.context().newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', d: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd'
            ? []
            : [
                { x: cx - d, y: cy, id: 1 },
                { x: cx + d, y: cy, id: 2 },
              ],
      });
    await touch('touchStart', 40);
    for (let d = 50; d <= 120; d += 10) await touch('touchMove', d);
    await touch('touchEnd', 0);
    await expect.poll(async () => (await sheetView(page)).scale).toBeGreaterThan(before.scale * 1.5);
  });
});
