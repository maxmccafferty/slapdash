import { useEffect, useId, useRef, type RefObject } from 'react';
import { BottomSheet } from '../components/BottomSheet.tsx';
import { Key } from '../components/Key.tsx';
import { useDismiss } from '../hooks/useDismiss.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { STEP_HOW_TO, stepFacts } from './how-to.ts';
import { useBuildSteps } from './useBuildSteps.ts';
import styles from './BuildStepsPanel.module.css';

export const NOTHING_TO_BUILD = 'Nothing to build yet. Ask Claude for a slab, walls or a roof.';
export const STEPS_SHEET_ID = 'phone-steps-sheet';

/** The step, how to do it, the list of steps and Back / Next step. */
function StepsContent({ titleId }: { titleId?: string }) {
  const { groups, index, current } = useBuildSteps();
  const project = useModelStore((s) => s.project);
  const setStepIndex = useShellStore((s) => s.setStepIndex);
  const nextStep = useShellStore((s) => s.nextStep);
  const prevStep = useShellStore((s) => s.prevStep);

  if (!current || !project) {
    return (
      <div className={styles.content}>
        <p className={styles.muted}>{NOTHING_TO_BUILD}</p>
        <div className={styles.keys}>
          <Key label="Back" icon="back" disabled />
          <Key label="Next step" icon="next" disabled />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.content}>
      <div className={styles.lead} aria-live="polite">
        <p className={styles.eyebrow}>
          Step {index + 1} of {groups.length}
        </p>
        <h3 id={titleId} className={styles.step}>
          {current.title}
        </h3>
      </div>
      <p className={styles.how}>{STEP_HOW_TO[current.step]}</p>
      <p className={styles.facts}>{stepFacts(project, current)}</p>
      <ol className={styles.list} aria-label="All steps">
        {groups.map((g, i) => (
          <li key={g.step}>
            <button
              type="button"
              className={[styles['list-item'], i === index && styles.here].filter(Boolean).join(' ')}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => setStepIndex(i)}
            >
              <span className={styles.dot} aria-hidden="true" />
              {i + 1}. {g.title}
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.keys}>
        <Key label="Back" icon="back" disabled={index === 0} onClick={prevStep} />
        <Key label="Next step" icon="next" tone="dark" disabled={index >= groups.length - 1} onClick={() => nextStep(groups.length)} />
      </div>
    </div>
  );
}

export interface BuildStepsPanelProps {
  variant: 'desktop' | 'phone';
  /** The Steps key: Escape and Close return focus to it. */
  triggerRef: RefObject<HTMLElement | null>;
}

/**
 * Build steps (ADR-0003 §E): play the build one step at a time. The model shows the build
 * up to the current step (see `renderer/visibility.ts`); the camera doesn't move. Desktop:
 * a panel over the model's corner, so the build stays in view. Phone: a bottom sheet.
 */
export function BuildStepsPanel({ variant, triggerRef }: BuildStepsPanelProps) {
  const closePanel = useShellStore((s) => s.closePanel);
  if (variant === 'phone') {
    return (
      <BottomSheet id={STEPS_SHEET_ID} title="Build steps" open onClose={closePanel} triggerRef={triggerRef} className={styles['steps-sheet']}>
        <StepsContent />
      </BottomSheet>
    );
  }
  return <DesktopSteps triggerRef={triggerRef} />;
}

function DesktopSteps({ triggerRef }: { triggerRef: RefObject<HTMLElement | null> }) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const closePanel = useShellStore((s) => s.closePanel);
  useDismiss(true, ref, triggerRef, closePanel, { outside: false });
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const close = () => {
    closePanel();
    triggerRef.current?.focus();
  };
  return (
    <section ref={ref} className={styles.panel} role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1} data-variant="desktop">
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          Build steps
        </h2>
        <Key className={styles.close} label="Close build steps" icon="close" iconOnly onClick={close} />
      </header>
      <StepsContent />
    </section>
  );
}
