import { displayText, paragraphs, type ClaudeItem } from '../../agent/chat-types.ts';
import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import { useChatStore } from '../../state/chat-store.ts';
import { useModelStore } from '../../state/model-store.ts';
import { OptionKeys } from './OptionKeys.tsx';
import { PhotoRequest } from './PhotoRequest.tsx';
import { PlanCard } from './PlanCard.tsx';
import styles from './Chat.module.css';

function UndoKey({ item }: { item: ClaudeItem }) {
  const chat = useChat();
  // Re-render when the project or the running turn changes, so the key tracks the history.
  useModelStore((s) => s.project);
  useChatStore((s) => s.running);
  const undo = item.undo!;
  const undone = undo.state === 'undone';
  const enabled = !undone && chat.canUndo(undo.entryId);
  return (
    <Key
      label={undone ? 'Undone' : 'Undo'}
      aria-label={undone ? 'Undone' : 'Undo this change'}
      icon="undo"
      disabled={!enabled}
      onClick={() => chat.undoTurn(item.id)}
    />
  );
}

/** One turn of Claude's: text as plain paragraphs, then Undo, notes and any card. */
export function ClaudeMessage({ item }: { item: ClaudeItem }) {
  const running = useChatStore((s) => s.running !== null);
  const usable = useChatStore((s) => s.connection === 'ready' || s.connection === 'checking');
  const blocked = running || !usable;
  return (
    <div className={styles.message} data-testid="claude-message" aria-busy={item.streaming || undefined}>
      <span className={styles.speaker}>Claude</span>
      {paragraphs(displayText(item)).map((p, i) => (
        <p key={i} className={styles.text}>
          {p}
        </p>
      ))}
      {item.undo && <UndoKey item={item} />}
      {item.notes.map((n, i) => (
        <p key={i} className={styles.note}>
          {n}
        </p>
      ))}
      {item.plan && <PlanCard plan={item.plan} disabled={blocked} />}
      {item.photoRequest && <PhotoRequest request={item.photoRequest} disabled={blocked} />}
      {item.options && <OptionKeys item={item} disabled={blocked} />}
    </div>
  );
}
