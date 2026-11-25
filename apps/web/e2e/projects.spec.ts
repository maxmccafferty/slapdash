/**
 * Projects, first run and Build steps (ADR-0003 §E, §I) in a real browser. Each test starts
 * with a fresh browser context, so IndexedDB is empty: a first run.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { BUDGET } from '@slapdash/agent/testing';
import type { KeyholeStatus } from '@slapdash/agent';
import { installFakeVoice } from './fake-voice.ts';

const SAMPLE_PATH = fileURLToPath(new URL('../src/samples/pool-house.slapdash', import.meta.url));
const STARTERS = ['A 10′ × 12′ garden shed', 'A 16′ × 20′ pool house with a sliding door', 'A 6′ fence along the back of the yard'];

async function mockKeyhole(page: Page) {
  const status: KeyholeStatus = { configured: true, model: 'claude-test', budget: { ...BUDGET } };
  await page.route('**/api/claude', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: status }) : route.abort()));
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Interactive controls under 44 px, and visible text under 14 px. */
async function sizeProblems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const n of document.querySelectorAll<HTMLElement>('button, textarea')) {
      if (n.matches('button[tabindex="-1"]')) continue;
      const box = n.getBoundingClientRect();
      if (box.width > 0 && (box.width < 44 || box.height < 44)) out.push(`target: ${n.getAttribute('aria-label') ?? n.textContent}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('.visually-hidden')) continue;
      if (parseFloat(getComputedStyle(parent).fontSize) < 14) out.push(`text: ${node.textContent.trim()}`);
    }
    return out;
  });
}

const shot = (page: Page, name: string, isMobile: boolean) =>
  page.screenshot({ path: `test-results/screens/${name}-${isMobile ? 'phone' : 'desktop'}.png` });

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

async function openChat(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Chat' }).click();
}

async function closeChat(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Close chat' }).click();
}

async function openSteps(page: Page, isMobile: boolean) {
  await page.getByRole('button', { name: isMobile ? 'Build steps' : 'Steps' }).click();
  return page.getByRole('dialog', { name: 'Build steps' });
}

async function openProjects(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  return page.getByRole('dialog', { name: 'Projects' });
}

test.beforeEach(async ({ page }) => {
  mkdirSync('test-results/screens', { recursive: true });
  await mockKeyhole(page);
  await installFakeVoice(page);
});

test('first run → the sample → build steps Slab, Walls, Roof', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(heading(page)).toHaveText('New project');

  await openChat(page, isMobile);
  await expect(page.getByText('What are we building?')).toBeVisible();
  const starters = page.getByRole('group', { name: 'Start with' });
  await expect(starters.getByRole('button')).toHaveText(STARTERS);
  await expect(page.getByRole('button', { name: 'Open the sample pool house' })).toBeVisible();
  await expectNoAxeViolations(page);
  expect(await sizeProblems(page)).toEqual([]);
  await shot(page, 'first-run', isMobile);

  await page.getByRole('button', { name: 'Open the sample pool house' }).click();
  await expect(heading(page)).toHaveText('Pool house');
  await expect(page.getByTestId('starters')).toHaveCount(0);
  await closeChat(page, isMobile);

  const steps = await openSteps(page, isMobile);
  const scene = page.getByTestId('scene');
  await expect(steps.getByRole('heading', { level: 3 })).toHaveText('Slab');
  await expect(scene).toHaveAttribute('aria-label', /build step 1 of 3: Slab\.$/);
  await steps.getByRole('button', { name: 'Next step' }).click();
  await expect(scene).toHaveAttribute('aria-label', /build step 2 of 3: Walls\.$/);
  await expectNoAxeViolations(page);
  expect(await sizeProblems(page)).toEqual([]);
  await shot(page, 'build-steps', isMobile);
  await steps.getByRole('button', { name: 'Next step' }).click();
  await expect(scene).toHaveAttribute('aria-label', /build step 3 of 3: Roof\.$/);
  await expect(steps.getByRole('button', { name: 'Next step' })).toBeDisabled();
  await steps.getByRole('button', { name: 'Back' }).click();
  await expect(scene).toHaveAttribute('aria-label', /build step 2 of 3: Walls\.$/);
  await steps.getByRole('button', { name: 'Close build steps' }).click();
  await expect(scene).toHaveAttribute('aria-label', /Tap a part to point at it\.$/);
});

test('projects are kept: reload reopens, Load lists them, New project and back, Import', async ({ page, isMobile }) => {
  await page.goto('/');
  await openChat(page, isMobile);
  await page.getByRole('button', { name: 'Open the sample pool house' }).click();
  await expect(heading(page)).toHaveText('Pool house');

  await page.reload();
  await expect(heading(page)).toHaveText('Pool house');
  await expect(page.getByTestId('scene')).toHaveAttribute('aria-label', /^3D model: Pool house, foundation, 4 walls, 2 openings, roof\./);

  let projects = await openProjects(page, isMobile);
  const card = projects.getByRole('button', { name: /^Pool house\s*, open now\s*, Edited / });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveCount(1, { timeout: 15_000 });
  await expectNoAxeViolations(page);
  expect(await sizeProblems(page)).toEqual([]);
  await shot(page, 'projects', isMobile);

  await projects.getByRole('button', { name: /^New project/ }).click();
  await expect(heading(page)).toHaveText('New project');
  await expect(projects).toHaveCount(0);

  projects = await openProjects(page, isMobile);
  await projects.getByRole('button', { name: /^Open Pool house\s*, Edited / }).click();
  await expect(heading(page)).toHaveText('Pool house');

  projects = await openProjects(page, isMobile);
  await page.getByTestId('import-input').setInputFiles(SAMPLE_PATH);
  // The copy opens and the modal closes.
  await expect(projects).toHaveCount(0);
  await expect(heading(page)).toHaveText('Pool house');
  projects = await openProjects(page, isMobile);
  await expect(projects.getByRole('button', { name: /Pool house/ })).toHaveCount(2);
});
