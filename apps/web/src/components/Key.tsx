import type { ComponentPropsWithRef } from 'react';
import { Icon, type IconName, type IconSize } from './Icon.tsx';
import styles from './Key.module.css';

export interface KeyProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Visible label, or the accessible name when `iconOnly`. */
  label: string;
  icon?: IconName;
  iconSize?: IconSize;
  iconOnly?: boolean;
  /** A toggle key: sets `aria-pressed` and the latched look. */
  latched?: boolean;
  /** The latched look without `aria-pressed` (popover triggers, which use `aria-expanded`). */
  active?: boolean;
  tone?: 'light' | 'dark' | 'signal';
}

/** A white key inside a unit. React 19 passes `ref` through as a prop. */
export function Key({
  label,
  icon,
  iconSize = 'key',
  iconOnly = false,
  latched,
  active = false,
  tone = 'light',
  className,
  type = 'button',
  ...rest
}: KeyProps) {
  const classes = [
    styles.key,
    iconOnly && styles['icon-only'],
    (latched || active) && styles.latched,
    tone === 'dark' && styles.dark,
    tone === 'signal' && styles.signal,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      aria-pressed={latched}
      aria-label={iconOnly ? label : rest['aria-label']}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}
