import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectSummary } from '@slapdash/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.tsx';
import { ProjectsProvider, type ProjectsActions } from '../../src/projects/ProjectsContext.tsx';
import { KEPT_ON_DEVICE } from '../../src/projects/ProjectsPanel.tsx';
import { resetProjectsStore, useProjectsStore } from '../../src/projects/projects-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { OFFLINE_LINE, SYNCED_LINE } from '../../src/sync/sync-status.ts';
import { setViewportWidth } from '../setup.ts';

const NOV_25 = new Date(2026, 10, 25, 12).getTime();
const PROJECTS: ProjectSummary[] = [
  { id: 'p2', name: 'Pool house', named: true, createdAt: NOV_25, updatedAt: NOV_25, partCount: 412 },
  { id: 'p1', name: 'Garden shed', named: true, createdAt: NOV_25, updatedAt: new Date(2025, 4, 2).getTime(), partCount: 1 },
];

function stub(): ProjectsActions {
  return {
    openProject: vi.fn(async () => true),
    newProject: vi.fn(async () => {}),
    importFile: vi.fn(async () => true),
    openSample: vi.fn(async () => true),
    prepareList: vi.fn(async () => {}),
    clearError: vi.fn(),
    signOut: vi.fn(async () => {}),
  };
}

function renderApp(actions: ProjectsActions) {
  const onLoad = () => useShellStore.getState().togglePanel('projects');
  render(
    <ProjectsProvider controller={actions}>
      <App actions={{ onSave: () => {}, onLoad, onUndo: () => {}, onRedo: () => {} }} />
    </ProjectsProvider>,
  );
}

const dialog = () => screen.getByRole('dialog', { name: 'Projects' });

beforeEach(() => {
  resetProjectsStore();
  vi.useRealTimers();
});

describe('the Projects modal (desktop)', () => {
  it('Load opens it over the model: New project, then the stored projects with the open one marked', async () => {
    useProjectsStore.setState({ projects: PROJECTS, thumbnails: { p2: 'blob:pool' }, currentId: 'p2' });
    const actions = stub();
    renderApp(actions);
    const user = userEvent.setup();
    const load = screen.getByRole('button', { name: 'Load' });
    await user.click(load);
    expect(load).toHaveAttribute('aria-pressed', 'true');
    const d = dialog();
    expect(d.closest('main')).not.toBeNull();
    expect(d).toHaveAttribute('aria-modal', 'false');
    expect(actions.prepareList).toHaveBeenCalledTimes(1);
    const cards = within(d).getAllByRole('listitem').map((li) => within(li).getByRole('button'));
    expect(cards.map((c) => c.textContent)).toEqual([
      'New projectAn empty site',
      'Pool house, open now, Edited Nov 25 · 412 parts',
      'Open Garden shed, Edited May 2, 2025 · 1 part',
    ]);
    expect(cards[1]).toHaveAttribute('aria-current', 'true');
    expect(cards[1]!.querySelector('img')).toHaveAttribute('src', 'blob:pool');
    expect(cards[2]!.querySelector('img')).toBeNull();
    expect(within(cards[2]!).getByText('Edited May 2, 2025 · 1 part')).toBeInTheDocument();
    expect(within(d).queryByText(KEPT_ON_DEVICE)).not.toBeInTheDocument();

    await user.click(cards[2]!);
    expect(actions.openProject).toHaveBeenCalledWith('p1');
    await user.click(cards[0]!);
    expect(actions.newProject).toHaveBeenCalledTimes(1);
  });

  it('with nothing stored, says where projects are kept', async () => {
    renderApp(stub());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load' }));
    expect(within(dialog()).getByText(KEPT_ON_DEVICE)).toBeInTheDocument();
  });

  it('Import a .slapdash file passes the picked file on, and an error shows in the status line', async () => {
    const actions = stub();
    renderApp(actions);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load' }));
    const file = new File(['{}'], 'shed.slapdash', { type: 'application/json' });
    await user.upload(screen.getByTestId('import-input'), file);
    expect(actions.importFile).toHaveBeenCalledWith(file);
    act(() => useProjectsStore.setState({ error: 'This file is not a Slapdash project.' }));
    expect(within(dialog()).getByRole('status')).toHaveTextContent('This file is not a Slapdash project.');
  });

  it('disables the cards while busy', async () => {
    useProjectsStore.setState({ projects: PROJECTS, busy: true });
    renderApp(stub());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load' }));
    for (const b of within(dialog()).getAllByRole('listitem').map((li) => within(li).getByRole('button'))) expect(b).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Import a .slapdash file' })).toBeDisabled();
  });

  it('Escape and Close return focus to Load', async () => {
    renderApp(stub());
    const user = userEvent.setup();
    const load = screen.getByRole('button', { name: 'Load' });
    await user.click(load);
    expect(dialog()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument();
    expect(load).toHaveFocus();
    await user.click(load);
    await user.click(within(dialog()).getByRole('button', { name: 'Close projects' }));
    expect(load).toHaveFocus();
  });
});

describe('the Projects modal (phone)', () => {
  it('Load in the project popover closes the popover and opens Projects', async () => {
    setViewportWidth(390);
    useProjectsStore.setState({ projects: PROJECTS });
    renderApp(stub());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Project' }));
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(useShellStore.getState().phone.popover).toBeNull();
    const d = dialog();
    expect(d).toHaveAttribute('data-variant', 'phone');
    expect(within(d).getAllByRole('listitem')).toHaveLength(3);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Project' })).toHaveFocus();
  });
});

describe('the Projects modal on a hosted copy (sync and sign-in)', () => {
  it('says the projects are synced, and offers Sign out for the signed-in user', async () => {
    useProjectsStore.setState({ projects: [], sync: { kind: 'synced' }, user: { displayName: 'max@example.com', email: 'max@example.com' } });
    const actions = stub();
    renderApp(actions);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load' }));
    const d = dialog();
    expect(within(d).getByText(SYNCED_LINE)).toBeInTheDocument();
    expect(within(d).queryByText(KEPT_ON_DEVICE)).not.toBeInTheDocument();
    expect(within(d).getByText('Signed in as max@example.com')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Sign out' }));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  it('says when the cloud is out of reach', async () => {
    useProjectsStore.setState({ projects: PROJECTS, sync: { kind: 'offline', message: 'x', pending: 1 }, user: { displayName: 'Max' } });
    renderApp(stub());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load' }));
    expect(within(dialog()).getByText(OFFLINE_LINE)).toBeInTheDocument();
    expect(within(dialog()).getByText('Signed in as Max')).toBeInTheDocument();
  });

  it('local-only: no sync line and no Sign out', async () => {
    renderApp(stub());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load' }));
    expect(within(dialog()).queryByTestId('sync-line')).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});
