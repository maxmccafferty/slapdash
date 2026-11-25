import { useEffect, useId, useRef, type RefObject } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Key } from '../components/Key.tsx';
import { useDismiss } from '../hooks/useDismiss.ts';
import { useShellStore } from '../state/shell-store.ts';
import { ProjectCard } from './ProjectCard.tsx';
import { useProjects } from './ProjectsContext.tsx';
import { useProjectsStore } from './projects-store.ts';
import styles from './ProjectsPanel.module.css';

export const KEPT_ON_DEVICE = 'Projects you make are kept on this device.';

export interface ProjectsPanelProps {
  variant: 'desktop' | 'phone';
  /** The Load key: Escape and Close return focus to it. */
  triggerRef: RefObject<HTMLElement | null>;
}

/**
 * The Projects modal (ADR-0003 §I), opened by Load: a New project card, the projects kept on
 * this device (newest first, the open one marked) and Import a .slapdash file. Like
 * Materials it covers the model only; the chat stays usable.
 */
export function ProjectsPanel({ variant, triggerRef }: ProjectsPanelProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const actions = useProjects();
  const projects = useProjectsStore((s) => s.projects);
  const thumbnails = useProjectsStore((s) => s.thumbnails);
  const currentId = useProjectsStore((s) => s.currentId);
  const busy = useProjectsStore((s) => s.busy);
  const error = useProjectsStore((s) => s.error);
  const closePanel = useShellStore((s) => s.closePanel);

  useDismiss(true, ref, triggerRef, closePanel, { outside: false });
  useEffect(() => {
    ref.current?.focus();
    actions.clearError();
    void actions.prepareList();
  }, [actions]);

  const close = () => {
    closePanel();
    triggerRef.current?.focus();
  };

  return (
    <section
      ref={ref}
      className={[styles.panel, styles[variant]].join(' ')}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      tabIndex={-1}
      data-variant={variant}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          Projects
        </h2>
        <Key className={styles.close} label="Close projects" icon="close" iconSize={variant === 'phone' ? 'phone' : 'key'} iconOnly onClick={close} />
      </header>

      {/* Focusable so keyboard users can scroll a long list. */}
      <div className={styles.body} tabIndex={0} role="region" aria-label="Your projects">
        <ul className={styles.grid}>
          <li className={styles.item}>
            <button type="button" className={[styles.card, styles.new].join(' ')} disabled={busy} onClick={() => void actions.newProject()}>
              <span className={[styles.picture, styles['new-picture']].join(' ')} aria-hidden="true">
                <Icon name="plus" size="phone" />
              </span>
              <span className={styles.name}>New project</span>
              <span className={styles.meta}>An empty site</span>
            </button>
          </li>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              thumbnail={thumbnails[p.id]}
              current={p.id === currentId}
              disabled={busy}
              onOpen={() => void actions.openProject(p.id)}
            />
          ))}
        </ul>
        {projects.length === 0 && <p className={styles.muted}>{KEPT_ON_DEVICE}</p>}
      </div>

      <footer className={styles.footer}>
        <Key label="Import a .slapdash file" icon="upload" disabled={busy} onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept=".slapdash,application/json"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="import-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void actions.importFile(file);
          }}
        />
        <p className={styles.error} role="status">
          {error}
        </p>
      </footer>
    </section>
  );
}
