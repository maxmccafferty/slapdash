import { useId } from 'react';
import { Unit } from './Unit.tsx';
import styles from './ViewControl.module.css';

export interface ViewOption<T extends string> {
  value: T;
  label: string;
}

export interface ViewControlProps<T extends string> {
  title: string;
  options: readonly [ViewOption<T>, ViewOption<T>];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A title over a two-option track. Native radios give the radiogroup semantics and arrow-key
 * behaviour; the chosen option is a raised white piece with an orange dot.
 */
export function ViewControl<T extends string>({ title, options, value, onChange, disabled = false }: ViewControlProps<T>) {
  const name = useId();
  const second = value === options[1].value;
  return (
    <Unit className={[styles.unit, disabled && styles.disabled].filter(Boolean).join(' ')}>
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.title}>{title}</legend>
        <div className={[styles.track, second && styles.second].filter(Boolean).join(' ')}>
          <span className={styles.piece} aria-hidden="true" />
          {options.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                className="visually-hidden"
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    </Unit>
  );
}
