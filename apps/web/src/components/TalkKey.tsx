import { useState, type KeyboardEvent } from 'react';
import { Icon, type IconSize } from './Icon.tsx';
import styles from './TalkKey.module.css';

export interface TalkKeyProps {
  iconOnly?: boolean;
  iconSize?: IconSize;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  /** Faded and inert, e.g. while Claude isn't available. */
  disabled?: boolean;
}

/** The orange push-to-talk key. Hold with the pointer, Space or Enter; it reads "Let go" while held. */
export function TalkKey({ iconOnly = false, iconSize = 'key', onHoldStart, onHoldEnd, disabled = false }: TalkKeyProps) {
  const [held, setHeld] = useState(false);
  const start = () => {
    if (held || disabled) return;
    setHeld(true);
    onHoldStart?.();
  };
  const end = () => {
    if (!held) return;
    setHeld(false);
    onHoldEnd?.();
  };
  const isHoldKey = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';
  const label = held ? 'Let go' : 'Talk';

  return (
    <button
      type="button"
      disabled={disabled}
      className={[styles.talk, iconOnly && styles['icon-only'], held && styles.held].filter(Boolean).join(' ')}
      aria-pressed={held}
      aria-label={iconOnly ? label : undefined}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (!isHoldKey(event)) return;
        event.preventDefault();
        if (!event.repeat) start();
      }}
      onKeyUp={(event) => {
        if (!isHoldKey(event)) return;
        event.preventDefault();
        end();
      }}
      onBlur={end}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Icon name="mic" size={iconSize} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}
