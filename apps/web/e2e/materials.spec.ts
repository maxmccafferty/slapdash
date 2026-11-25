/**
 * The Materials modal and the PDF export in a real browser: it covers the model only, the
 * chat stays usable beside it (desktop) or over it (phone), the Cut list tab works, and
 * Export PDF downloads a three-page letter PDF of the pool house.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { expect, test, type Page } from '@playwright/test';
import { installFakeVoice } from './fake-voice.ts';

const materials = (page: Page) => page.getByRole('dialog', { name: 'Materials' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Message Claude' });

test.beforeEach(async ({ page }) => {
  await installFakeVoice(page);
  await page.goto('/?sample=pool-house');
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('test-results/screens', { recursive: true });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('covers the model only, and the chat still takes typing', async ({ page }) => {
    const units = (await page.getByRole('group', { name: 'Panels' }).boundingBox())!;
    await page.getByRole('button', { name: 'Materials' }).click();
    const dialog = materials(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('table', { name: 'Walls' })).toBeVisible();

    const model = (await page.getByRole('main', { name: 'Model' }).boundingBox())!;
    const box = (await dialog.boundingBox())!;
    const chat = (await page.getByRole('complementary', { name: 'Chat' }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(model.x);
    expect(box.x + box.width).toBeLessThanOrEqual(model.x + model.width + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(chat.x);

    // The header's keys stay above it, so the latched Materials key can close it again.
    expect(box.y).toBeGreaterThan(units.y + units.height);
    const key = page.getByRole('button', { name: 'Materials', exact: true });
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await key.click();
    await expect(dialog).toBeHidden();
    await key.click();
    await expect(dialog).toBeVisible();

    await field(page).click();
    await field(page).fill('Price 2x4s at 50 cents a foot');
    await expect(field(page)).toHaveValue('Price 2x4s at 50 cents a foot');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: 'test-results/screens/materials-desktop.png' });
  });

  test('Cut list, then Export PDF downloads pool-house.pdf: three letter pages', async ({ page }) => {
    await page.getByRole('button', { name: 'Materials' }).click();
    const dialog = materials(page);
    await dialog.getByText('Cut list', { exact: true }).click();
    await expect(dialog.getByText('From 2×4 precut studs, 8′ 8 5/8″')).toBeVisible();
    await page.screenshot({ path: 'test-results/screens/cutlist-desktop.png' });

    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export PDF' }).click()]);
    expect(download.suggestedFilename()).toBe('pool-house.pdf');
    const path = 'test-results/pool-house.pdf';
    await download.saveAs(path);
    const { readFileSync } = await import('node:fs');
    const pdf = await PDFDocument.load(readFileSync(path));
    expect(pdf.getPageCount()).toBe(3);
    for (const p of pdf.getPages()) expect([p.getWidth(), p.getHeight()]).toEqual([612, 792]);
    await expect(dialog.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  });

  test('has no axe violations with the modal open, on either tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Materials' }).click();
    await expect(materials(page)).toBeVisible();
    const check = async () => {
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await check();
    await materials(page).getByText('Cut list', { exact: true }).click();
    await check();
  });
});

test.describe('phone 390 × 844', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone only');

  test('fills nearly the whole screen, the Chat key floats over it, and the chat sheet stacks above', async ({ page }) => {
    await page.getByRole('button', { name: 'Materials' }).click();
    const dialog = materials(page);
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThan(390 - 24);
    expect(box.height).toBeGreaterThan(844 - 24);

    const chatKey = page.getByRole('button', { name: 'Chat' });
    await expect(chatKey).toBeVisible();
    // The key is on top at its centre: a click there reaches it, not the modal.
    const key = (await chatKey.boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), {
      x: key.x + key.width / 2,
      y: key.y + key.height / 2,
    });
    expect(hit).toBe('Chat');
    await page.screenshot({ path: 'test-results/screens/materials-phone.png' });

    await chatKey.click();
    const sheet = page.getByRole('dialog', { name: 'Chat' });
    await expect(sheet).toBeVisible();
    // The chat sheet is on top where it overlaps the modal.
    // Poll: the sheet slides in.
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return el?.closest('[role="dialog"]')?.getAttribute('id') ?? el?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? el?.tagName;
          },
          // Inside the sheet (62% of the height from the bottom) and inside the modal.
          { x: 195, y: 844 * 0.7 },
        ),
      )
      .toBe('phone-chat-sheet');
    await field(page).fill('Hello');
    await expect(field(page)).toHaveValue('Hello');
    await expect(dialog).toBeAttached();
    await page.screenshot({ path: 'test-results/screens/materials-phone-chat.png' });
  });
});
