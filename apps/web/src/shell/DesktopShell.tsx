import { FloorSlider } from '../components/FloorSlider.tsx';
import { Key } from '../components/Key.tsx';
import { Logo } from '../components/Logo.tsx';
import { Unit } from '../components/Unit.tsx';
import { useFloorStops } from '../model/floor-stops.ts';
import type { ProjectSummary } from '../placeholder.ts';
import { useShellStore } from '../state/shell-store.ts';
import type { ShellActions } from './actions.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { ModelArea } from './ModelArea.tsx';
import { ProjectHeader } from './ProjectHeader.tsx';
import { ViewControls } from './ViewControls.tsx';
import styles from './DesktopShell.module.css';

export interface ShellProps {
  project: ProjectSummary;
  actions: ShellActions;
}

/** Desktop: model on the left with floating units, chat panel on the right. */
export function DesktopShell({ project, actions }: ShellProps) {
  const panel = useShellStore((s) => s.panel);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const floor = useShellStore((s) => s.floor);
  const setFloor = useShellStore((s) => s.setFloor);
  const floors = useFloorStops();
  const zoomPercent = useShellStore((s) => s.zoomPercent);

  return (
    <div className={styles.shell} data-shell="desktop">
      <header className={styles.header}>
        <Logo />
        <div className={styles.units}>
          <Unit role="group" aria-label="File">
            <Key label="Save" icon="save" onClick={actions.onSave} />
            <Key label="Load" icon="load" onClick={actions.onLoad} />
          </Unit>
          <Unit role="group" aria-label="History">
            <Key label="Undo" icon="undo" onClick={actions.onUndo} />
            <Key label="Redo" icon="redo" onClick={actions.onRedo} />
          </Unit>
          <Unit role="group" aria-label="Panels">
            <Key label="Materials" icon="materials" latched={panel === 'materials'} onClick={() => togglePanel('materials')} />
            <Key label="Steps" icon="steps" latched={panel === 'steps'} onClick={() => togglePanel('steps')} />
          </Unit>
        </div>
        <div className={styles.project}>
          <ProjectHeader project={project} variant="desktop" />
        </div>
      </header>
      <main className={styles.model} aria-label="Model">
        <ModelArea zoomPercent={zoomPercent} />
        <div className={styles.floors}>
          <FloorSlider floors={floors} value={floor} onChange={setFloor} />
        </div>
        <div className={styles.views}>
          <ViewControls />
        </div>
      </main>
      <ChatPanel className={styles.chat} />
    </div>
  );
}
