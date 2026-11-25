import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { firstFocusable, useDismiss } from '../hooks/useDismiss.ts';
import { Key } from './Key.tsx';
import styles from './BottomSheet.module.css';

export interface BottomSheetProps {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * A phone bottom sheet. Not modal: the model stays visible and usable above it. Focus moves
 * in on open; Escape or the close key closes it and returns focus to the trigger.
 */
export function BottomSheet({ id, title, open, onClose, triggerRef, children }: BottomSheetProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Only Escape and the close key dismiss it: touching the model above keeps the chat open.
  useDismiss(open, ref, triggerRef, onClose, { outside: false });
  useEffect(() => {
    if (open && ref.current) firstFocusable(ref.current)?.focus();
  }, [open]);
  if (!open) return null;
  const close = () => {
    onClose();
    triggerRef.current?.focus();
  };
  return (
    <div ref={ref} id={id} className={styles.sheet} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <Key label={`Close ${title.toLowerCase()}`} icon="close" iconSize="phone" iconOnly onClick={close} />
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
