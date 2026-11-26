import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { firstFocusable, useDismiss } from '../hooks/useDismiss.ts';
import { Unit } from './Unit.tsx';
import styles from './Popover.module.css';

export type PopoverPlacement = 'left' | 'up-right';

export interface PopoverProps {
  id: string;
  label: string;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  /** `left` opens beside a vertical unit; `up-right` opens above a bottom-left key. */
  placement?: PopoverPlacement;
  direction?: 'row' | 'column';
  children: ReactNode;
}

/** Wraps a trigger and its popover so the popover can be positioned against it. */
export function PopoverAnchor({ children }: { children: ReactNode }) {
  return <div className={styles.anchor}>{children}</div>;
}

/**
 * A non-modal popover in a unit. Rendered only while open; focus moves to its first control,
 * Escape closes it and returns focus to the trigger, and a click outside closes it.
 */
export function Popover({ id, label, open, onClose, triggerRef, placement = 'left', direction = 'column', children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, triggerRef, onClose);
  useEffect(() => {
    if (open && ref.current) firstFocusable(ref.current)?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <Unit
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      direction={direction}
      radius="panel"
      className={`${styles.popover} ${styles[placement]}`}
    >
      {children}
    </Unit>
  );
}
