import type { ProjectSummary } from '../placeholder.ts';
import styles from './ProjectHeader.module.css';

/** The project name and its four ruled specs (footprint, walls, roof, parts). */
export function ProjectHeader({ project, variant }: { project: ProjectSummary; variant: 'desktop' | 'phone' }) {
  return (
    <div className={[styles.project, variant === 'phone' && styles.phone].filter(Boolean).join(' ')}>
      <h1 className={styles.name}>{project.name}</h1>
      <dl className={styles.specs}>
        {project.specs.map((spec) => (
          <div key={spec.label} className={styles.spec}>
            <dt className={styles.label}>{spec.label}</dt>
            <dd className={styles.value}>{spec.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
