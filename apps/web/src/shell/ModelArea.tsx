import styles from './ModelArea.module.css';

/** Where the 3D scene will go. For now, the empty build floor and the zoom readout. */
export function ModelArea({ zoomPercent, readout = true }: { zoomPercent: number; readout?: boolean }) {
  return (
    <div className={styles.area}>
      <div className={styles.floor} role="img" aria-label="Build floor. The 3D view is coming soon." />
      {readout && (
        <p className={styles.readout} data-testid="zoom-readout">
          <span>scroll to zoom</span>
          <span>{zoomPercent}%</span>
        </p>
      )}
    </div>
  );
}
