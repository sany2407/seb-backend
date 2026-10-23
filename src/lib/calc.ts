/** Pure bill-split logic — MUST stay in sync with frontend src/lib/calc.ts */export interface SplitInput { homeId: string; homeName: string; units: number; }
export interface SplitRow extends SplitInput { percent: number; amount: number; }

export function splitUsageBased(totalBill: number, mainUnits: number, homes: SplitInput[]): { rows: SplitRow[]; commonUnits: number; commonAmount: number } {
  if (mainUnits <= 0) throw new Error("Main consumption must be > 0");
  const sub = homes.reduce((s, h) => s + h.units, 0);
  const commonUnits = mainUnits - sub;
  if (commonUnits < -0.001) throw new Error("Sub-meter total exceeds main meter. Check readings or allow override.");
  const all: SplitInput[] = [...homes, { homeId: "COMMON", homeName: "Common", units: Math.max(0, commonUnits) }];
  const raw = all.map((a) => ({ ...a, exact: (a.units / mainUnits) * totalBill }));
  const rounded: SplitRow[] = raw.map((r) => ({ homeId: r.homeId, homeName: r.homeName, units: r.units, percent: +(r.units / mainUnits * 100).toFixed(2), amount: Math.round(r.exact * 100) / 100 }));
  const diff = Math.round((totalBill - rounded.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  if (diff !== 0) {
    let idx = 0; let m = -1;
    rounded.forEach((r, i) => { if (r.units > m) { m = r.units; idx = i; } });
    rounded[idx].amount = Math.round((rounded[idx].amount + diff) * 100) / 100;
  }
  const common = rounded.find((r) => r.homeId === "COMMON")!;
  return { rows: rounded, commonUnits: Math.max(0, commonUnits), commonAmount: common.amount };
}

export function splitEqual(totalBill: number, homes: { homeId: string; homeName: string }[]): SplitRow[] {
  const n = homes.length;
  if (n === 0) throw new Error("No homes to split between");
  const each = Math.floor((totalBill / n) * 100) / 100;
  const rows = homes.map((h) => ({ ...h, units: 0, percent: +(100 / n).toFixed(2), amount: each }));
  const diff = Math.round((totalBill - each * n) * 100) / 100;
  if (diff !== 0) rows[rows.length - 1].amount = Math.round((rows[rows.length - 1].amount + diff) * 100) / 100;
  const pDiff = Math.round((100 - rows.reduce((s, r) => s + r.percent, 0)) * 100) / 100;
  if (pDiff !== 0) rows[rows.length - 1].percent = Math.round((rows[rows.length - 1].percent + pDiff) * 100) / 100;
  return rows;
}

export function splitPercentage(totalBill: number, homes: { homeId: string; homeName: string; percent: number }[]): SplitRow[] {
  const tot = homes.reduce((s, h) => s + h.percent, 0);
  if (Math.abs(tot - 100) > 0.01) throw new Error(`Percentages must total 100% (now ${tot}%)`);
  const rows: SplitRow[] = homes.map((h) => ({ homeId: h.homeId, homeName: h.homeName, units: 0, percent: h.percent, amount: Math.round(((h.percent / 100) * totalBill) * 100) / 100 }));
  const diff = Math.round((totalBill - rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  if (diff !== 0) rows[rows.length - 1].amount = Math.round((rows[rows.length - 1].amount + diff) * 100) / 100;
  return rows;
}

/**
 * Guarantee rows sum EXACTLY to total (paise-level): round each row to 2dp,
 * then absorb any residual dust (≤ a few paise) into the largest row.
 * Call AFTER rejecting genuinely unbalanced input.
 */
export function exactify(rows: { amount: number }[], total: number) {
  for (const r of rows) r.amount = Math.round(r.amount * 100) / 100;
  const diff = Math.round((total - rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  if (diff !== 0 && rows.length > 0) {
    let idx = 0;
    rows.forEach((r, i) => { if (r.amount > rows[idx].amount) idx = i; });
    rows[idx].amount = Math.round((rows[idx].amount + diff) * 100) / 100;
  }
  return rows;
}
