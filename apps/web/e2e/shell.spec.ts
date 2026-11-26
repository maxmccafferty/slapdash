import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installFakeVoice } from './fake-voice.ts';

const isDesktop = (name: string) => name === 'desktop';

/** Every interactive control's hit box; radios are measured on their label. */
async function targetSizes(page: Page) {
  return page.evaluate(() => {
    const out: { name: string; width: number; height: number }[] = [];
    const nodes = document.querySelectorAll<HTMLElement>('button, textarea, [role="slider"], input');
    for (const node of nodes) {
      const el = node.matches('input[type="radio"]') ? (node.closest('label') as HTMLElement) : node;
      const style = getComputedStyle(node);
      if (node.matches('button[tabindex="-1"], input[type="file"]') || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      out.push({
        name: node.getAttribute('aria-label') ?? el.textContent ?? node.tagName,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      });
    }
    return out;
  });
}

/** Font sizes of every element that directly holds visible text. */
async function textSizes(page: Page) {
  return page.evaluate(() => {
    const out: { text: string; size: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('.visually-hidden')) continue;
      out.push({ text, size: parseFloat(getComputedStyle(parent).fontSize) });
    }
    return out;
  });
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // Talk only shows where speech recognition works; headless Chromium's doesn't.
  await installFakeVoice(page);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test.describe('desktop 1440 × 900', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('layout matches the handoff', async ({ page }) => {
    const chat = await page.getByRole('complementary', { name: 'Chat' }).boundingBox();
    expect(chat).not.toBeNull();
    expect(chat!.width).toBe(408);
    expect(chat!.x + chat!.width).toBe(1440 - 16);
    expect(chat!.y).toBe(16);
    expect(chat!.y + chat!.height).toBe(900 - 16);

    const model = (await page.getByRole('main', { name: 'Model' }).boundingBox())!;
    const logo = (await page.getByRole('img', { name: 'slapdash' }).boundingBox())!;
    expect(logo.x).toBe(16);
    expect(logo.y).toBeGreaterThanOrEqual(16);
    for (const name of ['File', 'History', 'Panels']) {
      const unit = (await page.getByRole('group', { name }).boundingBox())!;
      expect(unit.y).toBeLessThan(150);
      if (name === 'File') expect(unit.x).toBe(16);
    }

    const floors = (await page.getByRole('slider', { name: 'Floors' }).boundingBox())!;
    expect(floors.x + floors.width).toBeGreaterThan(model.x + model.width - 200);
    expect(floors.y).toBeLessThan(100);

    const view = (await page.getByRole('group', { name: 'View' }).boundingBox())!;
    expect(view.x).toBeLessThan(40);
    expect(view.y + view.height).toBeGreaterThan(900 - 40);

    const zoom = (await page.getByTestId('zoom-readout').boundingBox())!;
    expect(zoom.x + zoom.width).toBeCloseTo(model.x + model.width - 16, 0);
    expect(zoom.y + zoom.height).toBeCloseTo(900 - 16, 0);

    await page.screenshot({ path: 'test-results/screens/desktop.png', fullPage: true });
  });

  test('every control is at least 44 × 44', async ({ page }) => {
    const small = (await targetSizes(page)).filter((t) => t.width < 44 || t.height < 44);
    expect(small).toEqual([]);
  });

  test('no text is smaller than 14px', async ({ page }) => {
    expect((await textSizes(page)).filter((t) => t.size < 14)).toEqual([]);
  });

  test('focus is always visible while tabbing through the shell', async ({ page }) => {
    const seen: string[] = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const target = el.matches('input[type="radio"]') ? (el.closest('label') as HTMLElement) : el;
        const style = getComputedStyle(target);
        return { name: el.getAttribute('aria-label') ?? target.textContent ?? el.tagName, outline: style.outlineStyle, width: style.outlineWidth };
      });
      seen.push(focus.name);
      expect(focus.outline, `focus ring on ${focus.name}`).not.toBe('none');
      expect(focus.width).toBe('2px');
      if (i === 0) await page.screenshot({ path: 'test-results/screens/desktop-focus.png' });
    }
    expect(seen.at(-1)).toBe('Talk');
  });

  test('2D disables Look from and Stress', async ({ page }) => {
    await page.getByText('2D', { exact: true }).click();
    for (const name of ['Look from', 'Stress']) {
      const group = page.getByRole('group', { name });
      for (const radio of await group.getByRole('radio').all()) await expect(radio).toBeDisabled();
      expect(await group.evaluate((el) => getComputedStyle(el.closest('fieldset')!.parentElement!).opacity)).toBe('0.35');
    }
    await page.screenshot({ path: 'test-results/screens/desktop-2d.png' });
  });

  test('Talk reads "Let go" while held', async ({ page }) => {
    const talk = page.getByRole('button', { name: 'Talk' });
    await talk.hover();
    await page.mouse.down();
    await expect(page.getByRole('button', { name: 'Let go' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.up();
    await expect(talk).toHaveAttribute('aria-pressed', 'false');
  });

  test('has no axe violations', async ({ page }) => {
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Materials' }).click();
    await page.getByText('2D', { exact: true }).click();
    await expectNoAxeViolations(page);
  });

  test('reduced motion makes the knob and the piece instant', async ({ page }) => {
    const durations = () =>
      page.evaluate(() =>
        ['[role="slider"] > span', 'fieldset span[aria-hidden="true"]'].map((s) =>
          parseFloat(getComputedStyle(document.querySelector(s)!).transitionDuration),
        ),
      );
    expect((await durations()).every((d) => d >= 0.18)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await durations()).every((d) => d <= 0.00001)).toBe(true);
  });
});

test.describe('phone 390 × 844', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone only');

  test('corner keys sit in the corners, icon-only at 44 × 44', async ({ page }) => {
    await expect(page.getByRole('img', { name: 'slapdash' })).toHaveCount(0);
    const tools = (await page.getByRole('group', { name: 'Tools' }).boundingBox())!;
    expect(tools.x + tools.width).toBe(390 - 16);
    expect(tools.y).toBe(16);
    const views = (await page.getByRole('button', { name: 'Views' }).boundingBox())!;
    expect(views.x).toBeLessThan(30);
    expect(views.y + views.height).toBeGreaterThan(844 - 30);
    const chat = (await page.getByRole('button', { name: 'Chat' }).boundingBox())!;
    expect(chat.x + chat.width).toBe(390 - 16);
    expect(chat.y + chat.height).toBe(844 - 16);
    for (const name of ['Project', 'Materials', 'Build steps', 'Floors', 'Views', 'Chat']) {
      const key = page.getByRole('button', { name, exact: true });
      await expect(key).toHaveText('');
      const box = (await key.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: 'test-results/screens/phone.png' });
  });

  test('every control is at least 44 × 44 and no text is under 14px', async ({ page }) => {
    expect((await targetSizes(page)).filter((t) => t.width < 44 || t.height < 44)).toEqual([]);
    expect((await textSizes(page)).filter((t) => t.size < 14)).toEqual([]);
  });

  test('popovers open beside their keys and pass axe', async ({ page }) => {
    await expectNoAxeViolations(page);

    const projectKey = (await page.getByRole('button', { name: 'Project' }).boundingBox())!;
    await page.getByRole('button', { name: 'Project' }).click();
    const project = (await page.getByRole('dialog', { name: 'Project' }).boundingBox())!;
    expect(project.x + project.width).toBeLessThanOrEqual(projectKey.x);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/screens/phone-project.png' });

    await page.getByRole('button', { name: 'Floors' }).click();
    await expect(page.getByRole('dialog', { name: 'Floors' })).toBeVisible();
    expect((await targetSizes(page)).filter((t) => t.width < 44 || t.height < 44)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/screens/phone-floors.png' });

    await page.getByRole('button', { name: 'Views' }).click();
    const views = (await page.getByRole('dialog', { name: 'Views' }).boundingBox())!;
    expect(views.x).toBeGreaterThanOrEqual(0);
    expect(views.x + views.width).toBeLessThanOrEqual(390);
    expect(views.y).toBeGreaterThanOrEqual(0);
    expect((await textSizes(page)).filter((t) => t.size < 14)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/screens/phone-views.png' });
  });

  test('the chat key opens the sheet and the model slides up', async ({ page }) => {
    await page.getByRole('button', { name: 'Chat' }).click();
    const sheet = page.getByRole('dialog', { name: 'Chat' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    const transform = await page.getByTestId('model-stage').evaluate((el) => getComputedStyle(el).transform);
    expect(transform).not.toBe('none');
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(844, 0);
    expect((await targetSizes(page)).filter((t) => t.width < 44 || t.height < 44)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/screens/phone-chat.png' });
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });
});

test('the shells swap at the 900px breakpoint', async ({ page }, info) => {
  test.skip(!isDesktop(info.project.name), 'resizes a desktop window');
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('[data-shell="desktop"]')).toHaveCount(1);
  await page.setViewportSize({ width: 880, height: 800 });
  await expect(page.locator('[data-shell="phone"]')).toHaveCount(1);
  await expect(page.locator('[data-shell="desktop"]')).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('[data-shell="desktop"]')).toHaveCount(1);
});
