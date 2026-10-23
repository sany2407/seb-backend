import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const homeSchema = z.object({
  name: z.string().min(1),
  occupant: z.string().optional().default(""),
  meterNo: z.string().min(1),
  meterType: z.enum(["MAIN", "SUB"]).optional().default("SUB"),
  notes: z.string().optional().default(""),
});

/**
 * @openapi
 * /api/homes:
 *   get:
 *     tags: [Homes]
 *     summary: List my homes
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema: { type: string, enum: ["true", "false"] }
 *     responses:
 *       200:
 *         description: Homes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 homes: { type: array, items: { $ref: '#/components/schemas/Home' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", asyncHandler(async (req, res) => {
  let q = db().from("homes").select("*").eq("owner_id", uid(req)).order("name");
  if (req.query.active === "true") q = q.eq("active", true);
  if (req.query.active === "false") q = q.eq("active", false);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  res.json({ homes: data });
}));

/**
 * @openapi
 * /api/homes:
 *   post:
 *     tags: [Homes]
 *     summary: Add a home
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, meterNo]
 *             properties:
 *               name: { type: string }
 *               occupant: { type: string }
 *               meterNo: { type: string }
 *               meterType: { type: string, enum: [MAIN, SUB] }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 home: { $ref: '#/components/schemas/Home' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/", validate(homeSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof homeSchema>;
  const { data, error } = await db().from("homes").insert({
    owner_id: uid(req), name: b.name, occupant: b.occupant, meter_no: b.meterNo,
    meter_type: b.meterType, notes: b.notes,
  }).select().single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  // Keep the home <-> meter invariant so readings always have a meter to attach to.
  const { error: mErr } = await db().from("meters").insert({
    owner_id: uid(req), home_id: data.id, meter_no: b.meterNo, type: b.meterType,
  });
  if (mErr) console.warn("meter auto-create skipped:", mErr.message);
  res.status(201).json({ home: data });
}));

/**
 * @openapi
 * /api/homes/{id}:
 *   patch:
 *     tags: [Homes]
 *     summary: Edit a home
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
 *               name: { type: string }
 *               occupant: { type: string }
 *               meterNo: { type: string }
 *               notes: { type: string }
 *               active: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 home: { $ref: '#/components/schemas/Home' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch("/:id", asyncHandler(async (req, res) => {
  const patch: Record<string, unknown> = {};
  const map: Record<string, string> = { name: "name", occupant: "occupant", meterNo: "meter_no", notes: "notes", active: "active" };
  for (const [k, col] of Object.entries(map)) if (req.body[k] !== undefined) patch[col] = req.body[k];
  const { data, error } = await db().from("homes").update(patch).eq("id", req.params.id).eq("owner_id", uid(req)).select().maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  if (!data) throw Object.assign(new Error("Home not found"), { status: 404 });
  res.json({ home: data });
}));

/**
 * @openapi
 * /api/homes/{id}:
 *   delete:
 *     tags: [Homes]
 *     summary: Deactivate (or hard-delete with ?hard=true) a home
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: hard
 *         schema: { type: string, enum: ["true"] }
 *     responses:
 *       200: { description: Done }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete("/:id", asyncHandler(async (req, res) => {
  const d = db();
  if (req.query.hard === "true") {
    const { error, count } = await d.from("homes").delete({ count: "exact" }).eq("id", req.params.id).eq("owner_id", uid(req));
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    if (!count) throw Object.assign(new Error("Home not found"), { status: 404 });
    res.json({ ok: true });
  } else {
    const { data, error } = await d.from("homes").update({ active: false }).eq("id", req.params.id).eq("owner_id", uid(req)).select().maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    if (!data) throw Object.assign(new Error("Home not found"), { status: 404 });
    res.json({ home: data });
  }
}));

export default router;
