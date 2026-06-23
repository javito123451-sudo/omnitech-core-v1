import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getMetrics } from "../utils/avaMetrics";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/ava-metrics", (_req, res) => {
  const metrics = getMetrics();
  res.json({
    ...metrics,
    architecture: "Ava V2",
    target: "80% Skill Engine / 20% LLM",
  });
});

export default router;
