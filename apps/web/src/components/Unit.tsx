import type { ComponentPropsWithRef } from 'react';
import styles from './Unit.module.css';

export interface UnitProps extends ComponentPropsWithRef<'div'> {
  direction?: 'row' | 'column';
  radius?: 'unit' | 'panel' | 'sheet';
}

/**
 * The grey housing every control sits in. No border, no shadow. Pass `role="group"` and an
 * `aria-label` when it groups keys.
 */
export function Unit({ direction = 'row', radius = 'unit', className, ...rest }: UnitProps) {
  const classes = [styles.unit, styles[direction], radius === 'unit' ? '' : styles[`radius-${radius}`], className]
    .filter(Boolean)
    .join(' ');
  return <div {...rest} className={classes} />;
}
