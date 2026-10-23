import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const meterSchema = z.object({
  homeId: z.string().uuid().nullable().optional(),
  meterNo: z.string().min(1),
  type: z.enum(["MAIN", "SUB"]),
});

/**
 * @openapi
 * /api/meters:
 *   get:
 *     tags: [Meters]
 *     summary: List my meters
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Meters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 meters: { type: array, items: { $ref: '#/components/schemas/Meter' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", asyncHandler(async (req, res) => {
  const { data, error } = await db().from("meters").select("*").eq("owner_id", uid(req)).order("type");
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  res.json({ meters: data });
}));

/**
 * @openapi
 * /api/meters:
 *   post:
 *     tags: [Meters]
 *     summary: Register a meter
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [meterNo, type]
 *             properties:
 *               homeId: { type: string, format: uuid, nullable: true }
 *               meterNo: { type: string }
 *               type: { type: string, enum: [MAIN, SUB] }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 meter: { $ref: '#/components/schemas/Meter' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/", validate(meterSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof meterSchema>;
  if (b.homeId) {
    const { data: home } = await db().from("homes").select("id").eq("id", b.homeId).eq("owner_id", uid(req)).maybeSingle();
    if (!home) throw Object.assign(new Error("Home not found"), { status: 404 });
  }
  const { data, error } = await db().from("meters").insert({
    owner_id: uid(req), home_id: b.homeId ?? null, meter_no: b.meterNo, type: b.type,
  }).select().single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  res.status(201).json({ meter: data });
}));

export default router;
