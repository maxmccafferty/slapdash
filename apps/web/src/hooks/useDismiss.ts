import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first keyboard-focusable element inside `root`. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * While open: Escape closes and returns focus to the trigger; unless `outside` is false, a
 * pointer down outside both the container and the trigger closes without moving focus (it
 * goes where you clicked).
 */
export function useDismiss(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  { outside = true }: { outside?: boolean } = {},
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!outside) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, containerRef, triggerRef, onClose, outside]);
}
