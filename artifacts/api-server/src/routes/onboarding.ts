import { Router } from "express";
import { db, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission } from "../middlewares/permissions";

export const onboardingRouter = Router();

const VALID_STATUSES = ["pending", "in_progress", "active", "suspended"];
const VALID_STEPS = [0, 1, 2, 3, 4, 5, 6]; // 0=pending, 1=welcome, 2=profile, 3=integrations, 4=first client, 5=first quote, 6=active

const STEP_LABELS: Record<number, string> = {
  0: "Pendiente",
  1: "Bienvenida",
  2: "Perfil",
  3: "Integraciones",
  4: "Primer cliente",
  5: "Primer presupuesto",
  6: "Activado",
};

// ── GET /api/onboarding/status ── estado del onboarding del workspace ──────────

onboardingRouter.get("/status", requirePermission("workspace.view"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const [org] = await db.select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      plan: organizationsTable.plan,
      onboardingStatus: organizationsTable.onboardingStatus,
      onboardingStep: organizationsTable.onboardingStep,
      onboardingCompletedAt: organizationsTable.onboardingCompletedAt,
    }).from(organizationsTable).where(eq(organizationsTable.id, orgId));

    if (!org) { res.status(404).json({ error: "Workspace no encontrado" }); return; }

    res.json({
      orgId: org.id,
      orgName: org.name,
      plan: org.plan,
      status: org.onboardingStatus ?? "pending",
      step: org.onboardingStep ?? 0,
      stepLabel: STEP_LABELS[org.onboardingStep ?? 0] ?? "Desconocido",
      completedAt: org.onboardingCompletedAt?.toISOString() ?? null,
      steps: [
        { id: 1, label: "Bienvenida", completed: (org.onboardingStep ?? 0) >= 1 },
        { id: 2, label: "Perfil de empresa", completed: (org.onboardingStep ?? 0) >= 2 },
        { id: 3, label: "Configurar integraciones", completed: (org.onboardingStep ?? 0) >= 3 },
        { id: 4, label: "Primer cliente", completed: (org.onboardingStep ?? 0) >= 4 },
        { id: 5, label: "Primer presupuesto", completed: (org.onboardingStep ?? 0) >= 5 },
        { id: 6, label: "Workspace activado", completed: (org.onboardingStep ?? 0) >= 6 },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/onboarding/progress ── avanzar onboarding ──────────────────

onboardingRouter.post("/progress", requirePermission("workspace.edit"), async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { step, status } = req.body as { step?: number; status?: string };

    const updateData: Record<string, unknown> = {};
    if (step !== undefined && VALID_STEPS.includes(step)) {
      updateData.onboardingStep = step;
      if (step >= 6) {
        updateData.onboardingStatus = "active";
        updateData.onboardingCompletedAt = new Date();
      } else if (step > 0) {
        updateData.onboardingStatus = "in_progress";
      }
    }
    if (status !== undefined && VALID_STATUSES.includes(status)) {
      updateData.onboardingStatus = status;
    }

    const [org] = await db.update(organizationsTable).set(updateData)
      .where(eq(organizationsTable.id, orgId))
      .returning();

    if (!org) { res.status(404).json({ error: "Workspace no encontrado" }); return; }

    res.json({
      orgId: org.id,
      status: org.onboardingStatus,
      step: org.onboardingStep,
      stepLabel: STEP_LABELS[org.onboardingStep ?? 0] ?? "Desconocido",
      completedAt: org.onboardingCompletedAt?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
