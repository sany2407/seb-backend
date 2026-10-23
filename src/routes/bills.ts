import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";
import { splitUsageBased, splitEqual, splitPercentage, exactify } from "../lib/calc";

const router = Router();
router.use(requireAuth);

const subReading = z.object({
  homeId: z.string().min(1),
  homeName: z.string().min(1),
  prev: z.number().nonnegative(),
  curr: z.number().nonnegative(),
});

const billSchema = z.object({
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
  month: z.string().min(1),
  billNo: z.string().optional(),
  mainPrev: z.number().nonnegative(),
  mainCurr: z.number().nonnegative(),
  amount: z.number().positive("Bill amount must be > 0"),
  billDate: z.string().optional(),
  dueDate: z.string().optional(),
  method: z.enum(["usage", "equal", "percentage"]).default("usage"),
  percentages: z.record(z.string(), z.number()).optional(),
  readings: z.array(subReading).min(1),
  notes: z.string().optional().default(""),
  periodStart: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  unitPrice: z.number().nonnegative().optional().default(0),
  finalRows: z.array(z.object({
    homeId: z.string().min(1),
    amount: z.number().nonnegative(),
  })).optional(),
}).refine((v) => v.mainCurr >= v.mainPrev, { message: "mainCurr must be >= mainPrev", path: ["mainCurr"] });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** FK-safe: only real home UUIDs are stored; anything else becomes the COMMON (null) row. */
const toHomeId = (id: string) => (id === "COMMON" || !UUID_RE.test(id) ? null : id);

function compute(method: string, amount: number, mainUnits: number, readings: z.infer<typeof subReading>[], percentages?: Record<string, number>) {  if (method === "equal") {
    return { rows: splitEqual(amount, readings), commonUnits: 0, commonAmount: 0 };
  }
  if (method === "percentage") {
    const pct = readings.map((r) => ({ homeId: r.homeId, homeName: r.homeName, percent: percentages?.[r.homeId] ?? 0 }));
    return { rows: splitPercentage(amount, pct), commonUnits: 0, commonAmount: 0 };
  }
  return splitUsageBased(amount, mainUnits, readings.map((r) => ({ homeId: r.homeId, homeName: r.homeName, units: r.curr - r.prev })));
}

/**
 * @openapi
 * /api/bills:
 *   get:
 *     tags: [Bills]
 *     summary: List my bills
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Pending, Paid, Partial, Overdue] }
 *     responses:
 *       200:
 *         description: Bills
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bills: { type: array, items: { $ref: '#/components/schemas/Bill' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", asyncHandler(async (req, res) => {
  let q = db().from("eb_bills").select("*").eq("owner_id", uid(req)).order("month_key", { ascending: false });
  if (typeof req.query.status === "string") q = q.eq("status", req.query.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  res.json({ bills: data });
}));

/**
 * @openapi
 * /api/bills/{id}:
 *   get:
 *     tags: [Bills]
 *     summary: Bill detail with splits, payments, attachments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bill: { $ref: '#/components/schemas/Bill' }
 *                 splits: { type: array, items: { $ref: '#/components/schemas/BillSplit' } }
 *                 payments: { type: array, items: { $ref: '#/components/schemas/Payment' } }
 *                 attachments: { type: array, items: { $ref: '#/components/schemas/Attachment' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get("/:id", asyncHandler(async (req, res) => {
  const d = db();
  const { data: bill } = await d.from("eb_bills").select("*").eq("id", req.params.id).eq("owner_id", uid(req)).maybeSingle();
  if (!bill) throw Object.assign(new Error("Bill not found"), { status: 404 });
  const [{ data: splits }, { data: payments }, { data: attachments }] = await Promise.all([
    d.from("bill_splits").select("*").eq("bill_id", bill.id),
    d.from("payments").select("*").eq("bill_id", bill.id).order("paid_at"),
    d.from("attachments").select("*").eq("owner_type", "EB_BILL").eq("owner_id", bill.id),
  ]);
  res.json({ bill, splits: splits ?? [], payments: payments ?? [], attachments: attachments ?? [] });
}));

/**
 * @openapi
 * /api/bills:
 *   post:
 *     tags: [Bills]
 *     summary: Create a bill (split computed server-side)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monthKey, month, mainPrev, mainCurr, amount, readings]
 *             properties:
 *               monthKey: { type: string, example: "2026-11" }
 *               month: { type: string, example: "Nov 2026" }
 *               billNo: { type: string }
 *               mainPrev: { type: number }
 *               mainCurr: { type: number }
 *               amount: { type: number }
 *               billDate: { type: string, format: date }
 *               dueDate: { type: string, format: date }
 *               method: { type: string, enum: [usage, equal, percentage] }
 *               percentages: { type: object, additionalProperties: { type: number } }
 *               periodStart: { type: string, example: "2026-08" }
 *               periodEnd: { type: string, example: "2026-09" }
 *               unitPrice: { type: number, description: "₹/unit snapshot; amount is still entered directly" }
 *               finalRows:
 *                 type: array
 *                 description: Manual amount overrides; must sum exactly to amount
 *                 items:
 *                   type: object
 *                   properties:
 *                     homeId: { type: string }
 *                     amount: { type: number }
 *               readings:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     homeId: { type: string }
 *                     homeName: { type: string }
 *                     prev: { type: number }
 *                     curr: { type: number }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Created with splits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bill: { $ref: '#/components/schemas/Bill' }
 *                 splits: { type: array, items: { $ref: '#/components/schemas/BillSplit' } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/", validate(billSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof billSchema>;
  for (const r of b.readings) {
    if (r.curr < r.prev) throw Object.assign(new Error(`${r.homeName}: curr < prev`), { status: 400 });
  }
  const mainUnits = b.mainCurr - b.mainPrev;
  let computed;
  try {
    computed = compute(b.method, b.amount, mainUnits, b.readings, b.percentages);
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { status: 400 });
  }
  const d = db();
  // Manual amount overrides: units/percent stay computed, amounts are taken as given
  // but must add up exactly to the bill.
  if (b.finalRows && b.finalRows.length > 0) {
    const byId = Object.fromEntries(b.finalRows.map((r) => [r.homeId, r.amount]));
    for (const r of computed.rows) {
      if (byId[r.homeId] !== undefined) r.amount = Math.round(byId[r.homeId] * 100) / 100;
    }
    const sum = computed.rows.reduce((s, r) => s + r.amount, 0);
    if (Math.abs(sum - b.amount) > 0.02) {
      throw Object.assign(new Error(`Split amounts must add up to the bill (off by ₹${(b.amount - sum).toFixed(2)})`), { status: 400 });
    }
    exactify(computed.rows, b.amount);
  }
  const { data: bill, error } = await d.from("eb_bills").insert({
    owner_id: uid(req), month_key: b.monthKey, month: b.month,
    bill_no: b.billNo ?? `EB-${b.monthKey}`,
    main_prev: b.mainPrev, main_curr: b.mainCurr, main_units: mainUnits,
    amount: b.amount, bill_date: b.billDate ?? null, due_date: b.dueDate ?? null,
    status: "Pending", method: b.method,
    common_units: computed.commonUnits, common_amount: computed.commonAmount,
    notes: b.notes,
    period_start: b.periodStart ?? b.monthKey, period_end: b.periodEnd ?? b.monthKey,
    unit_price: b.unitPrice ?? 0,
  }).select().single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });

  const { error: sErr } = await d.from("bill_splits").insert(
    computed.rows.map((r) => ({
      bill_id: bill.id, home_id: toHomeId(r.homeId),
      home_name: r.homeName, units: r.units, percent: r.percent, amount: r.amount,
    }))
  );
  if (sErr) throw Object.assign(new Error(sErr.message), { status: 500 });
  const { data: splits } = await d.from("bill_splits").select("*").eq("bill_id", bill.id);

  // Snapshot sub-meter readings so /readings + home history fill up automatically.
  const { data: userMeters } = await d.from("meters").select("id, home_id").eq("owner_id", uid(req));
  const meterByHome = Object.fromEntries((userMeters ?? []).map((m) => [m.home_id, m.id]));
  const snaps = b.readings
    .filter((r) => meterByHome[r.homeId])
    .map((r) => ({
      owner_id: uid(req), meter_id: meterByHome[r.homeId], home_id: r.homeId,
      month_key: b.monthKey, month: b.month, prev: r.prev, curr: r.curr,
      units: Math.round((r.curr - r.prev) * 100) / 100, meter_reset: false, notes: "",
    }));
  if (snaps.length > 0) await d.from("meter_readings").upsert(snaps, { onConflict: "meter_id,month_key" });

  res.status(201).json({ bill, splits: splits ?? [] });
}));

/**
 * @openapi
 * /api/bills/{id}:
 *   patch:
 *     tags: [Bills]
 *     summary: Update bill status / payment fields
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [Pending, Paid, Partial, Overdue] }
 *               paid: { type: number }
 *               paymentMethod: { type: string }
 *               paymentDate: { type: string, format: date }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bill: { $ref: '#/components/schemas/Bill' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch("/:id", asyncHandler(async (req, res) => {
  const allowed = ["status", "paid", "paymentMethod", "paymentDate", "notes", "billNo", "billDate", "dueDate"];
  const map: Record<string, string> = { paymentMethod: "payment_method", paymentDate: "payment_date", billNo: "bill_no", billDate: "bill_date", dueDate: "due_date" };
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[map[k] ?? k] = req.body[k];
  const { data, error } = await db().from("eb_bills").update(patch).eq("id", req.params.id).eq("owner_id", uid(req)).select().maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  if (!data) throw Object.assign(new Error("Bill not found"), { status: 404 });
  res.json({ bill: data });
}));

export default router;
