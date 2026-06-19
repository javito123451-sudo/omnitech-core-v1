import { Router } from "express";
import { db } from "@workspace/db";
import { docsPagesTable, docsVersionsTable } from "@workspace/db";
import { eq, ilike, or, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { requireAuth } from "../middlewares/auth";

interface AuthReq extends Request {
  clerkUserId?: string;
  userEmail?: string;
  orgId?: number;
  platformRoles?: string[];
}

export const docsRouter = Router();

function canEdit(req: AuthReq): boolean {
  const roles = req.platformRoles ?? [];
  return roles.includes("SUPER_ADMIN") || roles.includes("STAFF_OMNITECH");
}

// GET /api/docs — list all published pages (ordered)
docsRouter.get("/", requireAuth, async (req: AuthReq, res: Response) => {
  try {
    const pages = await db
      .select({
        id: docsPagesTable.id,
        slug: docsPagesTable.slug,
        title: docsPagesTable.title,
        chapterOrder: docsPagesTable.chapterOrder,
        updatedAt: docsPagesTable.updatedAt,
        currentVersion: docsPagesTable.currentVersion,
      })
      .from(docsPagesTable)
      .where(eq(docsPagesTable.isPublished, true))
      .orderBy(docsPagesTable.chapterOrder);

    res.json({ pages, canEdit: canEdit(req) });
  } catch (err) {
    console.error("docs list error", err);
    res.status(500).json({ error: "Error al obtener el manual" });
  }
});

// GET /api/docs/search?q= — full-text search
docsRouter.get("/search", requireAuth, async (req: AuthReq, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ results: [] });

    const pattern = `%${q}%`;
    const results = await db
      .select({
        slug: docsPagesTable.slug,
        title: docsPagesTable.title,
        chapterOrder: docsPagesTable.chapterOrder,
        snippet: sql<string>`substring(${docsPagesTable.content}, 1, 300)`,
      })
      .from(docsPagesTable)
      .where(
        or(
          ilike(docsPagesTable.title, pattern),
          ilike(docsPagesTable.content, pattern),
        ),
      )
      .orderBy(docsPagesTable.chapterOrder)
      .limit(20);

    res.json({ results });
  } catch (err) {
    console.error("docs search error", err);
    res.status(500).json({ error: "Error en la búsqueda" });
  }
});

// GET /api/docs/:slug — get full page content
docsRouter.get("/:slug", requireAuth, async (req: AuthReq, res: Response) => {
  try {
    const [page] = await db
      .select()
      .from(docsPagesTable)
      .where(eq(docsPagesTable.slug, req.params.slug));

    if (!page) return res.status(404).json({ error: "Página no encontrada" });

    res.json({ page, canEdit: canEdit(req) });
  } catch (err) {
    console.error("docs get error", err);
    res.status(500).json({ error: "Error al obtener la página" });
  }
});

// PUT /api/docs/:slug — update page content (SUPER_ADMIN / STAFF_OMNITECH only)
docsRouter.put("/:slug", requireAuth, async (req: AuthReq, res: Response) => {
  if (!canEdit(req)) {
    return res.status(403).json({ error: "Sin permiso para editar la documentación" });
  }
  try {
    const { content, changeNote } = req.body as { content: string; changeNote?: string };
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "Contenido requerido" });
    }

    const [current] = await db
      .select({ currentVersion: docsPagesTable.currentVersion, content: docsPagesTable.content })
      .from(docsPagesTable)
      .where(eq(docsPagesTable.slug, req.params.slug));

    if (!current) return res.status(404).json({ error: "Página no encontrada" });

    const nextVersion = (current.currentVersion ?? 1) + 1;

    await db.insert(docsVersionsTable).values({
      pageSlug: req.params.slug,
      versionNumber: current.currentVersion ?? 1,
      content: current.content,
      authorClerkId: req.clerkUserId,
      authorEmail: req.userEmail,
      changeNote: changeNote ?? "Edición manual",
    });

    const [updated] = await db
      .update(docsPagesTable)
      .set({
        content,
        updatedAt: new Date(),
        updatedByClerkId: req.clerkUserId,
        updatedByEmail: req.userEmail,
        currentVersion: nextVersion,
      })
      .where(eq(docsPagesTable.slug, req.params.slug))
      .returning();

    res.json({ page: updated });
  } catch (err) {
    console.error("docs update error", err);
    res.status(500).json({ error: "Error al guardar los cambios" });
  }
});

// GET /api/docs/:slug/versions — version history
docsRouter.get("/:slug/versions", requireAuth, async (req: AuthReq, res: Response) => {
  if (!canEdit(req)) {
    return res.status(403).json({ error: "Sin permiso para ver versiones" });
  }
  try {
    const versions = await db
      .select()
      .from(docsVersionsTable)
      .where(eq(docsVersionsTable.pageSlug, req.params.slug))
      .orderBy(desc(docsVersionsTable.versionNumber))
      .limit(20);

    res.json({ versions });
  } catch (err) {
    console.error("docs versions error", err);
    res.status(500).json({ error: "Error al obtener versiones" });
  }
});

// POST /api/docs/:slug/restore/:version — restore a version
docsRouter.post("/:slug/restore/:version", requireAuth, async (req: AuthReq, res: Response) => {
  if (!canEdit(req)) {
    return res.status(403).json({ error: "Sin permiso para restaurar versiones" });
  }
  try {
    const versionNum = parseInt(req.params.version, 10);
    const [ver] = await db
      .select()
      .from(docsVersionsTable)
      .where(
        sql`${docsVersionsTable.pageSlug} = ${req.params.slug} AND ${docsVersionsTable.versionNumber} = ${versionNum}`,
      );

    if (!ver) return res.status(404).json({ error: "Versión no encontrada" });

    const [current] = await db
      .select({ currentVersion: docsPagesTable.currentVersion, content: docsPagesTable.content })
      .from(docsPagesTable)
      .where(eq(docsPagesTable.slug, req.params.slug));

    if (!current) return res.status(404).json({ error: "Página no encontrada" });

    await db.insert(docsVersionsTable).values({
      pageSlug: req.params.slug,
      versionNumber: current.currentVersion,
      content: current.content,
      authorClerkId: req.clerkUserId,
      authorEmail: req.userEmail,
      changeNote: `Restauración a v${versionNum}`,
    });

    const [updated] = await db
      .update(docsPagesTable)
      .set({
        content: ver.content,
        updatedAt: new Date(),
        updatedByClerkId: req.clerkUserId,
        updatedByEmail: req.userEmail,
        currentVersion: (current.currentVersion ?? 1) + 1,
      })
      .where(eq(docsPagesTable.slug, req.params.slug))
      .returning();

    res.json({ page: updated, restoredFrom: versionNum });
  } catch (err) {
    console.error("docs restore error", err);
    res.status(500).json({ error: "Error al restaurar la versión" });
  }
});
