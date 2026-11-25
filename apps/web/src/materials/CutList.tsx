import type { MaterialsReport } from '@slapdash/core';
import { Swatch } from '../components/Swatch.tsx';
import { boardCount, boardTitle, formatCutLength } from './format.ts';
import styles from './MaterialsPanel.module.css';

/** The Cut list tab: one table per stock board, each row a piece length and how many. */
export function CutList({ report }: { report: MaterialsReport }) {
  if (report.cutList.length === 0) {
    return <p className={styles.empty}>Nothing to cut: no lumber is sold in board lengths here.</p>;
  }
  return (
    <div className={styles.list}>
      {report.cutList.map((group) => (
        <table key={group.id} className={styles.table} data-board={group.id}>
          <caption className={styles.caption}>
            <span className={styles['board-title']}>
              {boardTitle(group)} <span className={styles.muted}>— {boardCount(group.boards)}</span>
            </span>
            <span className={styles['board-material']}>
              {group.swatch && <Swatch swatch={group.swatch} />}
              {group.materialName}
            </span>
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.item}>
                Piece
              </th>
              <th scope="col" className={styles.amount}>
                Count
              </th>
            </tr>
          </thead>
          <tbody>
            {group.pieces.map((row) => (
              <tr key={`${row.length_mm}|${row.spliced}`}>
                <th scope="row" className={styles.item}>
                  {formatCutLength(row.length_mm)}
                  {row.spliced && <span className={styles.detail}> (spliced)</span>}
                </th>
                <td className={styles.amount}>× {row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
