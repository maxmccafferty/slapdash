import styles from './Chat.module.css';

/**
 * The person's words as they're heard: confirmed words in ink, the unconfirmed tail in grey.
 * Not a live region: the "Listening" status announces, and every interim word would be noise.
 */
export function ListeningMessage({ heard, unconfirmed }: { heard: string; unconfirmed: string }) {
  const tail = heard === '' && unconfirmed === '' ? '…' : unconfirmed;
  return (
    <div className={[styles.message, styles.user].join(' ')} data-listening>
      <span className="visually-hidden">You</span>
      <p className={styles.text}>
        {heard}
        {heard !== '' && tail !== '' && ' '}
        {tail !== '' && <span className={styles.unconfirmed}>{tail}</span>}
      </p>
    </div>
  );
}
