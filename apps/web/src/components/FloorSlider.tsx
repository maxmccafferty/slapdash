import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { FloorStop } from '../placeholder.ts';
import type { FloorId } from '../state/shell-store.ts';
import { Unit } from './Unit.tsx';
import styles from './FloorSlider.module.css';

export interface FloorSliderProps {
  /** Top to bottom: Roof first, Foundation last. */
  floors: readonly FloorStop[];
  value: FloorId;
  onChange: (floor: FloorId) => void;
}

/**
 * The Floors unit: a vertical slider with an orange knob and three stops. The slider's value
 * counts up from the bottom (Foundation = 0), so ArrowUp moves the knob up.
 */
export function FloorSlider({ floors, value, onChange }: FloorSliderProps) {
  const titleId = useId();
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const max = floors.length - 1;
  const index = Math.max(0, floors.findIndex((f) => f.id === value));
  const current = floors[index]!;

  const selectIndex = (i: number) => {
    const next = floors[Math.min(max, Math.max(0, i))];
    if (next && next.id !== value) onChange(next.id);
  };
  /** Value (bottom-up) to index (top-down) and back. */
  const toValue = (i: number) => max - i;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowRight: index - 1,
      PageUp: index - 1,
      ArrowDown: index + 1,
      ArrowLeft: index + 1,
      PageDown: index + 1,
      Home: max,
      End: 0,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectIndex(target);
  };

  const indexAt = (clientY: number) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return index;
    const row = rect.height / floors.length;
    return Math.round((clientY - rect.top - row / 2) / row);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    selectIndex(indexAt(event.clientY));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) selectIndex(indexAt(event.clientY));
  };
  const endDrag = () => {
    dragging.current = false;
  };

  return (
    <Unit direction="column" radius="panel" className={styles.unit}>
      <span id={titleId} className={styles.title}>
        Floors
      </span>
      <div className={styles.body}>
        <div
          ref={sliderRef}
          className={styles.slider}
          role="slider"
          tabIndex={0}
          aria-labelledby={titleId}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={toValue(index)}
          aria-valuetext={`${current.label}, ${current.height}`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className={styles.knob} style={{ '--stop': index } as CSSProperties} aria-hidden="true" />
        </div>
        {floors.map((floor, i) => (
          <button
            key={floor.id}
            type="button"
            tabIndex={-1}
            className={[styles.stop, i === index && styles.current].filter(Boolean).join(' ')}
            style={{ gridRow: i + 1 }}
            onClick={() => selectIndex(i)}
          >
            <span>{floor.label}</span>
            <span className={styles.height}>{floor.height}</span>
          </button>
        ))}
      </div>
    </Unit>
  );
}
