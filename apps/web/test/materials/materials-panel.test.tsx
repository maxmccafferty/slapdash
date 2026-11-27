import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useShellStore } from '../../src/state/shell-store.ts';
import { setupChat } from '../chat/harness.tsx';
import { setViewportWidth } from '../setup.ts';

const dialog = () => screen.getByRole('dialog', { name: 'Materials' });

async function openMaterials() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Materials' }));
  return user;
}

describe('the Materials modal (desktop)', () => {
  it('opens from the Materials key with the total, three step tables and their column headers', async () => {
    await setupChat({ sample: true });
    await openMaterials();
    const d = dialog();
    expect(d).toHaveAttribute('aria-modal', 'false');
    expect(d.closest('main')).not.toBeNull();
    expect(within(d).getByTestId('materials-range').textContent).toMatch(/^\$[\d,]+–\$[\d,]+/);
    const tables = within(d).getAllByRole('table');
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['Slab', 'Walls', 'Roof']);
    expect(within(d).getByRole('table', { name: 'Walls' })).toBe(tables[1]);
    for (const t of tables) {
      expect(within(t).getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
      expect(within(t).getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument();
    }
  });

  it('gives every row a swatch, shows "no price yet" and ends with the Total row', async () => {
    await setupChat({ sample: true });
    await openMaterials();
    const d = dialog();
    const rows = d.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(within(row as HTMLElement).getByTestId('swatch')).toBeInTheDocument();
    expect(within(d).getByText('no price yet')).toBeInTheDocument();
    expect(within(d).getByTestId('materials-total')).toHaveTextContent(/^Total\$[\d,]+–\$[\d,]+$/);
    expect(within(d).getByText('Prices from 25 Nov 2026. Planning estimates, not quotes.')).toBeInTheDocument();
  });

  it('the Cut list tab groups pieces by stock board', async () => {
    await setupChat({ sample: true });
    const user = await openMaterials();
    await user.click(within(dialog()).getByRole('radio', { name: 'Cut list' }));
    expect(useShellStore.getState().materialsTab).toBe('cutlist');
    const caption = within(dialog()).getByText('From 2×4 precut studs, 8′ 8 5/8″');
    expect(caption.closest('caption')).toHaveTextContent('— 59 boards');
    const table = caption.closest('table')!;
    expect(within(table).getByRole('rowheader', { name: '8′ 7 1/2″' })).toBeInTheDocument();
    expect(within(table).getByText('× 59')).toBeInTheDocument();
  });

  it('the Cut list shows a rafter\'s long point and cut angles', async () => {
    await setupChat({ sample: true });
    const user = await openMaterials();
    await user.click(within(dialog()).getByRole('radio', { name: 'Cut list' }));
    const label = within(dialog()).getAllByText(/long point · plumb 26\.6° both ends · birdsmouth \(seat 3 15\/16″, heel 2″\)/);
    expect(label.length).toBeGreaterThan(0);
  });

  it('Escape closes it, unlatches the key and returns focus to it', async () => {
    await setupChat({ sample: true });
    const user = await openMaterials();
    const key = screen.getByRole('button', { name: 'Materials' });
    expect(key).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Materials' })).not.toBeInTheDocument();
    expect(key).toHaveAttribute('aria-pressed', 'false');
    expect(key).toHaveFocus();
  });

  it('the Close key closes it too', async () => {
    await setupChat({ sample: true });
    const user = await openMaterials();
    await user.click(within(dialog()).getByRole('button', { name: 'Close materials' }));
    expect(useShellStore.getState().panel).toBeNull();
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveFocus();
  });

  it("a price the person gives Claude shows live with an orange dot", async () => {
    const { bus } = await setupChat({ sample: true });
    await openMaterials();
    expect(dialog().querySelector('[data-user-price]')).toBeNull();
    act(() => {
      expect(bus.execute('set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' }).ok).toBe(true);
    });
    const dots = dialog().querySelectorAll('[data-user-price]');
    expect(dots.length).toBeGreaterThan(0);
    expect(dots[0]!.closest('tr')!.textContent).toContain('SPF No.2 lumber');
  });

  it('an empty project says so, and Export is disabled', async () => {
    await setupChat();
    await openMaterials();
    expect(within(dialog()).getByText('Nothing built yet. Ask Claude to build something and the list fills in.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });
});

describe('the Materials modal (phone)', () => {
  it('renders inside the model area, with the Chat key still there and usable', async () => {
    setViewportWidth(390);
    await setupChat({ sample: true });
    const user = await openMaterials();
    const d = dialog();
    expect(d).toHaveAttribute('data-variant', 'phone');
    expect(d.parentElement?.className).toContain('main');
    const chat = screen.getByRole('button', { name: 'Chat' });
    expect(chat).toBeVisible();
    await user.click(chat);
    expect(useShellStore.getState().phone.chatOpen).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Materials' })).toBeInTheDocument();
  });

  it('keeps its tab across the breakpoint', async () => {
    await setupChat({ sample: true });
    const user = await openMaterials();
    await user.click(within(dialog()).getByRole('radio', { name: 'Cut list' }));
    act(() => setViewportWidth(390));
    expect(dialog()).toHaveAttribute('data-variant', 'phone');
    expect(within(dialog()).getByRole('radio', { name: 'Cut list' })).toBeChecked();
  });
});
