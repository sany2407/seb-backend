import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/supabase";
import { asyncHandler, validate } from "../middleware";
import { requireAuth } from "../middleware/auth";

const router = Router();

const creds = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be 6+ characters"),
});

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Sign up a new user
 *     description: Creates the user (email pre-confirmed for MVP) and returns a session. Also creates a `profiles` row via DB trigger.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 6 }
 *               displayName: { type: string }
 *     responses:
 *       201:
 *         description: Session created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post("/signup", validate(creds.extend({ displayName: z.string().optional() })), asyncHandler(async (req, res) => {
  const { email, password, displayName } = req.body as z.infer<typeof creds> & { displayName?: string };
  const admin = db().auth.admin;
  const { error: cErr } = await admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { display_name: displayName ?? "" },
  });
  if (cErr) throw Object.assign(new Error(cErr.message), { status: 400 });
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw Object.assign(new Error(error?.message ?? "Sign-in failed"), { status: 400 });
  res.status(201).json({ user: { id: data.user.id, email: data.user.email }, session: data.session });
}));

/**
 * @openapi
 * /api/auth/signin:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in with email + password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Session created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post("/signin", validate(creds), asyncHandler(async (req, res) => {
  const { data, error } = await db().auth.signInWithPassword(req.body as z.infer<typeof creds>);
  if (error || !data.session) throw Object.assign(new Error(error?.message ?? "Sign-in failed"), { status: 400 });
  res.json({ user: { id: data.user.id, email: data.user.email }, session: data.session });
}));

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh an expired access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token: { type: string }
 *     responses:
 *       200:
 *         description: New session
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post("/refresh", validate(z.object({ refresh_token: z.string().min(1) })), asyncHandler(async (req, res) => {
  const { data, error } = await db().auth.refreshSession({ refresh_token: req.body.refresh_token });
  if (error || !data.session) throw Object.assign(new Error(error?.message ?? "Refresh failed"), { status: 400 });
  res.json({ user: { id: data.user?.id, email: data.user?.email }, session: data.session });
}));

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current user + profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: User and profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *                 profile: { $ref: '#/components/schemas/Profile' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const { data: profile } = await db().from("profiles").select("*").eq("id", req.user!.id).maybeSingle();
  res.json({ user: req.user, profile: profile ?? null });
}));

export default router;
