import { Resend } from "resend";

let _client: Resend | null = null;

function getResend(): Resend | null {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return null;
  if (!_client) _client = new Resend(apiKey);
  return _client;
}

export interface PortalEmailParams {
  to:        string;
  clientName: string;
  orgName:   string;
  portalUrl: string;
  expiresAt: Date;
}

export async function sendPortalEmail(p: PortalEmailParams): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Email] RESEND_API_KEY no configurado — email de portal omitido.");
    return false;
  }

  const from   = process.env["EMAIL_FROM"] ?? "OmniTech Core <onboarding@resend.dev>";
  const expStr = p.expiresAt.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  await resend.emails.send({
    from,
    to:      p.to,
    subject: `${p.orgName} te ha enviado acceso a tu portal de facturas`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#1a1f2e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:inline-block;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:12px;padding:14px;margin-bottom:16px;">
        <span style="font-size:28px;line-height:1;">⬡</span>
      </div>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 4px;">
        OmniTech <span style="color:#3b82f6;">Core</span>
      </h1>
      <p style="color:#64748b;font-size:13px;margin:0;">Portal de cliente</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 8px;">
        Hola, <strong style="color:#e2e8f0;">${p.clientName}</strong> 👋
      </p>
      <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 28px;">
        <strong style="color:#e2e8f0;">${p.orgName}</strong> te ha dado acceso a tu portal personal donde puedes consultar y descargar todas tus facturas.
      </p>

      <a href="${p.portalUrl}"
         style="display:block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;text-decoration:none;text-align:center;padding:15px 24px;border-radius:10px;font-weight:600;font-size:15px;margin:0 0 28px;letter-spacing:0.01em;">
        Acceder a mi portal →
      </a>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;">
        <p style="color:#475569;font-size:12px;margin:0 0 6px;">
          ⏰ Este enlace es válido hasta el <strong style="color:#64748b;">${expStr}</strong>.
        </p>
        <p style="color:#334155;font-size:12px;margin:0;">
          Si no esperabas este mensaje, puedes ignorarlo sin problema.
        </p>
      </div>
    </div>

  </div>
</body>
</html>`,
  });

  return true;
}

export interface InvitationEmailParams {
  to:          string;
  inviterName: string | null;
  orgName:     string;
  role:        string;
  acceptUrl:   string;
  expiresAt:   Date;
}

export async function sendInvitationEmail(p: InvitationEmailParams): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn(
      "[Email] RESEND_API_KEY no configurado — email de invitación omitido. " +
      "Establece RESEND_API_KEY y EMAIL_FROM para habilitar el envío.",
    );
    return;
  }

  const from      = process.env["EMAIL_FROM"] ?? "OmniTech Core <onboarding@resend.dev>";
  const roleLabel = p.role === "admin" ? "Administrador" : "Miembro";
  const expStr    = p.expiresAt.toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric",
  });

  await resend.emails.send({
    from,
    to: p.to,
    subject: `${p.inviterName ?? "Tu equipo"} te invita a unirte a ${p.orgName} en OmniTech Core`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#1a1f2e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:inline-block;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:12px;padding:14px;margin-bottom:16px;">
        <span style="font-size:28px;line-height:1;">⬡</span>
      </div>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 4px;">
        OmniTech <span style="color:#3b82f6;">Core</span>
      </h1>
      <p style="color:#64748b;font-size:13px;margin:0;">Plataforma de automatización con IA</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 8px;">
        Hola 👋
      </p>
      <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 28px;">
        <strong style="color:#e2e8f0;">${p.inviterName ?? "Tu equipo"}</strong>
        te ha invitado a unirte a
        <strong style="color:#e2e8f0;">${p.orgName}</strong>
        en OmniTech Core como
        <span style="color:#3b82f6;font-weight:600;">${roleLabel}</span>.
      </p>

      <a href="${p.acceptUrl}"
         style="display:block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;text-decoration:none;text-align:center;padding:15px 24px;border-radius:10px;font-weight:600;font-size:15px;margin:0 0 28px;letter-spacing:0.01em;">
        Aceptar invitación →
      </a>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;">
        <p style="color:#475569;font-size:12px;margin:0 0 6px;">
          ⏰ Esta invitación expira el <strong style="color:#64748b;">${expStr}</strong>.
        </p>
        <p style="color:#334155;font-size:12px;margin:0;">
          Si no esperabas esta invitación, puedes ignorar este correo sin problema.
        </p>
      </div>
    </div>

  </div>
</body>
</html>`,
  });
}
