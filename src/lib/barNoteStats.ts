export type RawBarNoteStatRow = {
  bar_id: string;
  criteria_id: string;
  value_int: number | string | null;
  created_at: string | null;
};

export type LatestBarNoteValue = {
  barId: string;
  criteriaId: string;
  valueInt: number | null;
};

export type BarOverallStat = {
  avg: number | null;
  count: number;
};

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function getLatestBarNoteValues(
  rows: RawBarNoteStatRow[] | null | undefined
): LatestBarNoteValue[] {
  const latestByKey = new Map<string, LatestBarNoteValue>();

  for (const row of rows ?? []) {
    const barId = String(row.bar_id);
    const criteriaId = String(row.criteria_id);
    const key = `${barId}:${criteriaId}`;
    if (latestByKey.has(key)) continue;

    latestByKey.set(key, {
      barId,
      criteriaId,
      valueInt: toNumberOrNull(row.value_int),
    });
  }

  return Array.from(latestByKey.values());
}

export function computeOverallByBar(
  rows: RawBarNoteStatRow[] | null | undefined
): Map<string, BarOverallStat> {
  const totalsByBar = new Map<string, { sum: number; count: number }>();

  for (const row of getLatestBarNoteValues(rows)) {
    if (row.valueInt === null) continue;

    const current = totalsByBar.get(row.barId) ?? { sum: 0, count: 0 };
    current.sum += row.valueInt;
    current.count += 1;
    totalsByBar.set(row.barId, current);
  }

  const overallByBar = new Map<string, BarOverallStat>();
  for (const [barId, total] of totalsByBar) {
    overallByBar.set(barId, {
      avg: total.count > 0 ? total.sum / total.count : null,
      count: total.count,
    });
  }

  return overallByBar;
}

export function computeCriteriaStatsForBar(
  rows: RawBarNoteStatRow[] | null | undefined,
  barId: string
): Array<{ criteria_id: string; avg_value: number | null; notes_count: number }> {
  return getLatestBarNoteValues(rows)
    .filter((row) => row.barId === barId)
    .map((row) => ({
      criteria_id: row.criteriaId,
      avg_value: row.valueInt,
      notes_count: row.valueInt === null ? 0 : 1,
    }));
}
