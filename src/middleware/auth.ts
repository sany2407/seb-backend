import { Request, Response, NextFunction } from "express";
import { db } from "../lib/supabase";

export interface AuthedUser { id: string; email: string; }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthedUser; }
  }
}

/** Verifies the Supabase JWT from `Authorization: Bearer <token>`. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  db().auth.getUser(req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "")
    .then(({ data, error }) => {
      if (error || !data.user) {
        res.status(401).json({ error: "Invalid or expired token — sign in at POST /api/auth/signin" });
        return;
      }
      req.user = { id: data.user.id, email: data.user.email ?? "" };
      next();
    })
    .catch(next);
}

export function uid(req: Request): string {
  if (!req.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return req.user.id;
}
