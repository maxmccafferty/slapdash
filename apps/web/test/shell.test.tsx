import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { useShellStore } from '../src/state/shell-store.ts';
import { setViewportWidth } from './setup.ts';

describe('desktop shell (1440)', () => {
  it('has the header, model and chat landmarks', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'slapdash' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pool house' })).toBeInTheDocument();
  });

  it('has three header units with labelled keys', () => {
    render(<App />);
    const banner = screen.getByRole('banner');
    const units = ['File', 'History', 'Panels'].map((name) => within(banner).getByRole('group', { name }));
    expect(units).toHaveLength(3);
    expect(within(units[0]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save', 'Load']);
    expect(within(units[1]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Undo', 'Redo']);
    expect(within(units[2]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Materials', 'Steps']);
  });

  it('shows the four view controls, the floors slider, the specs and the zoom readout', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(main.querySelectorAll('fieldset')).toHaveLength(4);
    for (const title of ['View', 'Look from', 'Dimensions', 'Stress']) {
      expect(within(main).getByRole('group', { name: title })).toBeInTheDocument();
    }
    expect(within(main).getByRole('slider', { name: 'Floors' })).toBeInTheDocument();
    expect(screen.getByTestId('zoom-readout')).toHaveTextContent('scroll to zoom100%');
    for (const label of ['Footprint', 'Walls', 'Roof', 'Parts']) {
      expect(within(screen.getByRole('banner')).getByText(label)).toBeInTheDocument();
    }
  });

  it('Materials and Steps latch and are mutually exclusive', async () => {
    const user = userEvent.setup();
    render(<App />);
    const materials = screen.getByRole('button', { name: 'Materials' });
    const steps = screen.getByRole('button', { name: 'Steps' });
    await user.click(materials);
    expect(materials).toHaveAttribute('aria-pressed', 'true');
    expect(steps).toHaveAttribute('aria-pressed', 'false');
    await user.click(steps);
    expect(materials).toHaveAttribute('aria-pressed', 'false');
    expect(steps).toHaveAttribute('aria-pressed', 'true');
    await user.click(steps);
    expect(steps).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls the action callbacks', async () => {
    const user = userEvent.setup();
    const actions = { onSave: vi.fn(), onLoad: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() };
    render(<App actions={actions} />);
    for (const name of ['Save', 'Load', 'Undo', 'Redo'] as const) {
      await user.click(screen.getByRole('button', { name }));
      expect(actions[`on${name}`]).toHaveBeenCalledOnce();
    }
  });

  it('chat has a labelled field, Send and Talk', () => {
    render(<App />);
    const chat = screen.getByRole('complementary', { name: 'Chat' });
    expect(within(chat).getByRole('textbox', { name: 'Message Claude' })).toBeInTheDocument();
    expect(within(chat).getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(within(chat).getByRole('button', { name: 'Talk' })).toBeInTheDocument();
    expect(within(chat).getByText('What are we building?')).toBeInTheDocument();
  });

  it('tab order runs header, floors, view controls, chat', async () => {
    const user = userEvent.setup();
    render(<App />);
    const order: string[] = [];
    for (let i = 0; i < 14; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      const name =
        el.getAttribute('aria-label') ??
        el.closest('label')?.textContent ??
        (el.getAttribute('role') === 'slider' ? 'slider' : null) ??
        el.textContent ??
        '';
      order.push(name || el.tagName.toLowerCase());
    }
    expect(order).toEqual([
      'Save',
      'Load',
      'Undo',
      'Redo',
      'Materials',
      'Steps',
      'slider',
      '3D',
      'Outside',
      'On',
      'Off',
      'textarea',
      'Send',
      'Talk',
    ]);
  });
});

describe('2D', () => {
  it('shows the drawing sheet in place of the model, even without WebGL, and 3D hides it', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('img', { name: /2D drawing/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '2D' }));
    const sheet = screen.getByRole('img', { name: /2D drawing/ });
    expect(sheet.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('img', { name: /3D isn't available/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('zoom-readout')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '3D' }));
    expect(screen.queryByRole('img', { name: /2D drawing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /3D isn't available/ })).toBeInTheDocument();
  });
});

describe('phone shell (390)', () => {
  it('shows icon-only keys, no logo and no chat aside', () => {
    setViewportWidth(390);
    render(<App />);
    expect(screen.queryByRole('img', { name: 'slapdash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    const tools = screen.getByRole('group', { name: 'Tools' });
    const names = within(tools).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Project', 'Materials', 'Build steps', 'Floors']);
    for (const key of within(tools).getAllByRole('button')) expect(key.textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('project popover takes focus and Escape returns it to the trigger', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Project' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const popover = screen.getByRole('dialog', { name: 'Project' });
    expect(trigger).toHaveAttribute('aria-controls', popover.id);
    expect(within(popover).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save', 'Load', 'Undo', 'Redo']);
    expect(popover).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opening one popover closes the other; a click outside closes it', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Project' }));
    await user.click(screen.getByRole('button', { name: 'Floors' }));
    expect(screen.queryByRole('dialog', { name: 'Project' })).not.toBeInTheDocument();
    const floors = screen.getByRole('dialog', { name: 'Floors' });
    expect(within(floors).getByRole('slider')).toHaveFocus();
    await user.click(screen.getByRole('main'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the eye popover holds the four view controls', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Views' }));
    const views = screen.getByRole('dialog', { name: 'Views' });
    expect(views.querySelectorAll('fieldset')).toHaveLength(4);
  });

  it('the chat key opens a sheet named Chat; Escape closes it', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    render(<App />);
    const chatKey = screen.getByRole('button', { name: 'Chat' });
    await user.click(chatKey);
    const sheet = screen.getByRole('dialog', { name: 'Chat' });
    expect(chatKey).toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getByRole('button', { name: 'Talk' })).toBeInTheDocument();
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chatKey).toHaveFocus();
  });

  it('the close key closes the sheet', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Chat' }));
    await user.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Materials and Build steps latch', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Materials' }));
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Build steps' }));
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Build steps' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('breakpoint', () => {
  it('swaps shells across 900px, keeping view choices and dropping phone-only state', async () => {
    setViewportWidth(1000);
    const user = userEvent.setup();
    render(<App />);
    expect(document.querySelector('[data-shell="desktop"]')).not.toBeNull();
    await user.click(screen.getByRole('radio', { name: '2D' }));

    act(() => setViewportWidth(880));
    expect(document.querySelector('[data-shell="phone"]')).not.toBeNull();
    expect(document.querySelector('[data-shell="desktop"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Chat' }));
    expect(useShellStore.getState().phone.chatOpen).toBe(true);

    act(() => setViewportWidth(900));
    expect(document.querySelector('[data-shell="desktop"]')).not.toBeNull();
    expect(screen.getByRole('radio', { name: '2D' })).toBeChecked();
    expect(useShellStore.getState().phone).toEqual({ popover: null, chatOpen: false });
  });
});
