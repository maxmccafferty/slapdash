/**
 * The stress view in a real browser (LOC-113): Stress on shows the legend with the
 * disclaimer and a callout; 2D disables Stress and drops the overlay; an undersized
 * sliding-door header reads over its limit with the warning mark, and resize_header brings
 * it back under. Drives the bus through `window.__slapdash.stress` (present with `?e2e`).
 */
import { expect, test, type Page } from '@playwright/test';

interface StressDebug {
  stress: {
    state(): { status: string; result: { parts: Record<string, { utilization: number }> } | null; forProject: unknown };
    execute(name: string, input: unknown): { ok: boolean };
  };
  frameStats(): { frames: number };
}
const debug = (page: Page) => page.evaluate.bind(page);

async function open(page: Page) {
  await page.goto('/?sample=pool-house&e2e');
  await page.waitForFunction(() => ((window as unknown as { __slapdash?: StressDebug }).__slapdash?.frameStats?.().frames ?? 0) > 0, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(900);
}

async function setStress(page: Page, on: boolean) {
  await page.getByRole('group', { name: 'Stress' }).getByText(on ? 'On' : 'Off', { exact: true }).click();
}

/** The sliding door's header plies' worst utilisation in the latest stress result for the current project. */
async function headerUtilization(page: Page): Promise<number | null> {
  return debug(page)(() => {
    const w = window as unknown as { __slapdash: StressDebug };
    const s = w.__slapdash.stress.state();
    if (s.status !== 'ready' || !s.result) return null;
    const ids = Object.keys(s.result.parts).filter((id) => id.startsWith('W3-H'));
    return Math.max(...ids.map((id) => s.result!.parts[id]!.utilization));
  });
}

test.skip(({ isMobile }) => isMobile, 'The view controls sit in a popover on the phone; desktop covers the flow.');

test('stress on: legend, disclaimer and callout; 2D drops the overlay', async ({ page }) => {
  await open(page);
  await setStress(page, true);
  const legend = page.getByTestId('stress-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('Planning estimate, not an engineering check.');
  await expect(legend).toContainText('Design loads');
  await expect(page.getByTestId('stress-callout')).toBeVisible({ timeout: 30_000 });

  await page.getByText('2D', { exact: true }).click();
  await expect(page.getByRole('group', { name: 'Stress' })).toHaveAttribute('disabled', '');
  await expect(page.getByTestId('stress-legend')).toHaveCount(0);
  await expect(page.getByTestId('stress-callout')).toHaveCount(0);
});

test('an undersized header reads over its limit; resize_header clears it', async ({ page }) => {
  await open(page);
  await debug(page)(() => {
    const s = (window as unknown as { __slapdash: StressDebug }).__slapdash.stress;
    s.execute('set_design_load', { key: 'groundSnow', value: '50 psf', source: 'e2e' });
    for (const id of ['W3-H01', 'W3-H02']) s.execute('update_part', { id, sectionId: '2x4' });
  });
  await setStress(page, true);
  await expect.poll(() => headerUtilization(page), { timeout: 30_000 }).toBeGreaterThan(1);
  await expect(page.getByTestId('stress-callout')).toHaveAttribute('data-over', 'true');
  await expect(page.getByTestId('stress-callout')).toContainText('over its limit');
  await expect(page.getByTestId('stress-warning')).toBeVisible();
  await expect(page.getByTestId('stress-load-groundSnow')).toContainText('Yours · e2e');

  const fixed = await debug(page)(() => (window as unknown as { __slapdash: StressDebug }).__slapdash.stress.execute('resize_header', { opening: 'O1' }).ok);
  expect(fixed).toBe(true);
  await expect.poll(() => headerUtilization(page), { timeout: 30_000 }).toBeLessThan(1);
});
