import type { ProjectSummary } from '@slapdash/storage';
import styles from './ProjectsPanel.module.css';

/** "Nov 25", or "Nov 25, 2025" when it isn't this year. */
export function formatEdited(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export interface ProjectCardProps {
  project: ProjectSummary;
  thumbnail: string | undefined;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}

/** A stored project: its picture (or the plain dot floor), name, last edit and part count. */
export function ProjectCard({ project, thumbnail, current, disabled, onOpen }: ProjectCardProps) {
  const edited = formatEdited(project.updatedAt);
  return (
    <li className={styles.item}>
      <button
        type="button"
        className={[styles.card, current && styles.current].filter(Boolean).join(' ')}
        aria-current={current || undefined}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className={styles.picture}>
          {thumbnail ? <img className={styles.thumbnail} src={thumbnail} alt="" /> : <span className={styles.floor} aria-hidden="true" />}
        </span>
        <span className={styles.name}>
          {current && <span className={styles.dot} aria-hidden="true" />}
          {/* The name comes from the visible text, so speech input can use what is shown. */}
          {!current && <span className="visually-hidden">Open </span>}
          {project.name}
          {current && <span className="visually-hidden">, open now</span>}
        </span>
        <span className={styles.meta}>
          <span className="visually-hidden">, </span>
          Edited {edited} · {plural(project.partCount, 'part')}
        </span>
      </button>
    </li>
  );
}
