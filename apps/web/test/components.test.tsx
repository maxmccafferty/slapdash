import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FloorSlider } from '../src/components/FloorSlider.tsx';
import { Key } from '../src/components/Key.tsx';
import { Logo } from '../src/components/Logo.tsx';
import { Swatch } from '../src/components/Swatch.tsx';
import { TalkKey } from '../src/components/TalkKey.tsx';
import { PLACEHOLDER_FLOORS } from '../src/placeholder.ts';
import { ViewControls } from '../src/shell/ViewControls.tsx';
import { useShellStore, type FloorId } from '../src/state/shell-store.ts';

describe('Key', () => {
  it('shows its label and is a plain button by default', () => {
    render(<Key label="Save" icon="save" />);
    const key = screen.getByRole('button', { name: 'Save' });
    expect(key).toHaveAttribute('type', 'button');
    expect(key).not.toHaveAttribute('aria-pressed');
  });

  it('latched sets aria-pressed', () => {
    const { rerender } = render(<Key label="Materials" latched={false} />);
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<Key label="Materials" latched />);
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('icon-only keys still have an accessible name', () => {
    render(<Key label="Build steps" icon="steps" iconOnly />);
    const key = screen.getByRole('button', { name: 'Build steps' });
    expect(key).not.toHaveTextContent('Build steps');
    expect(key.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ViewControls', () => {
  it('renders four titled two-option groups', () => {
    render(<ViewControls />);
    for (const title of ['View', 'Look from', 'Dimensions', 'Stress']) {
      const group = screen.getByRole('group', { name: title });
      expect(within(group).getAllByRole('radio')).toHaveLength(2);
    }
    expect(screen.getByRole('radio', { name: '3D' })).toBeChecked();
  });

  it('arrow keys move the selection and update the store', async () => {
    const user = userEvent.setup();
    render(<ViewControls />);
    await user.click(screen.getByRole('radio', { name: 'On', checked: true }));
    await user.keyboard('{ArrowRight}');
    expect(useShellStore.getState().dimensions).toBe(false);
    expect(within(screen.getByRole('group', { name: 'Dimensions' })).getByRole('radio', { name: 'Off' })).toBeChecked();
  });

  it('choosing 2D disables Look from and Stress', async () => {
    const user = userEvent.setup();
    render(<ViewControls />);
    await user.click(screen.getByRole('radio', { name: '2D' }));
    expect(useShellStore.getState().view).toBe('2d');
    for (const title of ['Look from', 'Stress']) {
      const group = screen.getByRole('group', { name: title });
      expect(group).toBeDisabled();
      for (const radio of within(group).getAllByRole('radio')) expect(radio).toBeDisabled();
    }
    expect(within(screen.getByRole('group', { name: 'Dimensions' })).getAllByRole('radio')[0]).toBeEnabled();
  });
});

describe('FloorSlider', () => {
  function Harness() {
    const floor = useShellStore((s) => s.floor);
    const setFloor = useShellStore((s) => s.setFloor);
    return <FloorSlider floors={PLACEHOLDER_FLOORS} value={floor} onChange={(f: FloorId) => setFloor(f)} />;
  }

  it('is a vertical slider labelled Floors', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Floors' });
    expect(slider).toHaveAttribute('aria-orientation', 'vertical');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '2');
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    expect(slider).toHaveAttribute('aria-valuetext', 'Roof, 12′ 0″');
  });

  it('moves with ArrowDown, ArrowUp, Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Floors' });
    slider.focus();
    await user.keyboard('{ArrowDown}');
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    expect(slider).toHaveAttribute('aria-valuetext', 'Floor 1, 9′ 0″');
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(useShellStore.getState().floor).toBe('foundation');
    await user.keyboard('{ArrowDown}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(slider).toHaveAttribute('aria-valuenow', '2');
  });

  it('clicking a stop selects it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Foundation/ }));
    expect(useShellStore.getState().floor).toBe('foundation');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Foundation, 0′ 8″');
  });
});

describe('TalkKey', () => {
  it('reads "Let go" while held with the pointer', () => {
    render(<TalkKey />);
    const key = screen.getByRole('button', { name: 'Talk' });
    expect(key).toHaveAttribute('aria-pressed', 'false');
    fireEvent.pointerDown(key, { pointerId: 1 });
    expect(key).toHaveTextContent('Let go');
    expect(key).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerUp(key, { pointerId: 1 });
    expect(key).toHaveTextContent('Talk');
    expect(key).toHaveAttribute('aria-pressed', 'false');
  });

  it('holds while Space is down and lets go on keyup', async () => {
    const user = userEvent.setup();
    let started = 0;
    let ended = 0;
    render(<TalkKey onHoldStart={() => started++} onHoldEnd={() => ended++} />);
    const key = screen.getByRole('button', { name: 'Talk' });
    key.focus();
    await user.keyboard('[Space>]');
    expect(key).toHaveTextContent('Let go');
    await user.keyboard('[/Space]');
    expect(key).toHaveTextContent('Talk');
    expect([started, ended]).toEqual([1, 1]);
  });

  it('icon-only takes its name from the state', () => {
    render(<TalkKey iconOnly />);
    const key = screen.getByRole('button', { name: 'Talk' });
    act(() => {
      fireEvent.keyDown(key, { key: 'Enter' });
    });
    expect(key).toHaveAccessibleName('Let go');
  });
});

describe('Swatch', () => {
  it('renders the catalog colour', () => {
    render(<Swatch swatch={{ color: '#c8a46e' }} />);
    expect(screen.getByTestId('swatch')).toHaveStyle({ backgroundColor: '#c8a46e' });
  });
});

describe('Logo', () => {
  it('is named slapdash with a decorative mark', () => {
    render(<Logo />);
    const logo = screen.getByRole('img', { name: 'slapdash' });
    expect(logo.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(logo.querySelector('metadata')).toBeNull();
  });
});
