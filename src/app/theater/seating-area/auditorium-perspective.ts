export interface AuditoriumRowPerspective {
  readonly transform: string;
  readonly aisleWidth: string;
  readonly flexGrow: number;
}

const DISTANT_ROW_SCALE = 0.9;
const NEAR_ROW_SCALE = 1;
const DISTANT_AISLE_PERCENT = 7;
const NEAR_AISLE_PERCENT = 10;
const DISTANT_ROW_GROWTH = 0.84;
const NEAR_ROW_GROWTH = 1.16;

/**
 * A restrained forced-perspective projection for the auditorium.
 *
 * Row zero sits beside the screen and is therefore the most distant row.
 * The final row sits nearest the viewer. Keeping this calculation shared
 * ensures the independently rendered chairs and patrons remain registered.
 */
export function auditoriumRowPerspective(rowIndex: number, totalRows: number): AuditoriumRowPerspective {
  const rowCount = Math.max(1, totalRows);
  const finalRowIndex = Math.max(1, rowCount - 1);
  const depth = Math.min(1, Math.max(0, rowIndex / finalRowIndex));

  const scale = interpolate(DISTANT_ROW_SCALE, NEAR_ROW_SCALE, depth);
  const aislePercent = interpolate(DISTANT_AISLE_PERCENT, NEAR_AISLE_PERCENT, depth);
  const flexGrow = interpolate(DISTANT_ROW_GROWTH, NEAR_ROW_GROWTH, depth);

  return {
    transform: `scale(${scale.toFixed(3)})`,
    aisleWidth: `${aislePercent.toFixed(2)}%`,
    flexGrow: Number(flexGrow.toFixed(3)),
  };
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
