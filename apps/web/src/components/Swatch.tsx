import type { Swatch as CatalogSwatch } from '@slapdash/core';
import styles from './Swatch.module.css';

/**
 * The round material dot, coloured from the catalog swatch. This is the one runtime colour
 * the shell draws: it is data, not chrome.
 */
export function Swatch({ swatch }: { swatch: Pick<CatalogSwatch, 'color'> }) {
  return <span className={styles.swatch} style={{ backgroundColor: swatch.color }} aria-hidden="true" data-testid="swatch" />;
}
