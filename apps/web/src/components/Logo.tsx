import styles from './Logo.module.css';

/**
 * The lockup: the stud wall mark at the wordmark's cap height, then "slapdash" in Geist 700.
 * The mark is docs/design/logo/slapdash-mark.svg without its c2pa metadata, cropped to its
 * rects; the studs take `currentColor` (ink) and the plate `--color-signal`.
 */
export function Logo() {
  return (
    <div className={styles.lockup} role="img" aria-label="slapdash">
      <svg className={styles.mark} viewBox="29 26 62 70" aria-hidden="true" focusable="false">
        <rect className={styles.plate} x="29" y="26" width="62" height="13" rx="2" />
        <rect className={styles.stud} x="29" y="47" width="14" height="49" rx="2" />
        <rect className={styles.stud} x="53" y="47" width="14" height="49" rx="2" />
        <rect className={styles.stud} x="77" y="47" width="14" height="49" rx="2" />
      </svg>
      <span aria-hidden="true">slapdash</span>
    </div>
  );
}
