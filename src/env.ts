import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} — copy .env.example to .env and fill it.`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  // Lazy: routes fail with 503 until these are set, so `npm run dev` still boots.
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  // New sb_secret_* key preferred; legacy service_role key still works.
  supabaseServiceKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  cloudinaryCloud: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinarySecret: process.env.CLOUDINARY_API_SECRET ?? "",
};

export function assertSupabase() {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw Object.assign(new Error("Supabase not configured — set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env"), { status: 503 });
  }
}

export function assertCloudinary() {
  if (!env.cloudinaryCloud || !env.cloudinaryKey || !env.cloudinarySecret) {
    throw Object.assign(new Error("Cloudinary not configured — set CLOUDINARY_* vars in backend/.env"), { status: 503 });
  }
}

export { req };
