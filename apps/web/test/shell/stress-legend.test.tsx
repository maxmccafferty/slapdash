import { act, render, screen, within } from '@testing-library/react';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, formatErrors, indexCatalog } from '@slapdash/core';
import { analyze } from '@slapdash/solver';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStressStore } from '../../src/analysis/stress-store.ts';
import { LEGEND_DISCLAIMER, StressLegend } from '../../src/shell/StressLegend.tsx';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { useSiteStore } from '../../src/state/site-store.ts';

const index = indexCatalog(TIER1_CATALOG);

function bus() {
  const b = new CommandBus({ project: createProject({ name: 'Shed' }), catalog: TIER1_CATALOG, siteDefaults: () => useSiteStore.getState().siteDefaults });
  useModelStore.getState().attachBus(b);
  return b;
}

function exec(b: CommandBus, name: string, input: unknown) {
  const res = b.execute(name, input);
  if (!res.ok) throw new Error(formatErrors(res.errors));
}

function ready(b: CommandBus) {
  const result = analyze(b.project, index, { siteDefaults: useSiteStore.getState().siteDefaults });
  act(() => useStressStore.setState({ status: 'ready', result, forProject: b.project }));
}

beforeEach(() => {
  resetModelStore();
  useShellStore.setState({ stress: true, view: '3d' });
});

describe('stress legend', () => {
  it('shows the ramp, the disclaimer and the loads with their sources', () => {
    const b = bus();
    exec(b, 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '8ft', z: '8ft' } });
    render(<StressLegend />);
    expect(screen.getByTestId('stress-status')).toHaveTextContent('Checking…');
    ready(b);
    const legend = screen.getByRole('region', { name: 'Stress' });
    for (const label of ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%', 'Over limit', 'Not checked']) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
    expect(within(legend).getByText(LEGEND_DISCLAIMER)).toBeInTheDocument();
    expect(screen.queryByTestId('stress-status')).toBeNull();
    expect(screen.getByTestId('stress-location')).toHaveTextContent('No location set');
    expect(screen.getByTestId('stress-load-groundSnow')).toHaveTextContent('Snow 30 psf');
    expect(screen.getByTestId('stress-load-groundSnow')).toHaveTextContent('default 30 psf ground snow (no location set)');
    expect(screen.getByTestId('stress-load-windSpeed')).toHaveTextContent('Wind 115 mph');
    expect(screen.getByTestId('stress-load-frostDepth')).toHaveTextContent('Frost not set');
  });

  it("a person's override gets the orange dot and Yours", () => {
    const b = bus();
    exec(b, 'set_design_load', { key: 'groundSnow', value: '50 psf', source: 'county' });
    ready(b);
    render(<StressLegend />);
    const snow = screen.getByTestId('stress-load-groundSnow');
    expect(snow).toHaveTextContent('Snow 50 psf');
    expect(snow).toHaveTextContent('Yours · county');
    expect(snow.querySelector('[data-user-load]')).not.toBeNull();
    expect(screen.getByTestId('stress-load-windSpeed').querySelector('[data-user-load]')).toBeNull();
  });

  it('a default location in the table, and one that is not', () => {
    const b = bus();
    act(() => useSiteStore.getState().setDefaultLocation('Denver, CO'));
    ready(b);
    const { unmount } = render(<StressLegend />);
    expect(screen.getByTestId('stress-location')).toHaveTextContent('Denver, CO · default');
    expect(screen.getByTestId('stress-load-groundSnow')).toHaveTextContent('Snow 43 psf');
    expect(screen.getByTestId('stress-load-groundSnow')).toHaveTextContent('2025 Denver Residential Code, Table R301.2');
    expect(screen.getByTestId('stress-load-frostDepth')).toHaveTextContent(`Frost 3' 0"`);
    unmount();

    act(() => useSiteStore.getState().setDefaultLocation('Nowhere, ZZ'));
    ready(b);
    render(<StressLegend />);
    expect(screen.getByTestId('stress-location')).toHaveTextContent('Nowhere, ZZ · not in the loads table');
    expect(screen.getByTestId('stress-load-groundSnow')).toHaveTextContent('Nowhere, ZZ is not in the loads table');
  });

  it('is hidden in 2D and when Stress is off', () => {
    bus();
    act(() => useShellStore.setState({ view: '2d' }));
    const { rerender } = render(<StressLegend />);
    expect(screen.queryByTestId('stress-legend')).toBeNull();
    act(() => useShellStore.setState({ view: '3d', stress: false }));
    rerender(<StressLegend />);
    expect(screen.queryByTestId('stress-legend')).toBeNull();
  });

  it('compact layout folds the loads under a disclosure and keeps the disclaimer', () => {
    const b = bus();
    ready(b);
    render(<StressLegend layout="compact" />);
    expect(screen.getByText('Loads').tagName).toBe('SUMMARY');
    expect(screen.getByText(LEGEND_DISCLAIMER)).toBeVisible();
  });
});
