import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { modelDescription } from '../../src/shell/ModelArea.tsx';
import { useModelStore } from '../../src/state/model-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { NOTHING_TO_BUILD, STEPS_SHEET_ID } from '../../src/steps/BuildStepsPanel.tsx';
import { stepFacts, STEP_HOW_TO } from '../../src/steps/how-to.ts';
import { clampStep, stepGroups } from '../../src/steps/useBuildSteps.ts';
import { setupChat } from '../chat/harness.tsx';
import { setViewportWidth } from '../setup.ts';

const dialog = () => screen.getByRole('dialog', { name: 'Build steps' });
const step = () => within(dialog()).getByRole('heading', { level: 3 });

describe('Build steps (desktop)', () => {
  it('plays the pool house Slab → Walls → Roof with Back and Next step', async () => {
    await setupChat({ sample: true });
    const user = userEvent.setup();
    const key = screen.getByRole('button', { name: 'Steps' });
    await user.click(key);
    const d = dialog();
    expect(d).toHaveAttribute('aria-modal', 'false');
    expect(d.closest('main')).not.toBeNull();
    expect(d).toHaveFocus();
    expect(within(d).getByText('Step 1 of 3')).toBeInTheDocument();
    expect(step()).toHaveTextContent('Slab');
    expect(within(d).getByText(STEP_HOW_TO.slab)).toBeInTheDocument();
    const back = within(d).getByRole('button', { name: 'Back' });
    const next = within(d).getByRole('button', { name: 'Next step' });
    expect(back).toBeDisabled();

    await user.click(next);
    expect(step()).toHaveTextContent('Walls');
    expect(within(d).getByText(/^4 walls, 2 openings, \d+ parts$/)).toBeInTheDocument();
    await user.click(next);
    expect(step()).toHaveTextContent('Roof');
    expect(within(d).getByText('Step 3 of 3')).toBeInTheDocument();
    expect(next).toBeDisabled();
    await user.click(back);
    expect(step()).toHaveTextContent('Walls');

    // The list marks the current step and jumps on tap.
    const list = within(d).getByRole('list', { name: 'All steps' });
    expect(within(list).getByRole('button', { current: 'step' })).toHaveTextContent('2. Walls');
    await user.click(within(list).getByRole('button', { name: '3. Roof' }));
    expect(step()).toHaveTextContent('Roof');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Build steps' })).not.toBeInTheDocument();
    expect(key).toHaveFocus();
  });

  it('starts again at step 1 each time it opens', async () => {
    await setupChat({ sample: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Steps' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Next step' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Close build steps' }));
    await user.click(screen.getByRole('button', { name: 'Steps' }));
    expect(step()).toHaveTextContent('Slab');
  });

  it('an empty site has nothing to build and the keys are disabled', async () => {
    await setupChat();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Steps' }));
    expect(within(dialog()).getByText(NOTHING_TO_BUILD)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Next step' })).toBeDisabled();
  });

  it('clamps the step when parts are removed under it', async () => {
    const { bus } = await setupChat({ sample: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Steps' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Next step' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Next step' }));
    expect(step()).toHaveTextContent('Roof');
    const roofParts = Object.values(bus.project.parts)
      .filter((p) => bus.project.assemblies[p.assemblyId]?.kind === 'roof')
      .map((p) => p.id);
    act(() => {
      expect(bus.execute('delete_parts', { ids: roofParts }).ok).toBe(true);
    });
    expect(step()).toHaveTextContent('Walls');
    expect(within(dialog()).getByText('Step 2 of 2')).toBeInTheDocument();
  });
});

describe('Build steps (phone)', () => {
  it('opens as a bottom sheet from the Build steps key', async () => {
    setViewportWidth(390);
    await setupChat({ sample: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Build steps' }));
    const sheet = screen.getByRole('dialog', { name: 'Build steps' });
    expect(sheet.id).toBe(STEPS_SHEET_ID);
    expect(sheet.closest('main')).not.toBeNull();
    expect(within(sheet).getByRole('heading', { level: 3 })).toHaveTextContent('Slab');
    await user.click(within(sheet).getByRole('button', { name: 'Next step' }));
    expect(within(sheet).getByRole('heading', { level: 3 })).toHaveTextContent('Walls');
    await user.click(within(sheet).getByRole('button', { name: 'Close build steps' }));
    expect(useShellStore.getState().panel).toBeNull();
  });
});

describe('build step helpers', () => {
  it('modelDescription names the step', () => {
    const project = useModelStore.getState().project;
    expect(modelDescription(project, null, { index: 1, count: 3, title: 'Walls' })).toMatch(/Showing build step 2 of 3: Walls\.$/);
    expect(modelDescription(project, null)).not.toMatch(/build step/);
  });

  it('clampStep keeps the index in range', () => {
    expect(clampStep(5, 3)).toBe(2);
    expect(clampStep(-1, 3)).toBe(0);
    expect(clampStep(2, 0)).toBe(0);
  });

  it('stepFacts counts the step', async () => {
    const { bus } = await setupChat({ sample: true, render: false });
    const groups = stepGroups(bus.project, bus.catalog);
    expect(stepFacts(bus.project, groups[0]!)).toMatch(/^\d+ parts$/);
    expect(stepGroups(bus.project, bus.catalog)).toBe(groups);
  });
});
