import { useRef, type ChangeEvent } from 'react';
import type { ClaudeItem } from '../../agent/chat-types.ts';
import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import styles from './Chat.module.css';

/**
 * Claude asked for a photo (ADR-0003 §J.4: photos only when asked). Take photo opens the
 * camera on a phone; on desktop both keys open the file picker.
 */
export function PhotoRequest({ request, disabled }: { request: NonNullable<ClaudeItem['photoRequest']>; disabled: boolean }) {
  const chat = useChat();
  const takeRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const answered = request.state !== 'pending';
  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    for (const file of files) void chat.attachPhoto(file);
  };
  return (
    <div className={styles.message} role="group" aria-label="Photo request" data-pending={!answered || undefined}>
      <p className={styles.note}>Photo of {request.what}</p>
      <div className={styles.keys}>
        <Key label="Take photo" icon="camera" disabled={answered || disabled} onClick={() => takeRef.current?.click()} />
        <Key label="Choose photo" icon="image" disabled={answered || disabled} onClick={() => chooseRef.current?.click()} />
      </div>
      <input ref={takeRef} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} data-testid="take-photo-input" onChange={onPick} />
      <input ref={chooseRef} type="file" accept="image/*" hidden tabIndex={-1} data-testid="choose-photo-input" onChange={onPick} />
    </div>
  );
}
