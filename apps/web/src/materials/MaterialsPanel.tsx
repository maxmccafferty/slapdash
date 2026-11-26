import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Key } from '../components/Key.tsx';
import { ViewControl } from '../components/ViewControl.tsx';
import { useDismiss } from '../hooks/useDismiss.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore, type MaterialsTab } from '../state/shell-store.ts';
import { CutList } from './CutList.tsx';
import { EMPTY_MATERIALS, formatTotal, priceDateNote, unpricedNote } from './format.ts';
import { MaterialsList } from './MaterialsList.tsx';
import { useMaterials } from './useMaterials.ts';
import styles from './MaterialsPanel.module.css';

const TABS = [
  { value: 'materials', label: 'Materials' },
  { value: 'cutlist', label: 'Cut list' },
] as const;

export interface MaterialsPanelProps {
  variant: 'desktop' | 'phone';
  /** The Materials key: Escape and Close return focus to it. */
  triggerRef: RefObject<HTMLElement | null>;
}

/**
 * The Materials modal (ADR-0003 §F): the materials list and the cut list in two tabs, the
 * total as a dated range, and Export PDF. It covers the model area only and is not modal
 * to the rest of the app: the chat stays usable beside it (desktop) or over it (phone).
 */
export function MaterialsPanel({ variant, triggerRef }: MaterialsPanelProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const report = useMaterials();
  const tab = useShellStore((s) => s.materialsTab);
  const setTab = useShellStore((s) => s.setMaterialsTab);
  const closePanel = useShellStore((s) => s.closePanel);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useDismiss(true, ref, triggerRef, closePanel, { outside: false });
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const close = () => {
    closePanel();
    triggerRef.current?.focus();
  };

  const onExport = useCallback(async () => {
    const { project, catalog } = useModelStore.getState();
    if (!project || !catalog) return;
    setExporting(true);
    setExportError(null);
    try {
      const { exportProjectPdf } = await import('../export/export-pdf.ts');
      await exportProjectPdf(project, catalog);
    } catch {
      setExportError("Couldn't make the PDF. Try again.");
    } finally {
      setExporting(false);
    }
  }, []);

  const empty = !report || report.isEmpty;
  const note = report && !empty ? unpricedNote(report.totals) : null;

  return (
    <section
      ref={ref}
      className={[styles.panel, styles[variant]].join(' ')}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-variant={variant}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          Materials
        </h2>
        <div className={styles.tabs}>
          <ViewControl<MaterialsTab> title="Show" hideTitle options={TABS} value={tab} onChange={setTab} disabled={empty} />
        </div>
        <Key className={styles.close} label="Close materials" icon="close" iconSize={variant === 'phone' ? 'phone' : 'key'} iconOnly onClick={close} />
      </header>

      {report && !empty && (
        <p className={styles.total} data-testid="materials-range">
          <span className={styles['total-value']}>{formatTotal(report.totals)}</span>
          {note && <span className={styles.muted}> · {note}</span>}
        </p>
      )}

      {/* Focusable so keyboard users can scroll a long list. */}
      <div className={styles.body} tabIndex={0} role="region" aria-label={tab === 'materials' ? 'Materials list' : 'Cut list'}>
        {empty || !report ? (
          <p className={styles.empty}>{EMPTY_MATERIALS}</p>
        ) : tab === 'materials' ? (
          <MaterialsList report={report} />
        ) : (
          <CutList report={report} />
        )}
      </div>

      <footer className={styles.footer}>
        <Key label={exporting ? 'Exporting…' : 'Export PDF'} icon="pdf" disabled={empty || exporting} onClick={onExport} />
        <p className={styles.caveat}>{report ? priceDateNote(report.totals) : null}</p>
        {exportError && (
          <p className={styles.error} role="status">
            {exportError}
          </p>
        )}
      </footer>
    </section>
  );
}
