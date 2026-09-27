import express from "express";
import helmet from "helmet";
import interviewRoutes from "./routes/aiInterviewService.js";
import { notFound, errorHandler } from "./errors.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/internal/ai-interviews", interviewRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
