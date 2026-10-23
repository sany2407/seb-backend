import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validate } from "../middleware";
import { requireAuth } from "../middleware/auth";
import { signUpload } from "../lib/cloudinary";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /api/uploads/sign:
 *   post:
 *     tags: [Uploads]
 *     summary: Signed params for direct browser → Cloudinary upload
 *     description: >
 *       Flow: POST here → upload file to `uploadUrl` with form fields
 *       (file, api_key, timestamp, signature, folder) → POST the returned
 *       `secure_url` to `/api/attachments`.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folder: { type: string, default: eb-bills }
 *     responses:
 *       200:
 *         description: Signature payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cloudName: { type: string }
 *                 apiKey: { type: string }
 *                 timestamp: { type: number }
 *                 signature: { type: string }
 *                 folder: { type: string }
 *                 uploadUrl: { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/sign", validate(z.object({
  folder: z.string().min(1).default("eb-bills"),
})), asyncHandler(async (req, res) => {
  res.json(signUpload(req.body.folder));
}));

export default router;
