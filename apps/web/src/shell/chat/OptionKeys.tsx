import { NOTHING_CHANGED, type ClaudeItem } from '../../agent/chat-types.ts';
import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import styles from './Chat.module.css';

/** Two ways that would work, when Claude couldn't do what was asked. Tapping one sends it. */
export function OptionKeys({ item, disabled }: { item: ClaudeItem; disabled: boolean }) {
  const chat = useChat();
  const options = item.options;
  if (!options) return null;
  const answered = options.state !== 'pending';
  return (
    <>
      <div className={styles.choices} role="group" aria-label="Options" data-pending={!answered || undefined}>
        {options.choices.map((choice) => (
          <Key
            key={choice}
            className={styles.choice}
            label={choice}
            active={options.chosen === choice}
            disabled={answered || disabled}
            onClick={() => void chat.chooseOption(item.id, choice)}
          />
        ))}
      </div>
      {item.nothingChanged && <p className={styles.note}>{NOTHING_CHANGED}</p>}
    </>
  );
}
