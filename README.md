# SEB backend — Express + TypeScript + Supabase + Cloudinary

## Setup
```bash
cd backend
cp .env.example .env   # fill SUPABASE_* + CLOUDINARY_*
npm install
npm run dev            # http://localhost:4000
```

1. **Supabase**: create a project → run `supabase/schema.sql` in the SQL editor (tables + seed homes), then `supabase/auth.sql` (profiles + per-user columns) → copy Project URL + `sb_secret` key (Settings → API Keys) into `.env`. Never expose the secret key to the browser.
2. **Cloudinary**: copy cloud name + API key/secret (Console → Settings → API keys) into `.env`.

## Auth
Supabase Auth (email/password, `sb_secret` service key server-side only):
`POST /api/auth/signup|signin` → `{ user, session }`, `POST /api/auth/refresh`,
`GET /api/auth/me`. Every other `/api/*` route needs
`Authorization: Bearer <access_token>` and only sees the caller's rows
(`owner_id` / `user_id` scoping; run `supabase/auth.sql`).

## Docs
Swagger UI at `GET /docs`, raw spec at `GET /docs.json`. Click **Authorize**,
paste the `access_token` from signup/signin, then try endpoints live.

## Endpoints
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ ok, db }` |
| GET/POST | `/api/homes` | `?active=true`; DELETE soft-deactivates, `?hard=true` deletes |
| PATCH/DELETE | `/api/homes/:id` | |
| GET/POST | `/api/meters` | |
| GET/POST | `/api/readings` | upsert on `(meter_id, month_key)`; `curr>=prev` unless `meterReset` |
| GET/POST | `/api/bills` | POST computes splits server-side |
| GET/PATCH | `/api/bills/:id` | bill + splits + payments + attachments |
| POST | `/api/splits/compute` | pure preview, no DB |
| GET/PUT | `/api/splits/:year/:month` | load / save split per month-year |
| GET/POST | `/api/payments` | POST rolls up `bill.paid` + status |
| POST | `/api/uploads/sign` | signed params for direct browser → Cloudinary upload |
| GET/POST | `/api/attachments` | store Cloudinary URL + metadata |
| DELETE | `/api/attachments/:id` | |
| GET/PUT | `/api/settings` | billing interval + unit price |

Frontend points here via `NEXT_PUBLIC_API_URL` (see root `.env.example`).
