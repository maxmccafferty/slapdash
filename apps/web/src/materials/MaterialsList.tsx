import type { MaterialsReport, MaterialsRow } from '@slapdash/core';
import { Swatch } from '../components/Swatch.tsx';
import { NO_PRICE, formatAmount, formatCost, formatTotal, rowLabel } from './format.ts';
import styles from './MaterialsPanel.module.css';

function Row({ row }: { row: MaterialsRow }) {
  const { name, detail } = rowLabel(row);
  return (
    <tr data-row={row.id}>
      <th scope="row" className={styles.item}>
        <span className={styles.cell}>
        {row.swatch ? <Swatch swatch={row.swatch} /> : <span className={styles['no-swatch']} aria-hidden="true" data-testid="swatch" />}
        <span className={styles.name}>
          {name}
          {detail && <span className={styles.detail}> {detail}</span>}
        </span>
        </span>
      </th>
      <td className={styles.amount}>{formatAmount(row)}</td>
      <td className={styles.cost}>
        {row.cost ? (
          <>
            {row.cost.user && <span className={styles['user-dot']} data-user-price="" title="Your price" aria-label="Your price" role="img" />}
            {formatCost(row.cost)}
          </>
        ) : (
          <span className={styles.muted} title={row.noPriceReason}>
            {NO_PRICE}
          </span>
        )}
      </td>
    </tr>
  );
}

/** The Materials tab: one table per build step, then the Total row. */
export function MaterialsList({ report }: { report: MaterialsReport }) {
  return (
    <div className={styles.list}>
      {report.groups.map((group) => (
        <table key={group.step} className={styles.table} data-group={group.step}>
          <caption className={styles.caption}>{group.title}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.item}>
                <span className="visually-hidden">Item</span>
              </th>
              <th scope="col" className={styles.amount}>
                Amount
              </th>
              <th scope="col" className={styles.cost}>
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      ))}
      <div className={styles['total-row']} data-testid="materials-total">
        <span>Total</span>
        <span>{formatTotal(report.totals)}</span>
      </div>
    </div>
  );
}
