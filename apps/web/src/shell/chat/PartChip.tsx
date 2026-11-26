import { Key } from '../../components/Key.tsx';
import { Swatch } from '../../components/Swatch.tsx';
import type { PointerChip } from '../../agent/chat-types.ts';
import styles from './Chat.module.css';

/** The part the person tapped: swatch and label. In the composer it has a remove key. */
export function PartChip({ chip, onRemove }: { chip: PointerChip; onRemove?: () => void }) {
  return (
    <span className={[styles.chip, !onRemove && styles['chip-static']].filter(Boolean).join(' ')} data-testid="part-chip">
      {chip.swatch && <Swatch swatch={chip.swatch} />}
      <span className={styles['chip-label']}>{chip.label}</span>
      {onRemove && <Key className={styles['chip-remove']} label={`Remove ${chip.label}`} icon="close" iconOnly onClick={onRemove} />}
    </span>
  );
}
