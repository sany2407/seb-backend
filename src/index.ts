import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env, req } from "./env";
import { isDbConfigured } from "./lib/supabase";
import { swaggerSpec } from "./docs/swagger";
import { errorHandler } from "./middleware";
import auth from "./routes/auth";
import homes from "./routes/homes";
import meters from "./routes/meters";
import readings from "./routes/readings";
import bills from "./routes/bills";
import splits from "./routes/splits";
import payments from "./routes/payments";
import uploads from "./routes/uploads";
import settings from "./routes/settings";

const app = express();
app.use(cors({ origin: env.frontendUrl }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, db: isDbConfigured() ? "configured" : "missing-env" });
});

app.use("/docs.json", (_req, res) => res.json(swaggerSpec));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/auth", auth);
app.use("/api/homes", homes);
app.use("/api/meters", meters);
app.use("/api/readings", readings);
app.use("/api/bills", bills);
app.use("/api/splits", splits);
app.use("/api/payments", payments);
app.use("/api/uploads", uploads);
app.use("/api/settings", settings);
app.use("/api", payments); // /api/attachments lives on the payments router

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const port = Number(req("PORT")) || env.port;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SEB backend on http://localhost:${port} (db: ${isDbConfigured() ? "supabase" : "NOT CONFIGURED — set backend/.env"})`);
  // eslint-disable-next-line no-console
  console.log(`Swagger UI on http://localhost:${port}/docs`);
});
