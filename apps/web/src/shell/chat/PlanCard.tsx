import type { ClaudeItem } from '../../agent/chat-types.ts';
import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import styles from './Chat.module.css';

/** A one-line plan before a big change, with Build it and Change something. */
export function PlanCard({ plan, disabled }: { plan: NonNullable<ClaudeItem['plan']>; disabled: boolean }) {
  const chat = useChat();
  const answered = plan.state !== 'pending';
  return (
    <div className={styles.card} data-pending={!answered || undefined} role="group" aria-label="Plan">
      <p className={styles.text}>{plan.text}</p>
      <div className={styles.keys}>
        <Key label="Build it" tone="dark" active={plan.state === 'approved'} disabled={answered || disabled} onClick={() => void chat.approvePlan()} />
        <Key label="Change something" active={plan.state === 'changing'} disabled={answered || disabled} onClick={() => chat.changePlan()} />
      </div>
    </div>
  );
}
