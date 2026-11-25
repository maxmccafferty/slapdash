import { useId, useState, type FormEvent } from 'react';
import { Key } from '../components/Key.tsx';
import { Swatch } from '../components/Swatch.tsx';
import { TalkKey } from '../components/TalkKey.tsx';
import { PLACEHOLDER_CHIP } from '../placeholder.ts';
import styles from './ChatPanel.module.css';

export interface ChatPanelProps {
  /** `aside` on desktop (the Chat landmark); `div` inside the phone sheet, which is labelled itself. */
  as?: 'aside' | 'div';
  /** Phone: the sheet is the housing, and Talk and Send are icon-only. */
  variant?: 'desktop' | 'phone';
  className?: string;
}

/** The chat panel with placeholder content. Chat behaviour comes in a later ticket. */
export function ChatPanel({ as: As = 'aside', variant = 'desktop', className }: ChatPanelProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState('');
  const phone = variant === 'phone';
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setDraft('');
  };
  return (
    <As
      className={[styles.panel, phone && styles.bare, className].filter(Boolean).join(' ')}
      aria-label={As === 'aside' ? 'Chat' : undefined}
    >
      <div className={styles.transcript}>
        <div className={styles.message}>
          <span className={styles.speaker}>Claude</span>
          <p className={styles.text}>What are we building?</p>
        </div>
        <span className={styles.chip}>
          <Swatch swatch={PLACEHOLDER_CHIP.swatch} />
          {PLACEHOLDER_CHIP.label}
        </span>
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        <label htmlFor={fieldId} className="visually-hidden">
          Message Claude
        </label>
        <textarea
          id={fieldId}
          className={styles.field}
          rows={1}
          placeholder="Tell Claude what to build"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Key className={styles.send} type="submit" label="Send" icon="send" iconSize={phone ? 'phone' : 'key'} iconOnly tone="dark" />
        <TalkKey iconOnly={phone} iconSize={phone ? 'phone' : 'key'} />
      </form>
    </As>
  );
}
