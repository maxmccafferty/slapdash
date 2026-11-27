import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { displayText, type ChatItem } from '../../agent/chat-types.ts';
import { isContextPart } from '../../renderer/bounds.ts';
import { useChatStore } from '../../state/chat-store.ts';
import { useModelStore } from '../../state/model-store.ts';
import { ChatNote, ConnectionNote } from './ChatNote.tsx';
import { ClaudeMessage } from './ClaudeMessage.tsx';
import { ListeningMessage } from './ListeningMessage.tsx';
import { Starters } from './Starters.tsx';
import { UserMessage } from './UserMessage.tsx';
import { WorkingLine } from './WorkingLine.tsx';
import styles from './Chat.module.css';

/** Within this many px of the bottom counts as "at the bottom": new text keeps it there. */
const STICK_PX = 32;

function lastFinished(items: readonly ChatItem[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'claude' && !item.streaming) return item;
  }
  return null;
}

/**
 * The conversation. It follows new text unless the person has scrolled up, and announces each
 * finished Claude message (not every streamed word) to screen readers.
 */
export function Transcript() {
  const items = useChatStore((s) => s.items);
  const connection = useChatStore((s) => s.connection);
  const working = useChatStore((s) => s.running?.working ?? false);
  const listening = useChatStore((s) => s.listening);
  // First run: an empty site gets the starters (site context alone still counts as empty).
  const emptySite = useModelStore((s) => !!s.bus && Object.values(s.project?.parts ?? {}).every(isContextPart));
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // On mount (the phone sheet opening), show a pending plan or photo request, else the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pending = el.querySelectorAll<HTMLElement>('[data-pending]');
    const last = pending[pending.length - 1];
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'nearest' });
    else el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, working, connection, listening]);

  // Content also grows without a render here: photos and images loading, plan and photo cards
  // laying out, the composer growing and shrinking the transcript. Watch every row's size (and
  // the transcript's own), and while the person is at the bottom, keep them there.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    const sizes = new ResizeObserver(follow);
    sizes.observe(el);
    for (const child of el.children) sizes.observe(child);
    const rows = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) sizes.observe(node);
        for (const node of record.removedNodes) if (node instanceof Element) sizes.unobserve(node);
      }
      follow();
    });
    rows.observe(el, { childList: true });
    return () => {
      sizes.disconnect();
      rows.disconnect();
    };
  }, []);

  const finished = lastFinished(items);
  const seen = useRef<string | null>(finished?.id ?? null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!finished || finished.id === seen.current) return;
    seen.current = finished.id;
    setAnnouncement(`Claude: ${displayText(finished)}`);
  }, [finished]);

  const empty = items.length === 0 && (connection === 'ready' || connection === 'checking');
  return (
    <div
      ref={ref}
      className={styles.transcript}
      role="region"
      aria-label="Conversation"
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      }}
    >
      {empty && (
        <div className={styles.message}>
          <span className={styles.speaker}>Claude</span>
          <p className={styles.text}>What are we building?</p>
          {emptySite && !listening && <Starters />}
        </div>
      )}
      {items.map((item) =>
        item.kind === 'user' ? (
          <UserMessage key={item.id} item={item} />
        ) : item.kind === 'claude' ? (
          <ClaudeMessage key={item.id} item={item} />
        ) : (
          <ChatNote key={item.id} text={item.text} />
        ),
      )}
      {listening && <ListeningMessage heard={listening.heard} unconfirmed={listening.unconfirmed} />}
      {working && <WorkingLine />}
      <ConnectionNote />
      <div className="visually-hidden" aria-live="polite" data-testid="chat-announcer">
        {announcement}
      </div>
    </div>
  );
}
