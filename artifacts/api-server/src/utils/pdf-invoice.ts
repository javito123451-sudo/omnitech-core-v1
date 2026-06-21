import PDFDocument from "pdfkit";

export interface PdfInvoiceData {
  invoice: {
    id: number;
    invoiceNumber: string;
    status: string;
    currency: string;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    notes: string | null;
    dueDate: Date | null;
    paidAt: Date | null;
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
  draft:     "Borrador",
  sent:      "Enviada",
  paid:      "Pagada",
  overdue:   "Vencida",
  cancelled: "Cancelada",
  partial:   "Pago parcial",
};

function fmt(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(amount);
}

export function generateInvoicePdf(data: PdfInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { invoice, client, items, orgName = "OmniTech Core" } = data;

    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W   = doc.page.width;
    const H   = doc.page.height;
    const M   = 50;
    const C   = "#0e7490";
    const DARK   = "#111827";
    const MID    = "#6b7280";
    const LIGHT  = "#f0f9ff";
    const BORDER = "#e0f2fe";
    const WHITE  = "#ffffff";
    const GREEN  = "#059669";

    // ── Header band ───────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 100).fill(C);
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(20)
      .text(orgName.toUpperCase(), M, 28);
    doc.fillColor("rgba(255,255,255,0.65)").font("Helvetica").fontSize(9)
      .text("Facturación · OmniTech Core", M, 52);

    // Invoice # right
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9)
      .text("FACTURA", M, 22, { width: W - M * 2, align: "right" });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(22)
      .text(`#${invoice.invoiceNumber}`, M, 34, { width: W - M * 2, align: "right" });
    doc.fillColor("rgba(255,255,255,0.65)").font("Helvetica").fontSize(8)
      .text(
        new Date(invoice.createdAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" }),
        M, 60, { width: W - M * 2, align: "right" },
      );

    // ── Client + meta ─────────────────────────────────────────────────────────
    let y = 116;
    doc.fillColor(C).font("Helvetica-Bold").fontSize(8).text("FACTURADO A", M, y);
    y += 14;
    if (client) {
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(12).text(client.name, M, y); y += 16;
      if (client.company) { doc.fillColor(MID).font("Helvetica").fontSize(9).text(client.company, M, y); y += 13; }
      doc.fillColor(MID).font("Helvetica").fontSize(9).text(client.email, M, y); y += 13;
      if (client.phone) { doc.text(client.phone, M, y); y += 13; }
    } else {
      doc.fillColor(MID).font("Helvetica").fontSize(9).text("Sin cliente asociado", M, y); y += 13;
    }

    // Right meta
    const ry = 116;
    doc.fillColor(C).font("Helvetica-Bold").fontSize(8).text("ESTADO", W - M - 160, ry, { width: 160, align: "right" });
    const statusLabel = STATUS_LABELS[invoice.status] ?? invoice.status;
    const statusColor = invoice.status === "paid" ? GREEN : (invoice.status === "overdue" ? "#dc2626" : DARK);
    doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(11)
      .text(statusLabel, W - M - 160, ry + 14, { width: 160, align: "right" });

    if (invoice.dueDate) {
      doc.fillColor(C).font("Helvetica-Bold").fontSize(8)
        .text("VENCIMIENTO", W - M - 160, ry + 38, { width: 160, align: "right" });
      doc.fillColor(DARK).font("Helvetica").fontSize(9)
        .text(new Date(invoice.dueDate).toLocaleDateString("es-ES"), W - M - 160, ry + 52, { width: 160, align: "right" });
    }

    if (invoice.paidAt) {
      const offsetY = invoice.dueDate ? 76 : 38;
      doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(8)
        .text("FECHA DE PAGO", W - M - 160, ry + offsetY, { width: 160, align: "right" });
      doc.fillColor(GREEN).font("Helvetica").fontSize(9)
        .text(new Date(invoice.paidAt).toLocaleDateString("es-ES"), W - M - 160, ry + offsetY + 14, { width: 160, align: "right" });
    }

    // ── Divider ───────────────────────────────────────────────────────────────
    y = Math.max(y, ry + 90) + 10;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 16;

    // ── Items table ───────────────────────────────────────────────────────────
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

    items.forEach((item, i) => {
      const bg = i % 2 === 0 ? WHITE : LIGHT;
      doc.rect(M, y, tableW, rowH).fill(bg);
      doc.fillColor(DARK).font("Helvetica").fontSize(8)
        .text(item.description, colDesc + 5, y + 7, { width: 270, lineBreak: false });
      doc.text(String(item.quantity), colQty, y + 7, { width: 65, align: "center" });
      doc.text(fmt(item.unitPrice, invoice.currency), colPrice, y + 7, { width: 75, align: "right" });
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(8)
        .text(fmt(item.total, invoice.currency), colTotal, y + 7, { width: 85, align: "right" });
      y += rowH;
    });

    doc.rect(M, y - items.length * rowH - rowH, tableW, items.length * rowH + rowH)
      .strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 12;

    // ── Totals ─────────────────────────────────────────────────────────────────
    const totX = W - M - 230;
    const totW = 230;

    const drawRow = (label: string, value: string, bold = false, bg?: string, textColor?: string) => {
      if (bg) doc.rect(totX, y, totW, 24).fill(bg);
      const col = textColor ?? (bg === C ? WHITE : DARK);
      doc.fillColor(col).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9)
        .text(label, totX + 8, y + 7, { width: 120 });
      doc.fillColor(col).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9)
        .text(value, totX + 8, y + 7, { width: totW - 16, align: "right" });
      y += 24;
    };

    drawRow("Subtotal:", fmt(invoice.subtotal, invoice.currency));
    drawRow(`IVA (${invoice.taxRate}%):`, fmt(invoice.taxAmount, invoice.currency));
    doc.moveTo(totX, y).lineTo(totX + totW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 2;
    drawRow("TOTAL:", fmt(invoice.total, invoice.currency), true, C);

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (invoice.notes) {
      y += 16;
      doc.rect(M, y, W - M * 2, 8).fill(C);
      y += 8;
      doc.fillColor(C).font("Helvetica-Bold").fontSize(8).text("NOTAS", M + 5, y + 5);
      y += 18;
      doc.fillColor(MID).font("Helvetica").fontSize(8)
        .text(invoice.notes, M, y, { width: W - M * 2 });
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = H - 45;
    doc.rect(0, footerY - 1, W, 46).fill(LIGHT);
    doc.moveTo(0, footerY - 1).lineTo(W, footerY - 1).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fillColor(MID).font("Helvetica").fontSize(7.5)
      .text(
        `Factura #${invoice.invoiceNumber} · Generada por OmniTech Core · Documento con validez fiscal`,
        M, footerY + 10, { width: W - M * 2, align: "center" },
      );

    doc.end();
  });
}
