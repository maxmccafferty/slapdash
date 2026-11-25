/**
 * Acceptance (LOC-113), in the app with a scripted Claude: an undersized sliding-door
 * header shows over its limit; turning Stress on runs one automatic turn in which Claude
 * checks the structure and offers the fix first; choosing it runs resize_header, and the
 * stress view re-analyses with the header back under its limit.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { call, say } from '@slapdash/agent/testing';
import { CATALOG } from '@slapdash/catalog';
import { formatErrors, indexCatalog, type CommandBus } from '@slapdash/core';
import { analyze } from '@slapdash/solver';
import { afterEach, describe, expect, it } from 'vitest';
import { watchStressExplain } from '../../src/analysis/stress-explain.ts';
import { useStressStore } from '../../src/analysis/stress-store.ts';
import { useChatStore } from '../../src/state/chat-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { useSiteStore } from '../../src/state/site-store.ts';
import { setupChat } from './harness.tsx';

const index = indexCatalog(CATALOG);
const FIX = 'Upsize the sliding door header to 2-2x12';

const headers = (bus: CommandBus) => Object.values(bus.project.parts).filter((p) => p.role === 'header' && p.tags.includes('opening:O1'));

function exec(bus: CommandBus, name: string, input: unknown) {
  const res = bus.execute(name, input);
  if (!res.ok) throw new Error(formatErrors(res.errors));
}

const textOf = (messages: unknown) => JSON.stringify(messages);

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
});

describe('stress view: the header fix', () => {
  it('explains once when Stress goes on, offers the fix first, and the fix clears the header', async () => {
    const seen: string[] = [];
    const { bus, controller } = await setupChat({
      sample: true,
      analysis: async (p) => analyze(p, index, { siteDefaults: useSiteStore.getState().siteDefaults }),
      steps: [
        // The automatic turn.
        (messages) => {
          seen.push(textOf(messages));
          return call(['check_structure', { assembly: 'W3', limit: 5 }]);
        },
        (messages) => {
          seen.push(textOf(messages));
          return call(['offer_options', { options: [FIX, 'Leave it'] }]);
        },
        say('The sliding door header is over its limit under snow. Planning estimate, not an engineering check.'),
        // The person taps the fix.
        call(['resize_header', { opening: 'O1' }]),
        call(['check_structure', { assembly: 'W3', limit: 5 }]),
        say('Done: the header is a 2-2x12 now and well under its limit.'),
      ],
    });
    off = watchStressExplain(controller);
    exec(bus, 'set_design_load', { key: 'groundSnow', value: '50 psf', source: 'county' });
    for (const h of headers(bus)) exec(bus, 'update_part', { id: h.id, sectionId: '2x4' });

    act(() => useShellStore.getState().setStress(true));
    await waitFor(() => expect(useStressStore.getState().status).toBe('ready'), { timeout: 5000 });
    const weak = useStressStore.getState().result!;
    expect(Math.max(...headers(bus).map((h) => weak.parts[h.id]!.utilization))).toBeGreaterThan(1);

    // One automatic turn: the trigger chip, check_structure, then the fix first.
    await waitFor(() => expect(screen.getByTestId('stress-trigger')).toHaveTextContent('Stress view on'), { timeout: 5000 });
    await waitFor(() => expect(useChatStore.getState().running).toBeNull(), { timeout: 5000 });
    expect(seen[0]).toContain('<stress_view>The person just turned on the stress view.');
    expect(seen[1]).toMatch(/Planning estimate, not an engineering check/);
    expect(seen[1]).toMatch(/W3-H0\d Header, South wall · 1\d\d% · (shear|bending) under D\+S/);
    const group = screen.getByRole('group', { name: 'Options' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([FIX, 'Leave it']);

    // Re-analysing (e.g. the same result again) doesn't explain twice.
    act(() => useStressStore.setState({ status: 'ready' }));
    expect(screen.getAllByTestId('stress-trigger')).toHaveLength(1);

    // The fix.
    await userEvent.setup().click(within(group).getByRole('button', { name: FIX }));
    await waitFor(() => expect(useChatStore.getState().running).toBeNull(), { timeout: 5000 });
    expect(headers(bus).every((h) => h.sectionId === '2x12')).toBe(true);
    await waitFor(
      () => {
        const s = useStressStore.getState();
        expect(s.forProject).toBe(bus.project);
        expect(s.status).toBe('ready');
      },
      { timeout: 5000 },
    );
    const fixed = useStressStore.getState().result!;
    for (const h of headers(bus)) expect(fixed.parts[h.id]!.utilization, h.id).toBeLessThan(1);
    const last = (useChatStore.getState().items.at(-1) as { text?: string }).text;
    expect(last).toContain('2-2x12');
    expect(screen.getAllByTestId('stress-trigger')).toHaveLength(1);
  }, 20_000);

  it('no automatic turn without a confirmed keyhole (a static preview)', async () => {
    const { bus, controller, sent } = await setupChat({ sample: true, status: null, steps: [] });
    off = watchStressExplain(controller);
    exec(bus, 'set_design_load', { key: 'groundSnow', value: '50 psf', source: 'county' });
    act(() => useShellStore.getState().setStress(true));
    await waitFor(() => expect(useStressStore.getState().status).toBe('ready'), { timeout: 5000 });
    expect(sent).toHaveLength(0);
    expect(screen.queryByTestId('stress-trigger')).toBeNull();
  });

  it('below 80% there is only the callout: no automatic turn', async () => {
    const { bus, controller, sent } = await setupChat({ sample: false, steps: [] });
    off = watchStressExplain(controller);
    exec(bus, 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '8ft', z: '8ft' } });
    act(() => useShellStore.getState().setStress(true));
    await waitFor(() => expect(useStressStore.getState().status).toBe('ready'), { timeout: 5000 });
    expect(useStressStore.getState().explainedFor).toBe(useStressStore.getState().switchOn);
    expect(sent).toHaveLength(0);
    expect(screen.queryByTestId('stress-trigger')).toBeNull();
    expect(screen.getByTestId('stress-legend')).toBeInTheDocument();
  });
});

