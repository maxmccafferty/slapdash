import { useCallback, useRef } from 'react';
import { BottomSheet } from '../components/BottomSheet.tsx';
import { FloorSlider } from '../components/FloorSlider.tsx';
import { Key } from '../components/Key.tsx';
import { Popover, PopoverAnchor } from '../components/Popover.tsx';
import { Unit } from '../components/Unit.tsx';
import { useFloorStops } from '../model/floor-stops.ts';
import { useShellStore, type PhonePopover } from '../state/shell-store.ts';
import { ChatPanel } from './ChatPanel.tsx';
import type { ShellProps } from './DesktopShell.tsx';
import { ModelArea } from './ModelArea.tsx';
import { ProjectHeader } from './ProjectHeader.tsx';
import { ViewControls } from './ViewControls.tsx';
import styles from './PhoneShell.module.css';

const POPOVER_IDS: Record<PhonePopover, string> = {
  project: 'phone-project-popover',
  floors: 'phone-floors-popover',
  views: 'phone-views-popover',
};
const CHAT_SHEET_ID = 'phone-chat-sheet';

/** Phone: full-screen model, icon-only keys in the corners, chat as a bottom sheet. No logo. */
export function PhoneShell({ project, actions }: ShellProps) {
  const panel = useShellStore((s) => s.panel);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const floor = useShellStore((s) => s.floor);
  const setFloor = useShellStore((s) => s.setFloor);
  const floors = useFloorStops();
  const zoomPercent = useShellStore((s) => s.zoomPercent);
  const popover = useShellStore((s) => s.phone.popover);
  const chatOpen = useShellStore((s) => s.phone.chatOpen);
  const openPopover = useShellStore((s) => s.openPopover);
  const closePopover = useShellStore((s) => s.closePopover);
  const setChatOpen = useShellStore((s) => s.setChatOpen);
  const closeChat = useCallback(() => setChatOpen(false), [setChatOpen]);

  const projectRef = useRef<HTMLButtonElement>(null);
  const floorsRef = useRef<HTMLButtonElement>(null);
  const viewsRef = useRef<HTMLButtonElement>(null);
  const chatRef = useRef<HTMLButtonElement>(null);

  const toggle = (p: PhonePopover) => (popover === p ? closePopover() : openPopover(p));
  const trigger = (p: PhonePopover) => ({
    'aria-expanded': popover === p,
    'aria-controls': POPOVER_IDS[p],
    active: popover === p,
    onClick: () => toggle(p),
  });

  return (
    <div className={[styles.shell, chatOpen && styles['chat-open']].filter(Boolean).join(' ')} data-shell="phone">
      <header className={styles.header}>
        <ProjectHeader project={project} variant="phone" />
      </header>

      <main className={styles.main} aria-label="Model">
        <div className={styles.model} data-testid="model-stage">
          <ModelArea zoomPercent={zoomPercent} readout={false} />
        </div>

        <Unit className={styles.tools} direction="column" radius="panel" role="group" aria-label="Tools">
          <PopoverAnchor>
            <Key ref={projectRef} label="Project" icon="project" iconSize="phone" iconOnly {...trigger('project')} />
            <Popover
              id={POPOVER_IDS.project}
              label="Project"
              open={popover === 'project'}
              onClose={closePopover}
              triggerRef={projectRef}
            >
              <div className={styles['project-grid']}>
                <Key label="Save" icon="save" onClick={actions.onSave} />
                <Key label="Load" icon="load" onClick={actions.onLoad} />
                <Key label="Undo" icon="undo" onClick={actions.onUndo} />
                <Key label="Redo" icon="redo" onClick={actions.onRedo} />
              </div>
            </Popover>
          </PopoverAnchor>
          <Key
            label="Materials"
            icon="materials"
            iconSize="phone"
            iconOnly
            latched={panel === 'materials'}
            onClick={() => togglePanel('materials')}
          />
          <Key
            label="Build steps"
            icon="steps"
            iconSize="phone"
            iconOnly
            latched={panel === 'steps'}
            onClick={() => togglePanel('steps')}
          />
          <PopoverAnchor>
            <Key ref={floorsRef} label="Floors" icon="floors" iconSize="phone" iconOnly {...trigger('floors')} />
            <Popover id={POPOVER_IDS.floors} label="Floors" open={popover === 'floors'} onClose={closePopover} triggerRef={floorsRef}>
              <FloorSlider floors={floors} value={floor} onChange={setFloor} />
            </Popover>
          </PopoverAnchor>
        </Unit>

        <Unit className={styles.views}>
          <PopoverAnchor>
            <Key ref={viewsRef} label="Views" icon="eye" iconSize="phone" iconOnly {...trigger('views')} />
            <Popover
              id={POPOVER_IDS.views}
              label="Views"
              open={popover === 'views'}
              onClose={closePopover}
              triggerRef={viewsRef}
              placement="up-right"
            >
              <ViewControls layout="column" />
            </Popover>
          </PopoverAnchor>
        </Unit>

        <div className={styles['chat-key']}>
          <Key
            ref={chatRef}
            label="Chat"
            icon="chat"
            iconSize="phone"
            iconOnly
            tone="signal"
            aria-expanded={chatOpen}
            aria-controls={CHAT_SHEET_ID}
            onClick={() => setChatOpen(!chatOpen)}
          />
        </div>
      </main>

      {/* Model-area sheets and modals render inside <main>, below the chat sheet's z-index, and
          never make the chat inert: the chat stays usable while they are open. */}
      <BottomSheet id={CHAT_SHEET_ID} title="Chat" open={chatOpen} onClose={closeChat} triggerRef={chatRef}>
        <ChatPanel as="div" variant="phone" className={styles['sheet-chat']} />
      </BottomSheet>
    </div>
  );
}
