import { Router } from "express";
import { db, knowledgeBaseTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

export const knowledgeBaseRouter = Router();

import { requirePermission } from "../middlewares/permissions";

// GET /api/knowledge-base — list all entries for org
knowledgeBaseRouter.get("/", requirePermission("knowledge_base.read"), async (req, res) => {
  const orgId = (req as any).orgId as number;
  try {
    const entries = await db
      .select()
      .from(knowledgeBaseTable)
      .where(eq(knowledgeBaseTable.orgId, orgId))
      .orderBy(asc(knowledgeBaseTable.sortOrder), asc(knowledgeBaseTable.createdAt));
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/knowledge-base — create entry
knowledgeBaseRouter.post("/", requirePermission("knowledge_base.write"), async (req, res) => {
  const orgId = (req as any).orgId as number;
  const { title, content, category, sortOrder } = req.body as {
    title: string; content: string; category?: string; sortOrder?: number;
  };

  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "Se requieren título y contenido." });
    return;
  }

  try {
    const [created] = await db.insert(knowledgeBaseTable).values({
      orgId,
      title:     title.trim(),
      content:   content.trim(),
      category:  category?.trim() ?? "general",
      sortOrder: sortOrder ?? 0,
      isActive:  true,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/knowledge-base/:id — update entry
knowledgeBaseRouter.put("/:id", requirePermission("knowledge_base.write"), async (req, res) => {
  const orgId = (req as any).orgId as number;
  const id = Number(req.params.id);
  const { title, content, category, isActive, sortOrder } = req.body as {
    title?: string; content?: string; category?: string; isActive?: boolean; sortOrder?: number;
  };

  try {
    const [updated] = await db.update(knowledgeBaseTable)
      .set({
        ...(title    !== undefined && { title:     title.trim() }),
        ...(content  !== undefined && { content:   content.trim() }),
        ...(category !== undefined && { category:  category.trim() }),
        ...(isActive !== undefined && { isActive }),
        ...(sortOrder !== undefined && { sortOrder }),
        updatedAt: new Date(),
      })
      .where(and(eq(knowledgeBaseTable.id, id), eq(knowledgeBaseTable.orgId, orgId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Entrada no encontrada." });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/knowledge-base/:id — delete entry
knowledgeBaseRouter.delete("/:id", requirePermission("knowledge_base.write"), async (req, res) => {
  const orgId = (req as any).orgId as number;
  const id = Number(req.params.id);
  try {
    await db.delete(knowledgeBaseTable)
      .where(and(eq(knowledgeBaseTable.id, id), eq(knowledgeBaseTable.orgId, orgId)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/knowledge-base/categories — get distinct categories
knowledgeBaseRouter.get("/categories", requirePermission("knowledge_base.read"), async (req, res) => {
  const orgId = (req as any).orgId as number;
  try {
    const entries = await db
      .select({ category: knowledgeBaseTable.category })
      .from(knowledgeBaseTable)
      .where(eq(knowledgeBaseTable.orgId, orgId));
    const cats = [...new Set(entries.map((e) => e.category))].sort();
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
