import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import { useChatStore } from '../../state/chat-store.ts';
import styles from './Chat.module.css';

/** First run's starter requests (ADR-0003 §I). Tapping one sends it. */
export const STARTERS = [
  'A 10′ × 12′ garden shed',
  'A 16′ × 20′ pool house with a sliding door',
  'A 6′ fence along the back of the yard',
] as const;

export const OPEN_SAMPLE = 'Open the sample pool house';

/** Under "What are we building?" on an empty site: three starters and the sample. */
export function Starters() {
  const chat = useChat();
  const running = useChatStore((s) => s.running !== null);
  return (
    <div className={styles.starters} data-testid="starters">
      <div className={styles.choices} role="group" aria-label="Start with">
        {STARTERS.map((text) => (
          <Key key={text} className={styles.choice} label={text} disabled={running} onClick={() => void chat.send(text)} />
        ))}
      </div>
      <div className={styles.keys}>
        <Key label={OPEN_SAMPLE} disabled={running} onClick={() => chat.openSample()} />
      </div>
    </div>
  );
}
