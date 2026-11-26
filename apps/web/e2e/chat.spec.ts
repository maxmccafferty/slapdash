import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { formatSseEvent, type BudgetStatus, type KeyholeStatus } from '@slapdash/agent';
import { BUDGET, call, replyEvents, say, type ScriptedReply } from '@slapdash/agent/testing';

/**
 * The chat states from the handoff's Chat states artboard, in a real browser, with the keyhole
 * mocked: GET /api/claude answers a status, and each POST streams the next scripted reply.
 */

interface Mock {
  status?: { configured?: boolean; budget?: Partial<BudgetStatus> };
  replies?: ScriptedReply[];
  /** Answer every POST with this JSON error and status instead. */
  refuse?: { status: number; body: unknown };
}

async function mockKeyhole(page: Page, mock: Mock = {}) {
  const queue = [...(mock.replies ?? [])];
  const status: KeyholeStatus = {
    configured: mock.status?.configured ?? true,
    model: 'claude-test',
    budget: { ...BUDGET, ...mock.status?.budget },
  };
  await page.route('**/api/claude', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: status });
    if (mock.refuse) return route.fulfill({ status: mock.refuse.status, json: mock.refuse.body });
    const reply = queue.shift() ?? say('(no more scripted replies)');
    const body = replyEvents(reply)
      .map((e) => formatSseEvent(e.event, e.data))
      .join('');
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
  });
}

async function open(page: Page, isMobile: boolean, search = '?e2e') {
  await page.goto(`/${search}`);
  await page.evaluate(() => document.fonts.ready);
  if (isMobile) await page.getByRole('button', { name: 'Chat' }).click();
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message Claude' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function smallTargets(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, textarea')]
      .filter((n) => !n.matches('button[tabindex="-1"]'))
      .map((n) => ({ name: n.getAttribute('aria-label') ?? n.textContent, box: n.getBoundingClientRect() }))
      .filter((t) => t.box.width < 44 || t.box.height < 44)
      .map((t) => t.name),
  );
}

async function smallText(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('.visually-hidden')) continue;
      if (parseFloat(getComputedStyle(parent).fontSize) < 14) out.push(node.textContent.trim());
    }
    return out;
  });
}

const shot = (page: Page, name: string, isMobile: boolean) =>
  page.screenshot({ path: `test-results/screens/chat-${name}-${isMobile ? 'phone' : 'desktop'}.png` });

test('talking: the reply streams in, with Undo for a change', async ({ page, isMobile }) => {
  await mockKeyhole(page, {
    replies: [
      call(['add_assembly', { name: 'Bench', kind: 'misc' }]),
      say('Added a bench assembly. Nothing is in it yet.'),
    ],
  });
  await open(page, isMobile);
  await expect(page.getByText('What are we building?')).toBeVisible();
  await send(page, 'Start a bench');
  await expect(page.getByText('Added a bench assembly. Nothing is in it yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo this change' })).toBeEnabled();
  await expectNoAxeViolations(page);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page)).toEqual([]);
  await shot(page, 'talking', isMobile);
});

test('pointing at a part: the chip rides along with the message', async ({ page, isMobile }) => {
  await mockKeyhole(page, { replies: [say('Raised the header 6 inches.')] });
  await open(page, isMobile, '?sample=pool-house&e2e');
  await page.waitForFunction(() => typeof (window as unknown as { __slapdash?: { select?: unknown } }).__slapdash?.select === 'function');
  await page.evaluate(() => (window as unknown as { __slapdash: { select: (id: string) => void } }).__slapdash.select('W3-H01'));
  await expect(page.getByTestId('part-chip')).toHaveText('Header, South wall');
  await expectNoAxeViolations(page);
  await shot(page, 'pointing', isMobile);
  await send(page, 'make this taller');
  await expect(page.getByTestId('part-chip')).toHaveCount(1);
  await expect(page.getByText('Raised the header 6 inches.', { exact: true })).toBeVisible();
});

test('plan: the card shows with the dashed outline; Build it answers it', async ({ page, isMobile }) => {
  const plan = "I'll build a 16×20 pool house on a slab with 9ft walls.";
  await mockKeyhole(page, {
    replies: [call(['propose_plan', { plan, footprint: { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }, height: '9ft' }]), say(plan), say('Building it.')],
  });
  await open(page, isMobile);
  await send(page, 'Build me a pool house');
  const card = page.getByRole('group', { name: 'Plan' });
  await expect(card.getByText(plan)).toBeVisible();
  const proposal = await page.evaluate(() => (window as unknown as { __slapdash: { chat: { proposal: () => unknown } } }).__slapdash.chat.proposal());
  expect(proposal).toMatchObject({ footprint: { from: { x: 0, z: 0 } } });
  await expectNoAxeViolations(page);
  await shot(page, 'plan', isMobile);
  await card.getByRole('button', { name: 'Build it' }).click();
  await expect(page.getByText('Building it.', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Build it' })).toBeDisabled();
});

test("can't do it: two options and nothing changed", async ({ page, isMobile }) => {
  const options = ['Use a beam with a post in the middle', 'Make the opening 12ft'];
  await mockKeyhole(page, {
    replies: [call(['offer_options', { options }]), say('A 24ft opening needs an engineered beam. Nothing has changed yet.')],
  });
  await open(page, isMobile);
  await send(page, 'A 24ft opening with no posts');
  const group = page.getByRole('group', { name: 'Options' });
  await expect(group.getByRole('button')).toHaveText(options);
  await expect(page.getByText('Nothing has changed yet.', { exact: true })).toHaveCount(1);
  await expectNoAxeViolations(page);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page)).toEqual([]);
  await shot(page, 'cant-do', isMobile);
});

test('photo request: Take photo and Choose photo', async ({ page, isMobile }) => {
  await mockKeyhole(page, { replies: [call(['request_photo', { what: 'the wall where the deck attaches' }]), say('Can you send a photo of that wall?')] });
  await open(page, isMobile);
  await send(page, 'Attach a deck to my house');
  await expect(page.getByText('Photo of the wall where the deck attaches')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose photo' })).toBeEnabled();
  await expect(page.getByTestId('take-photo-input')).toHaveAttribute('capture', 'environment');
  await expectNoAxeViolations(page);
  expect(await smallTargets(page)).toEqual([]);
  await shot(page, 'photo', isMobile);
});

test('monthly limit: the 80% note, then capped', async ({ page, isMobile }) => {
  await mockKeyhole(page, { status: { budget: { state: 'warning', spentUsd: 8, fraction: 0.8 } } });
  await open(page, isMobile);
  await expect(page.getByText("80% of this month's Claude budget is used: $8.00 of $10.00.")).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'warning', isMobile);
});

test('capped: the field and Talk are off; the rest of the app works', async ({ page, isMobile }) => {
  await mockKeyhole(page, { status: { budget: { state: 'capped', spentUsd: 10, fraction: 1 } } });
  await open(page, isMobile);
  await expect(page.getByTestId('capped-note')).toContainText('Claude is back on December 1');
  await expect(page.getByRole('textbox', { name: 'Message Claude' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Talk' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Materials' })).toBeEnabled();
  await expectNoAxeViolations(page);
  expect(await smallText(page)).toEqual([]);
  await shot(page, 'capped', isMobile);
});

test('no key: explains and offers the sample', async ({ page, isMobile }) => {
  await mockKeyhole(page, { status: { configured: false } });
  await open(page, isMobile);
  await expect(page.getByTestId('no-key-note')).toContainText("Claude isn't connected");
  await expect(page.getByRole('textbox', { name: 'Message Claude' })).toBeDisabled();
  await expectNoAxeViolations(page);
  expect(await smallText(page)).toEqual([]);
  await shot(page, 'no-key', isMobile);
  await page.getByRole('button', { name: 'Open the sample pool house' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __slapdash: { chat: { partCount: () => number } } }).__slapdash.chat.partCount()))
    .toBeGreaterThan(50);
});
