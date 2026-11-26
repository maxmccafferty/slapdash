import styles from './Chat.module.css';

/** Claude is running tools: an orange dot and "Working…". */
export function WorkingLine() {
  return (
    <p className={styles.working} data-testid="working">
      <span className={styles.dot} aria-hidden="true" />
      Working…
    </p>
  );
}
