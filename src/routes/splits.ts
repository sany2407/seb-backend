import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";
import { splitUsageBased, splitEqual, splitPercentage, exactify } from "../lib/calc";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /api/splits/compute:
 *   post:
 *     tags: [Splits]
 *     summary: Preview a split (no DB writes)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [totalBill, mainUnits, method, homes]
 *             properties:
 *               totalBill: { type: number }
 *               mainUnits: { type: number }
 *               method: { type: string, enum: [usage, equal, percentage] }
 *               homes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     homeId: { type: string }
 *                     homeName: { type: string }
 *                     units: { type: number }
 *                     percent: { type: number }
 *     responses:
 *       200:
 *         description: Rows + common share
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows: { type: array, items: { $ref: '#/components/schemas/BillSplit' } }
 *                 commonUnits: { type: number }
 *                 commonAmount: { type: number }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/compute", asyncHandler(async (req, res) => {
  const schema = z.object({
    totalBill: z.number().positive(),
    mainUnits: z.number().positive(),
    method: z.enum(["usage", "equal", "percentage"]),
    homes: z.array(z.object({
      homeId: z.string().min(1),
      homeName: z.string().min(1),
      units: z.number().nonnegative().optional().default(0),
      percent: z.number().nonnegative().optional().default(0),
    })).min(1),
  });
  const b = schema.parse(req.body);
  try {
    const out = b.method === "equal"
      ? { rows: splitEqual(b.totalBill, b.homes), commonUnits: 0, commonAmount: 0 }
      : b.method === "percentage"
        ? { rows: splitPercentage(b.totalBill, b.homes.map((h) => ({ homeId: h.homeId, homeName: h.homeName, percent: h.percent ?? 0 }))), commonUnits: 0, commonAmount: 0 }
        : splitUsageBased(b.totalBill, b.mainUnits, b.homes.map((h) => ({ homeId: h.homeId, homeName: h.homeName, units: h.units ?? 0 })));
    res.json(out);
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { status: 400 });
  }
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** FK-safe: only real home UUIDs are stored; anything else becomes the COMMON (null) row. */
const toHomeId = (id: string) => (id === "COMMON" || !UUID_RE.test(id) ? null : id);

function key(year: string, month: string) {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
    throw Object.assign(new Error("Use /api/splits/YYYY/MM"), { status: 400 });
  }
  return `${year}-${month}`;
}

/**
 * @openapi
 * /api/splits/{year}/{month}:
 *   get:
 *     tags: [Splits]
 *     summary: Load saved split for a month/year
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: string, example: "2026" }
 *       - in: path
 *         name: month
 *         required: true
 *         schema: { type: string, example: "10" }
 *     responses:
 *       200:
 *         description: Saved flag + bill/splits when present
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 saved: { type: boolean }
 *                 monthKey: { type: string }
 *                 bill: { $ref: '#/components/schemas/Bill' }
 *                 splits: { type: array, items: { $ref: '#/components/schemas/BillSplit' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/:year/:month", asyncHandler(async (req, res) => {
  const monthKey = key(req.params.year, req.params.month);
  const { data: bill } = await db().from("eb_bills").select("*").eq("month_key", monthKey).eq("owner_id", uid(req)).maybeSingle();
  if (!bill) return res.json({ saved: false, monthKey });
  const { data: splits } = await db().from("bill_splits").select("*").eq("bill_id", bill.id);
  res.json({ saved: true, monthKey, bill, splits: splits ?? [] });
}));

const saveSchema = z.object({
  month: z.string().min(1),
  totalBill: z.number().positive(),
  mainUnits: z.number().nonnegative(),
  mainPrev: z.number().nonnegative().optional(),
  mainCurr: z.number().nonnegative().optional(),
  method: z.enum(["usage", "equal", "percentage"]),
  rows: z.array(z.object({
    homeId: z.string().min(1),
    homeName: z.string().min(1),
    units: z.number().nonnegative(),
    percent: z.number().nonnegative(),
    amount: z.number().nonnegative(),
  })).min(1),
  commonUnits: z.number().nonnegative().default(0),
  commonAmount: z.number().nonnegative().default(0),
  unitPrice: z.number().nonnegative().optional(),
});

/**
 * @openapi
 * /api/splits/{year}/{month}:
 *   put:
 *     tags: [Splits]
 *     summary: Save (upsert) split for a month/year
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: string, example: "2026" }
 *       - in: path
 *         name: month
 *         required: true
 *         schema: { type: string, example: "10" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [month, totalBill, mainUnits, method, rows]
 *             properties:
 *               month: { type: string, example: "Oct 2026" }
 *               totalBill: { type: number }
 *               mainUnits: { type: number }
 *               mainPrev: { type: number }
 *               mainCurr: { type: number }
 *               method: { type: string, enum: [usage, equal, percentage] }
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     homeId: { type: string }
 *                     homeName: { type: string }
 *                     units: { type: number }
 *                     percent: { type: number }
 *                     amount: { type: number }
 *               commonUnits: { type: number }
 *               commonAmount: { type: number }
 *     responses:
 *       200:
 *         description: Saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 saved: { type: boolean }
 *                 monthKey: { type: string }
 *                 billId: { type: string, format: uuid }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put("/:year/:month", validate(saveSchema), asyncHandler(async (req, res) => {
  const monthKey = key(req.params.year, req.params.month);
  const b = req.body as z.infer<typeof saveSchema>;
  const rowSum = b.rows.reduce((s, r) => s + r.amount, 0);
  if (Math.abs(rowSum - b.totalBill) > 0.02) {
    throw Object.assign(new Error(`Split amounts must add up to the bill (off by ₹${(b.totalBill - rowSum).toFixed(2)})`), { status: 400 });
  }
  exactify(b.rows, b.totalBill);
  const d = db();
  const { data: existing } = await d.from("eb_bills").select("id").eq("month_key", monthKey).eq("owner_id", uid(req)).maybeSingle();

  let billId = existing?.id as string | undefined;
  if (billId) {
    const { error } = await d.from("eb_bills").update({
      month: b.month, amount: b.totalBill, main_units: b.mainUnits,
      main_prev: b.mainPrev ?? null, main_curr: b.mainCurr ?? null,
      method: b.method, common_units: b.commonUnits, common_amount: b.commonAmount,
      ...(b.unitPrice !== undefined ? { unit_price: b.unitPrice } : {}),
    }).eq("id", billId);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    await d.from("bill_splits").delete().eq("bill_id", billId);
  } else {
    const { data, error } = await d.from("eb_bills").insert({
      owner_id: uid(req), month_key: monthKey, month: b.month, bill_no: `EB-${monthKey}`,
      main_prev: b.mainPrev ?? 0, main_curr: b.mainCurr ?? b.mainUnits,
      main_units: b.mainUnits, amount: b.totalBill,
      status: "Pending", method: b.method,
      common_units: b.commonUnits, common_amount: b.commonAmount,
      unit_price: b.unitPrice ?? 0,
    }).select("id").single();
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    billId = data.id;
  }

  const { error: sErr } = await d.from("bill_splits").insert(
    b.rows.map((r) => ({
      bill_id: billId, home_id: toHomeId(r.homeId),
      home_name: r.homeName, units: r.units, percent: r.percent, amount: r.amount,
    }))
  );
  if (sErr) throw Object.assign(new Error(sErr.message), { status: 500 });
  res.json({ saved: true, monthKey, billId });
}));

export default router;
