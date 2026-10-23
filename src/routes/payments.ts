import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth, uid } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const paySchema = z.object({
  billId: z.string().uuid(),
  amount: z.number().positive(),
  paidAt: z.string().optional(),
  method: z.string().optional(),
  ref: z.string().optional(),
  screenshotUrl: z.string().url().optional(),
});

/**
 * @openapi
 * /api/payments:
 *   get:
 *     tags: [Payments]
 *     summary: List my payments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: billId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payments: { type: array, items: { $ref: '#/components/schemas/Payment' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", asyncHandler(async (req, res) => {
  let q = db().from("payments").select("*").eq("owner_id", uid(req)).order("paid_at", { ascending: false });
  if (typeof req.query.billId === "string") q = q.eq("bill_id", req.query.billId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  res.json({ payments: data });
}));

/**
 * @openapi
 * /api/payments:
 *   post:
 *     tags: [Payments]
 *     summary: Record a payment (rolls up bill paid + status)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [billId, amount]
 *             properties:
 *               billId: { type: string, format: uuid }
 *               amount: { type: number }
 *               paidAt: { type: string, format: date }
 *               method: { type: string }
 *               ref: { type: string }
 *               screenshotUrl: { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 paid: { type: number }
 *                 outstanding: { type: number }
 *                 status: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post("/", validate(paySchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof paySchema>;
  const d = db();
  const { data: bill } = await d.from("eb_bills").select("amount").eq("id", b.billId).eq("owner_id", uid(req)).maybeSingle();
  if (!bill) throw Object.assign(new Error("Bill not found"), { status: 404 });
  const { error } = await d.from("payments").insert({
    owner_id: uid(req), bill_id: b.billId, amount: b.amount,
    paid_at: b.paidAt ?? new Date().toISOString().slice(0, 10),
    method: b.method ?? null, ref: b.ref ?? null, screenshot_url: b.screenshotUrl ?? null,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 400 });

  const { data: sums } = await d.from("payments").select("amount").eq("bill_id", b.billId);
  const paid = (sums ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const total = Number(bill.amount ?? 0);
  const status = paid >= total ? "Paid" : paid > 0 ? "Partial" : "Pending";
  await d.from("eb_bills").update({ paid, status }).eq("id", b.billId);
  res.status(201).json({ paid, outstanding: Math.max(0, total - paid), status });
}));

const attachSchema = z.object({
  ownerType: z.enum(["EB_BILL", "METER_READING", "PAYMENT"]),
  ownerId: z.string().min(1),
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  fileType: z.string().min(1),
  fileSize: z.number().nonnegative(),
  attachmentType: z.enum(["EB_BILL", "METER_PHOTO", "PAYMENT_RECEIPT", "PAYMENT_SCREENSHOT", "OTHER"]),
});

/**
 * @openapi
 * /api/attachments:
 *   get:
 *     tags: [Attachments]
 *     summary: List my attachments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: ownerType
 *         schema: { type: string, enum: [EB_BILL, METER_READING, PAYMENT] }
 *       - in: query
 *         name: ownerId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Attachments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attachments: { type: array, items: { $ref: '#/components/schemas/Attachment' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/attachments", asyncHandler(async (req, res) => {
  let q = db().from("attachments").select("*").eq("user_id", uid(req)).order("uploaded_at", { ascending: false });
  if (typeof req.query.ownerType === "string") q = q.eq("owner_type", req.query.ownerType);
  if (typeof req.query.ownerId === "string") q = q.eq("owner_id", req.query.ownerId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  res.json({ attachments: data });
}));

/**
 * @openapi
 * /api/attachments:
 *   post:
 *     tags: [Attachments]
 *     summary: Store attachment metadata (bytes live in Cloudinary)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ownerType, ownerId, fileName, fileUrl, fileType, fileSize, attachmentType]
 *             properties:
 *               ownerType: { type: string, enum: [EB_BILL, METER_READING, PAYMENT] }
 *               ownerId: { type: string }
 *               fileName: { type: string }
 *               fileUrl: { type: string, format: uri }
 *               fileType: { type: string }
 *               fileSize: { type: number }
 *               attachmentType: { type: string, enum: [EB_BILL, METER_PHOTO, PAYMENT_RECEIPT, PAYMENT_SCREENSHOT, OTHER] }
 *     responses:
 *       201:
 *         description: Stored
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attachment: { $ref: '#/components/schemas/Attachment' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/attachments", validate(attachSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof attachSchema>;
  const { data, error } = await db().from("attachments").insert({
    user_id: uid(req), owner_type: b.ownerType, owner_id: b.ownerId,
    file_name: b.fileName,
    file_url: b.fileUrl, file_type: b.fileType, file_size: b.fileSize,
    attachment_type: b.attachmentType,
  }).select().single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  res.status(201).json({ attachment: data });
}));

/**
 * @openapi
 * /api/attachments/{id}:
 *   delete:
 *     tags: [Attachments]
 *     summary: Delete an attachment record
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deleted }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete("/attachments/:id", asyncHandler(async (req, res) => {
  const { error, count } = await db().from("attachments").delete({ count: "exact" }).eq("id", req.params.id).eq("user_id", uid(req));
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  if (!count) throw Object.assign(new Error("Attachment not found"), { status: 404 });
  res.json({ ok: true });
}));

export default router;
