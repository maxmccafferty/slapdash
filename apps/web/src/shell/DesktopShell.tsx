import { useRef } from 'react';
import { FloorSlider } from '../components/FloorSlider.tsx';
import { Key } from '../components/Key.tsx';
import { Logo } from '../components/Logo.tsx';
import { Unit } from '../components/Unit.tsx';
import { MaterialsPanel } from '../materials/MaterialsPanel.tsx';
import { useFloorStops } from '../model/floor-stops.ts';
import type { ProjectSummary } from '../placeholder.ts';
import { ProjectsPanel } from '../projects/ProjectsPanel.tsx';
import { useShellStore } from '../state/shell-store.ts';
import { BuildStepsPanel } from '../steps/BuildStepsPanel.tsx';
import type { ShellActions } from './actions.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { ModelArea } from './ModelArea.tsx';
import { ProjectHeader } from './ProjectHeader.tsx';
import { StressLegend } from './StressLegend.tsx';
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
  const materialsRef = useRef<HTMLButtonElement>(null);
  const stepsRef = useRef<HTMLButtonElement>(null);
  const loadRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={styles.shell} data-shell="desktop">
      <header className={styles.header}>
        <Logo />
        <div className={styles.units}>
          <Unit role="group" aria-label="File">
            <Key label="Save" icon="save" onClick={actions.onSave} />
            <Key ref={loadRef} label="Load" icon="load" latched={panel === 'projects'} onClick={actions.onLoad} />
          </Unit>
          <Unit role="group" aria-label="History">
            <Key label="Undo" icon="undo" onClick={actions.onUndo} />
            <Key label="Redo" icon="redo" onClick={actions.onRedo} />
          </Unit>
          <Unit role="group" aria-label="Panels">
            <Key
              ref={materialsRef}
              label="Materials"
              icon="materials"
              latched={panel === 'materials'}
              onClick={() => togglePanel('materials')}
            />
            <Key ref={stepsRef} label="Steps" icon="steps" latched={panel === 'steps'} onClick={() => togglePanel('steps')} />
          </Unit>
        </div>
        <div className={styles.project}>
          <ProjectHeader project={project} variant="desktop" />
        </div>
      </header>
      {/* Modals (Materials, Steps, Projects) render inside <main> and cover the model only. The
          chat is a grid sibling and must stay usable: never make it or the app root inert. */}
      <main className={styles.model} aria-label="Model">
        <ModelArea zoomPercent={zoomPercent} />
        <div className={styles.floors}>
          <FloorSlider floors={floors} value={floor} onChange={setFloor} />
        </div>
        <div className={styles.views}>
          <StressLegend />
          <ViewControls />
        </div>
        {panel === 'materials' && <MaterialsPanel variant="desktop" triggerRef={materialsRef} />}
        {panel === 'steps' && <BuildStepsPanel variant="desktop" triggerRef={stepsRef} />}
        {panel === 'projects' && <ProjectsPanel variant="desktop" triggerRef={loadRef} />}
      </main>
      <ChatPanel className={styles.chat} />
    </div>
  );
}
