import { Router } from "express";
import { db, agentMemoryTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

export const memoryRouter = Router();

const AGENT_SLUG = "operator";

memoryRouter.get("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const rows = await db
      .select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, AGENT_SLUG)))
      .orderBy(desc(agentMemoryTable.updatedAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

memoryRouter.post("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key?.trim() || !value?.trim()) {
      res.status(400).json({ error: "key y value son requeridos" });
      return;
    }
    const [mem] = await db
      .insert(agentMemoryTable)
      .values({
        orgId,
        agentSlug: AGENT_SLUG,
        memoryKey: key.trim().toLowerCase().replace(/\s+/g, "_"),
        memoryVal: value.trim().slice(0, 500),
        source: "user_input",
      })
      .onConflictDoUpdate({
        target: [agentMemoryTable.orgId, agentMemoryTable.agentSlug, agentMemoryTable.memoryKey],
        set: {
          memoryVal: value.trim().slice(0, 500),
          source: "user_input",
          updatedAt: new Date(),
        },
      })
      .returning();
    res.status(201).json(mem);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

memoryRouter.delete("/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    await db
      .delete(agentMemoryTable)
      .where(
        and(
          eq(agentMemoryTable.id, Number(req.params.id)),
          eq(agentMemoryTable.orgId, orgId),
        ),
      );
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
