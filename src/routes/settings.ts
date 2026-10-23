import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const settingsSchema = z.object({
  billingIntervalMonths: z.number().int().refine((v) => [1, 2, 3, 6, 12].includes(v), { message: "Interval must be 1, 2, 3, 6 or 12 months" }),
  unitPrice: z.number().nonnegative(),
});

/** Billing config lives on the user's primary MAIN meter (one per main unit). */
async function primaryMain(userId: string) {
  const { data } = await db().from("meters").select("*")
    .eq("owner_id", userId).eq("type", "MAIN")
    .order("created_at").limit(1).maybeSingle();
  return data;
}

/**
 * @openapi
 * /api/settings:
 *   get:
 *     tags: [Settings]
 *     summary: Main meter billing config (defaults when unset)
 *     description: Interval + unit price belong to the main meter and are reused by every bill. Falls back to the legacy per-user row when no main meter exists yet.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   type: object
 *                   properties:
 *                     billing_interval_months: { type: number }
 *                     unit_price: { type: number }
 *                     currency: { type: string }
 *                     main_meter_id: { type: string, format: uuid, nullable: true }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", asyncHandler(async (req, res) => {
  const id = uid(req);
  const main = await primaryMain(id);
  if (main) {
    return res.json({ settings: {
      user_id: id, billing_interval_months: Number(main.billing_interval_months),
      unit_price: Number(main.unit_price), currency: "INR", main_meter_id: main.id,
    } });
  }
  const { data } = await db().from("settings").select("*").eq("user_id", id).maybeSingle();
  res.json({ settings: data ?? { user_id: id, billing_interval_months: 1, unit_price: 0, currency: "INR", main_meter_id: null } });
}));

/**
 * @openapi
 * /api/settings:
 *   put:
 *     tags: [Settings]
 *     summary: Save main meter billing config
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [billingIntervalMonths, unitPrice]
 *             properties:
 *               billingIntervalMonths: { type: number, enum: [1, 2, 3, 6, 12] }
 *               unitPrice: { type: number, description: "₹ per unit; 0 = always enter bill directly" }
 *     responses:
 *       200:
 *         description: Saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   type: object
 *                   properties:
 *                     billing_interval_months: { type: number }
 *                     unit_price: { type: number }
 *                     main_meter_id: { type: string, format: uuid, nullable: true }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put("/", validate(settingsSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof settingsSchema>;
  const id = uid(req);
  const d = db();
  const main = await primaryMain(id);
  if (main) {
    const { error } = await d.from("meters").update({
      billing_interval_months: b.billingIntervalMonths, unit_price: b.unitPrice,
    }).eq("id", main.id);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    return res.json({ settings: {
      user_id: id, billing_interval_months: b.billingIntervalMonths,
      unit_price: b.unitPrice, currency: "INR", main_meter_id: main.id,
    } });
  }
  const { data, error } = await d.from("settings").upsert({
    user_id: id, billing_interval_months: b.billingIntervalMonths, unit_price: b.unitPrice,
  }, { onConflict: "user_id" }).select().single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  res.json({ settings: data });
}));

export default router;
