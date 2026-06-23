import { Router } from "express";
import { db, agentMemoryTable, memoryHistoryTable } from "@workspace/db";
import { eq, and, desc, or, ilike } from "drizzle-orm";
import { getProviderSingleton } from "../ai/types";

export const memoryRouter = Router();

const AGENT_SLUG = "operator";

type MemRow = typeof agentMemoryTable.$inferSelect;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const aiProvider = getProviderSingleton();
    const res = await aiProvider.embed(text.slice(0, 2000));
    return res.embedding ?? null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Parse category from memoryKey if category column is null (backward compat). */
function resolveCategory(mem: MemRow): string {
  if (mem.category) return mem.category;
  const i = mem.memoryKey.indexOf(":");
  return i !== -1 ? mem.memoryKey.slice(0, i) : "info";
}

/** Record a change in memory_history. */
async function recordHistory(
  memoryId: number,
  orgId: number,
  action: "create" | "update" | "delete",
  prev: Partial<{ title: string | null; val: string | null }>,
  next: Partial<{ title: string | null; val: string | null }>,
  source: string | null,
) {
  try {
    await db.insert(memoryHistoryTable).values({
      memoryId,
      orgId,
      action,
      prevTitle: prev.title ?? null,
      newTitle:  next.title ?? null,
      prevVal:   prev.val   ?? null,
      newVal:    next.val   ?? null,
      source,
    });
  } catch {
    // Non-critical — don't fail the main operation
  }
}

// ── GET / — list (optional ?category= filter) ─────────────────────────────────
memoryRouter.get("/", async (req, res) => {
  try {
    const orgId    = req.orgId!;
    const category = (req.query["category"] as string | undefined)?.toLowerCase();

    let rows = await db
      .select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, AGENT_SLUG)))
      .orderBy(desc(agentMemoryTable.updatedAt));

    if (category) {
      rows = rows.filter(r => resolveCategory(r) === category);
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /search?q= — semantic search ──────────────────────────────────────────
memoryRouter.get("/search", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const q = ((req.query["q"] as string) ?? "").trim();

    if (!q) {
      res.json([]);
      return;
    }

    const all = await db
      .select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.orgId, orgId), eq(agentMemoryTable.agentSlug, AGENT_SLUG)))
      .orderBy(desc(agentMemoryTable.updatedAt));

    const withEmbeddings = all.filter(r => r.embedding && (r.embedding as number[]).length > 0);

    if (withEmbeddings.length > 0) {
      const qEmb = await generateEmbedding(q);
      if (qEmb) {
        const scored = all
          .map(r => ({
            ...r,
            _score: r.embedding
              ? cosineSimilarity(qEmb, r.embedding as number[])
              : 0.1,
          }))
          .sort((a, b) => b._score - a._score)
          .filter(r => r._score > 0.25)
          .slice(0, 20);
        res.json(scored);
        return;
      }
    }

    // Fallback: text search
    const textResults = await db
      .select()
      .from(agentMemoryTable)
      .where(
        and(
          eq(agentMemoryTable.orgId, orgId),
          eq(agentMemoryTable.agentSlug, AGENT_SLUG),
          or(
            ilike(agentMemoryTable.memoryVal, `%${q}%`),
            ilike(agentMemoryTable.memoryKey, `%${q}%`),
            ilike(agentMemoryTable.title, `%${q}%`),
          ),
        ),
      )
      .orderBy(desc(agentMemoryTable.updatedAt))
      .limit(20);

    res.json(textResults);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /:id/history ──────────────────────────────────────────────────────────
memoryRouter.get("/:id/history", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id    = Number(req.params.id);

    const entries = await db
      .select()
      .from(memoryHistoryTable)
      .where(and(eq(memoryHistoryTable.memoryId, id), eq(memoryHistoryTable.orgId, orgId)))
      .orderBy(desc(memoryHistoryTable.changedAt))
      .limit(50);

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
memoryRouter.post("/", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const {
      key,
      value,
      title,
      category,
      tags,
    } = req.body as {
      key?: string;
      value?: string;
      title?: string;
      category?: string;
      tags?: string;
    };

    if (!value?.trim()) {
      res.status(400).json({ error: "value es requerido" });
      return;
    }

    const cat = category?.toLowerCase().trim() ?? "info";
    const rawName = (title ?? key ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const memoryKey = key?.trim() ?? `${cat}:${rawName || Date.now()}`;
    const titleStr  = title?.trim() ?? null;

    // Generate embedding
    const embText = `${titleStr ?? memoryKey} ${value}`;
    const emb     = await generateEmbedding(embText);

    const [mem] = await db
      .insert(agentMemoryTable)
      .values({
        orgId,
        agentSlug: AGENT_SLUG,
        memoryKey,
        memoryVal: value.trim().slice(0, 2000),
        title: titleStr,
        category: cat,
        tags: tags?.trim() || null,
        embedding: emb as number[] | null,
        source: "user_input",
      })
      .onConflictDoUpdate({
        target: [agentMemoryTable.orgId, agentMemoryTable.agentSlug, agentMemoryTable.memoryKey],
        set: {
          memoryVal: value.trim().slice(0, 2000),
          title:     titleStr,
          category:  cat,
          tags:      tags?.trim() || null,
          embedding: emb as number[] | null,
          source:    "user_input",
          updatedAt: new Date(),
        },
      })
      .returning();

    await recordHistory(
      mem!.id, orgId, "create",
      {},
      { title: mem!.title, val: mem!.memoryVal },
      "user_input",
    );

    res.status(201).json(mem);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
memoryRouter.put("/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id    = Number(req.params.id);
    const { value, title, category, tags } = req.body as {
      value?: string; title?: string; category?: string; tags?: string;
    };

    if (!value?.trim()) {
      res.status(400).json({ error: "value es requerido" });
      return;
    }

    // Fetch existing for history
    const [existing] = await db
      .select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.id, id), eq(agentMemoryTable.orgId, orgId)));

    if (!existing) {
      res.status(404).json({ error: "Memoria no encontrada" });
      return;
    }

    const titleStr = title?.trim() || null;
    const cat      = category?.toLowerCase().trim() || resolveCategory(existing);

    // Re-generate embedding if content changed
    const embText   = `${titleStr ?? existing.memoryKey} ${value}`;
    const emb       = await generateEmbedding(embText);

    const [updated] = await db
      .update(agentMemoryTable)
      .set({
        memoryVal: value.trim().slice(0, 2000),
        title:     titleStr,
        category:  cat,
        tags:      tags?.trim() || null,
        embedding: emb as number[] | null,
        source:    "user_input",
        updatedAt: new Date(),
      })
      .where(and(eq(agentMemoryTable.id, id), eq(agentMemoryTable.orgId, orgId)))
      .returning();

    await recordHistory(
      id, orgId, "update",
      { title: existing.title, val: existing.memoryVal },
      { title: titleStr,       val: value.trim() },
      "user_input",
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
memoryRouter.delete("/:id", async (req, res) => {
  try {
    const orgId = req.orgId!;
    const id    = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(agentMemoryTable)
      .where(and(eq(agentMemoryTable.id, id), eq(agentMemoryTable.orgId, orgId)));

    if (existing) {
      await recordHistory(
        id, orgId, "delete",
        { title: existing.title, val: existing.memoryVal },
        {},
        "user_input",
      );
    }

    await db
      .delete(agentMemoryTable)
      .where(and(eq(agentMemoryTable.id, id), eq(agentMemoryTable.orgId, orgId)));

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
