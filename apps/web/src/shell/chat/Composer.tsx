import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { formatResetDate } from '../../agent/chat-controller.ts';
import { useChat } from '../../agent/ChatContext.tsx';
import { Key } from '../../components/Key.tsx';
import { TalkKey } from '../../components/TalkKey.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';
import { useChatStore } from '../../state/chat-store.ts';
import { useModelStore } from '../../state/model-store.ts';
import { PartChip } from './PartChip.tsx';
import { Waveform } from './Waveform.tsx';
import styles from './Chat.module.css';

/**
 * The message field with the pointed-part chip and any photos above it, Send (Stop while
 * Claude works or reads a reply aloud) and Talk. On a fine pointer Enter sends and Shift+Enter
 * adds a line; on touch Enter adds a line and the Send key sends. While Talk is held the field
 * gives way to the listening strip; Talk is hidden where the browser can't recognise speech.
 */
export function Composer({ phone }: { phone: boolean }) {
  const chat = useChat();
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const connection = useChatStore((s) => s.connection);
  const running = useChatStore((s) => s.running !== null);
  const photos = useChatStore((s) => s.pendingPhotos);
  const changingPlan = useChatStore((s) => s.changingPlan);
  const focusRequest = useChatStore((s) => s.focusRequest);
  const resetsAt = useChatStore((s) => s.budget?.resetsAt);
  const canListen = useChatStore((s) => s.voice.listen);
  const listening = useChatStore((s) => s.listening !== null);
  const speaking = useChatStore((s) => s.speaking);
  const selectedId = useModelStore((s) => s.selectedPartId);
  const selectedLabel = useModelStore((s) => s.selectedPartLabel);
  const swatch = useModelStore((s) => {
    const part = s.selectedPartId ? s.project?.parts[s.selectedPartId] : undefined;
    return part ? s.catalog?.materials.get(part.materialId)?.swatch : undefined;
  });
  const coarse = useMediaQuery('(pointer: coarse)');

  const unavailable = connection === 'not_configured' || connection === 'capped';
  const iconSize = phone ? 'phone' : 'key';

  const lastFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === lastFocus.current) return;
    lastFocus.current = focusRequest;
    fieldRef.current?.focus();
  }, [focusRequest]);

  const submit = () => {
    if (running || unavailable) return;
    void chat.send(useChatStore.getState().draft);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || coarse) return;
    event.preventDefault();
    submit();
  };

  const placeholder =
    connection === 'not_configured'
      ? "Claude isn't connected"
      : connection === 'capped'
        ? `Claude is back on ${resetsAt ? formatResetDate(resetsAt) : 'the first of next month'}`
        : changingPlan
          ? 'What should change?'
          : 'Tell Claude what to build';

  return (
    <div className={styles.composer}>
      {selectedId && selectedLabel && !unavailable && (
        <PartChip
          chip={{ id: selectedId, label: selectedLabel, swatch: swatch ? { color: swatch.color } : null }}
          onRemove={() => useModelStore.getState().select(null)}
        />
      )}
      {photos.length > 0 && (
        <div className={styles.photos}>
          {photos.map((p, i) => (
            <span key={p.fileId} className={styles.thumb}>
              <img src={p.url} alt={`Photo ${i + 1} to send`} />
              <Key className={styles['thumb-remove']} label={`Remove photo ${i + 1}`} icon="close" iconOnly onClick={() => chat.removePhoto(p.fileId)} />
            </span>
          ))}
        </div>
      )}
      <form className={styles.form} onSubmit={onSubmit}>
        <label htmlFor={fieldId} className="visually-hidden">
          Message Claude
        </label>
        {listening && <Waveform />}
        {/* Hidden, not unmounted, while listening: the draft and focus requests stay intact. */}
        <textarea
          ref={fieldRef}
          id={fieldId}
          className={styles.field}
          hidden={listening}
          rows={1}
          enterKeyHint="send"
          placeholder={placeholder}
          disabled={unavailable}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {running || speaking ? (
          <Key className={styles.send} label="Stop" icon="stop" iconSize={iconSize} iconOnly tone="dark" onClick={() => chat.stop()} />
        ) : (
          <Key className={styles.send} type="submit" label="Send" icon="send" iconSize={iconSize} iconOnly tone="dark" disabled={unavailable} />
        )}
        {canListen && (
          <TalkKey
            iconOnly={phone}
            iconSize={iconSize}
            disabled={unavailable || running}
            onHoldStart={() => chat.startTalking()}
            onHoldEnd={() => void chat.stopTalking()}
          />
        )}
      </form>
    </div>
  );
}
