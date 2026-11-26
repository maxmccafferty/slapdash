import { Composer } from './chat/Composer.tsx';
import { Transcript } from './chat/Transcript.tsx';
import styles from './ChatPanel.module.css';

export interface ChatPanelProps {
  /** `aside` on desktop (the Chat landmark); `div` inside the phone sheet, which is labelled itself. */
  as?: 'aside' | 'div';
  /** Phone: the sheet is the housing, and Talk and Send are icon-only. */
  variant?: 'desktop' | 'phone';
  className?: string;
}

/**
 * The chat: transcript and composer. State lives in the chat store and the controller
 * (`src/agent/chat-controller.ts`), so it survives this panel unmounting.
 */
export function ChatPanel({ as: As = 'aside', variant = 'desktop', className }: ChatPanelProps) {
  return (
    <As
      className={[styles.panel, variant === 'phone' && styles.bare, className].filter(Boolean).join(' ')}
      aria-label={As === 'aside' ? 'Chat' : undefined}
    >
      <Transcript />
      <Composer phone={variant === 'phone'} />
    </As>
  );
}
