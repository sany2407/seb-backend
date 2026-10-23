import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}

export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      throw Object.assign(new Error(`Validation: ${msg}`), { status: 400 });
    }
    req.body = parsed.data;
    next();
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { message?: string; status?: number };
  const status = typeof e?.status === "number" ? e.status : 500;
  res.status(status).json({ error: e?.message ?? "Internal error" });
}
