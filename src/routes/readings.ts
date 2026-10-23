import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const readingSchema = z.object({
  meterId: z.string().uuid(),
  homeId: z.string().uuid().nullable().optional(),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/, "monthKey must be YYYY-MM"),
  month: z.string().min(1),
  prev: z.number().nonnegative(),
  curr: z.number().nonnegative(),
  meterReset: z.boolean().optional().default(false),
  notes: z.string().optional().default(""),
}).refine((v) => v.meterReset || v.curr >= v.prev, {
  message: "curr must be >= prev unless meterReset is true",
  path: ["curr"],
});

/**
 * @openapi
 * /api/readings:
 *   get:
 *     tags: [Readings]
 *     summary: List my readings
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: monthKey
 *         schema: { type: string, example: "2026-10" }
 *       - in: query
 *         name: homeId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Readings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 readings: { type: array, items: { $ref: '#/components/schemas/Reading' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", asyncHandler(async (req, res) => {
  let q = db().from("meter_readings").select("*").eq("owner_id", uid(req)).order("month_key", { ascending: false });
  if (typeof req.query.monthKey === "string") q = q.eq("month_key", req.query.monthKey);
  if (typeof req.query.homeId === "string") q = q.eq("home_id", req.query.homeId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  res.json({ readings: data });
}));

/**
 * @openapi
 * /api/readings:
 *   post:
 *     tags: [Readings]
 *     summary: Add/overwrite a monthly reading (one per meter per month)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [meterId, monthKey, month, prev, curr]
 *             properties:
 *               meterId: { type: string, format: uuid }
 *               homeId: { type: string, format: uuid, nullable: true }
 *               monthKey: { type: string, example: "2026-10" }
 *               month: { type: string, example: "Oct 2026" }
 *               prev: { type: number }
 *               curr: { type: number }
 *               meterReset: { type: boolean }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reading: { $ref: '#/components/schemas/Reading' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/", validate(readingSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof readingSchema>;
  const d = db();
  const { data: meter } = await d.from("meters").select("id").eq("id", b.meterId).eq("owner_id", uid(req)).maybeSingle();
  if (!meter) throw Object.assign(new Error("Meter not found"), { status: 404 });
  const { data, error } = await d.from("meter_readings").upsert({
    owner_id: uid(req), meter_id: b.meterId, home_id: b.homeId ?? null,
    month_key: b.monthKey, month: b.month,
    prev: b.prev, curr: b.curr, units: Math.round((b.curr - b.prev) * 100) / 100,
    meter_reset: b.meterReset, notes: b.notes,
  }, { onConflict: "meter_id,month_key" }).select().single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  res.status(201).json({ reading: data });
}));

export default router;
