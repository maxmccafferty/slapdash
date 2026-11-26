import { ViewControl } from '../components/ViewControl.tsx';
import { useShellStore } from '../state/shell-store.ts';
import styles from './ViewControls.module.css';

const ON_OFF = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

/** The four view controls, one unit each. Look from and Stress are disabled in 2D. */
export function ViewControls({ layout = 'row' }: { layout?: 'row' | 'column' }) {
  const s = useShellStore();
  const is2d = s.view === '2d';
  return (
    <div className={[styles.controls, layout === 'column' && styles.column].filter(Boolean).join(' ')}>
      <ViewControl
        title="View"
        options={[
          { value: '3d', label: '3D' },
          { value: '2d', label: '2D' },
        ]}
        value={s.view}
        onChange={s.setView}
      />
      <ViewControl
        title="Look from"
        options={[
          { value: 'outside', label: 'Outside' },
          { value: 'inside', label: 'Inside' },
        ]}
        value={s.lookFrom}
        onChange={s.setLookFrom}
        disabled={is2d}
      />
      <ViewControl
        title="Dimensions"
        options={ON_OFF}
        value={s.dimensions ? 'on' : 'off'}
        onChange={(v) => s.setDimensions(v === 'on')}
      />
      <ViewControl
        title="Stress"
        options={ON_OFF}
        value={s.stress ? 'on' : 'off'}
        onChange={(v) => s.setStress(v === 'on')}
        disabled={is2d}
      />
    </div>
  );
}
