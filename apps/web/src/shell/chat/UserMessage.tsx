import type { UserItem } from '../../agent/chat-types.ts';
import { PartChip } from './PartChip.tsx';
import styles from './Chat.module.css';

export function UserMessage({ item }: { item: UserItem }) {
  if (item.trigger === 'stress') {
    // Not typed by the person: a compact line saying what started the turn.
    return (
      <div className={[styles.message, styles.user].join(' ')} data-testid="stress-trigger">
        <span className={[styles.chip, styles['chip-static'], styles.trigger].join(' ')}>
          <span className="visually-hidden">Automatic: </span>
          <span className={styles['chip-label']}>{item.text}</span>
        </span>
      </div>
    );
  }
  return (
    <div className={[styles.message, styles.user].join(' ')}>
      <span className="visually-hidden">You</span>
      {item.pointer && <PartChip chip={item.pointer} />}
      {item.photos.length > 0 && (
        <div className={styles.photos}>
          {item.photos.map((p, i) => (
            <span key={p.fileId} className={styles.thumb}>
              <img src={p.url} alt={`Photo ${i + 1}`} />
            </span>
          ))}
        </div>
      )}
      {item.text !== '' && <p className={styles.text}>{item.text}</p>}
    </div>
  );
}
