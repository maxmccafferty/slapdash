import { formatResetDate } from '../../agent/chat-controller.ts';
import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import { useChatStore } from '../../state/chat-store.ts';
import styles from './Chat.module.css';

/** A muted line in the transcript: a warning, an error or "Stopped.". */
export function ChatNote({ text }: { text: string }) {
  return <p className={styles.note}>{text}</p>;
}

/** Why Claude can't be used right now (no key, or this month's budget is spent). */
export function ConnectionNote() {
  const connection = useChatStore((s) => s.connection);
  const resetsAt = useChatStore((s) => s.budget?.resetsAt);
  const chat = useChat();
  if (connection === 'not_configured') {
    return (
      <div className={styles.card} data-testid="no-key-note">
        <p className={styles['card-title']}>Claude isn't connected</p>
        <p className={styles.note}>
          Add an Anthropic API key to <code>.env</code> (see CONTRIBUTING) and restart <code>pnpm dev</code>. Everything else works without it.
        </p>
        <div className={styles.keys}>
          <Key label="Open the sample pool house" onClick={() => chat.openSample()} />
        </div>
      </div>
    );
  }
  if (connection === 'capped') {
    return (
      <div className={styles.card} data-testid="capped-note">
        <p className={styles['card-title']}>This month's Claude budget is used up</p>
        <p className={styles.note}>
          Claude is back on {resetsAt ? formatResetDate(resetsAt) : 'the first of next month'}. Everything else keeps working.
        </p>
      </div>
    );
  }
  return null;
}
