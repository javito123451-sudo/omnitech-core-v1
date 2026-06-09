import PDFDocument from "pdfkit";

export interface PdfQuoteData {
  quote: {
    id: number;
    title: string;
    status: string;
    currency: string;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    notes: string | null;
    validUntil: Date | null;
    createdAt: Date;
  };
  client: {
    name: string;
    company: string | null;
    email: string;
    phone: string | null;
  } | null;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    orderIndex: number;
  }[];
  orgName?: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft:    "Borrador",
  sent:     "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  expired:  "Expirado",
};

function eur(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(amount);
}

export function generateQuotePdf(data: PdfQuoteData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { quote, client, items, orgName = "OmniTech Core" } = data;

    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W   = doc.page.width;   // 595
    const H   = doc.page.height;  // 842
    const M   = 50;               // margin
    const C   = "#1d4ed8";        // primary blue
    const DARK  = "#111827";
    const MID   = "#6b7280";
    const LIGHT = "#f9fafb";
    const BORDER = "#e5e7eb";
    const WHITE = "#ffffff";

    // ── Header band ───────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 100).fill(C);

    // Org name
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(20)
      .text(orgName.toUpperCase(), M, 28);
    doc.fillColor("rgba(255,255,255,0.65)").font("Helvetica").fontSize(9)
      .text("Plataforma CRM · OmniTech Core", M, 52);

    // Quote # + date (right)
    const quoteNo = String(quote.id).padStart(5, "0");
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9)
      .text("PRESUPUESTO", M, 22, { width: W - M * 2, align: "right" });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(22)
      .text(`#${quoteNo}`, M, 34, { width: W - M * 2, align: "right" });
    doc.fillColor("rgba(255,255,255,0.65)").font("Helvetica").fontSize(8)
      .text(
        new Date(quote.createdAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" }),
        M, 60, { width: W - M * 2, align: "right" },
      );

    // ── Meta row (status / valid until) ───────────────────────────────────────
    let y = 116;
    // Left: client
    doc.fillColor(C).font("Helvetica-Bold").fontSize(8)
      .text("DESTINATARIO", M, y);
    y += 14;
    if (client) {
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(12).text(client.name, M, y);
      y += 16;
      if (client.company) {
        doc.fillColor(MID).font("Helvetica").fontSize(9).text(client.company, M, y); y += 13;
      }
      doc.fillColor(MID).font("Helvetica").fontSize(9).text(client.email, M, y); y += 13;
      if (client.phone) { doc.text(client.phone, M, y); y += 13; }
    } else {
      doc.fillColor(MID).font("Helvetica").fontSize(9).text("Sin cliente asociado", M, y); y += 13;
    }

    // Right: status + validUntil
    const ry = 116;
    doc.fillColor(C).font("Helvetica-Bold").fontSize(8)
      .text("ESTADO", W - M - 160, ry, { width: 160, align: "right" });
    const statusLabel = STATUS_LABELS[quote.status] ?? quote.status;
    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11)
      .text(statusLabel, W - M - 160, ry + 14, { width: 160, align: "right" });

    if (quote.validUntil) {
      doc.fillColor(C).font("Helvetica-Bold").fontSize(8)
        .text("VÁLIDO HASTA", W - M - 160, ry + 38, { width: 160, align: "right" });
      doc.fillColor(DARK).font("Helvetica").fontSize(9)
        .text(
          new Date(quote.validUntil).toLocaleDateString("es-ES"),
          W - M - 160, ry + 52, { width: 160, align: "right" },
        );
    }

    // ── Divider ───────────────────────────────────────────────────────────────
    y = Math.max(y, ry + 75) + 10;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 16;

    // ── Section title ─────────────────────────────────────────────────────────
    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11)
      .text(quote.title, M, y);
    y += 20;

    // ── Items table header ─────────────────────────────────────────────────────
    const colDesc  = M;
    const colQty   = M + 285;
    const colPrice = M + 355;
    const colTotal = M + 435;
    const rowH = 22;
    const tableW = W - M * 2;

    doc.rect(M, y, tableW, rowH).fill(C);
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8);
    doc.text("DESCRIPCIÓN",    colDesc  + 5, y + 7, { width: 275 });
    doc.text("CANT.",          colQty,       y + 7, { width:  65, align: "center" });
    doc.text("PRECIO UNIT.",   colPrice,     y + 7, { width:  75, align: "right" });
    doc.text("IMPORTE",        colTotal,     y + 7, { width:  85, align: "right" });
    y += rowH;

    // ── Items rows ─────────────────────────────────────────────────────────────
    items.forEach((item, i) => {
      const bg = i % 2 === 0 ? WHITE : LIGHT;
      doc.rect(M, y, tableW, rowH).fill(bg);
      doc.fillColor(DARK).font("Helvetica").fontSize(8)
        .text(item.description, colDesc + 5, y + 7, { width: 270, lineBreak: false });
      doc.text(String(item.quantity), colQty, y + 7, { width: 65, align: "center" });
      doc.text(eur(item.unitPrice, quote.currency), colPrice, y + 7, { width: 75, align: "right" });
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(8)
        .text(eur(item.total, quote.currency), colTotal, y + 7, { width: 85, align: "right" });
      y += rowH;
    });

    // Table border
    doc.rect(M, y - items.length * rowH - rowH, tableW, items.length * rowH + rowH)
      .strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 12;

    // ── Totals ─────────────────────────────────────────────────────────────────
    const totX = W - M - 230;
    const totW = 230;

    const drawTotalRow = (label: string, value: string, bold = false, bg?: string) => {
      if (bg) doc.rect(totX, y, totW, 24).fill(bg);
      const color = bg === C ? WHITE : DARK;
      doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9)
        .text(label, totX + 8, y + 7, { width: 120 });
      doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9)
        .text(value, totX + 8, y + 7, { width: totW - 16, align: "right" });
      y += 24;
    };

    drawTotalRow("Subtotal:", eur(quote.subtotal, quote.currency));
    drawTotalRow(`IVA (${quote.taxRate}%):`, eur(quote.taxAmount, quote.currency));
    // Separator line
    doc.moveTo(totX, y).lineTo(totX + totW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 2;
    drawTotalRow("TOTAL:", eur(quote.total, quote.currency), true, C);

    y += 20;

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (quote.notes) {
      doc.rect(M, y, W - M * 2, 8).fill(C);
      y += 8;
      doc.fillColor(C).font("Helvetica-Bold").fontSize(8).text("NOTAS", M + 5, y + 5);
      y += 18;
      doc.fillColor(MID).font("Helvetica").fontSize(8)
        .text(quote.notes, M, y, { width: W - M * 2 });
      y += doc.heightOfString(quote.notes, { width: W - M * 2 }) + 10;
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = H - 45;
    doc.rect(0, footerY - 1, W, 46).fill(LIGHT);
    doc.moveTo(0, footerY - 1).lineTo(W, footerY - 1).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fillColor(MID).font("Helvetica").fontSize(7.5)
      .text(
        `Presupuesto #${quoteNo} · Generado por OmniTech Core · Este documento es válido como oferta comercial`,
        M, footerY + 10, { width: W - M * 2, align: "center" },
      );

    doc.end();
  });
}
