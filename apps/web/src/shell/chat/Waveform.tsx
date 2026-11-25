import styles from './Chat.module.css';

const BARS = [0, 1, 2, 3, 4];

/**
 * Where the field was while Talk is held: orange bars and "Listening". The bars are a cue, not a
 * level meter: reading levels needs `getUserMedia`, which fights recognition for the mic on iOS.
 */
export function Waveform() {
  return (
    <div className={styles.listening} role="status" data-testid="listening">
      <span className={styles.wave} aria-hidden="true">
        {BARS.map((n) => (
          <span key={n} className={styles.bar} />
        ))}
      </span>
      <span>Listening</span>
    </div>
  );
}
