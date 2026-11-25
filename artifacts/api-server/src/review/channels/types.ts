// Contrato de canal. El motor de campañas SOLO conoce esta interfaz: añadir SMS (u otro canal) =
// un fichero nuevo que la implemente + registrarlo + ampliar el CHECK de canales, sin tocar el motor.
import type { ReviewChannel } from "@workspace/db";

export interface SendRequest {
  orgId: number; messageId: number;
  to: string;                                   // email o E.164 (ya validado por el guard)
  contactName: string | null; service: string | null;
  location: { name: string };
  template: { id: number; subject: string | null; body: string; waTemplateName: string | null; waLanguage: string | null; waStatus: string | null };
  links: { review: string; unsubscribe: string };
  sender: { name: string; legalName: string | null; taxId: string | null; address: string | null };
}

export type SendOutcome =
  | { ok: true; providerMessageId: string | null }
  | {
      ok: false;
      /** true = error transitorio, se reintenta con espera creciente. */
      retryable: boolean;
      code: string; message: string;
      /** true = problema de configuración/credenciales: se PAUSA la campaña para no gastar más intentos. */
      fatal?: boolean;
      /** true = el proveedor dice que el destino no existe/no recibe: el contacto pasa a «invalid». */
      invalidDestination?: boolean;
    };

export interface ChannelLimits { maxPerMinute: number; maxPerDay: number | null }

export interface ChannelProvider {
  readonly channel: ReviewChannel;
  readonly providerId: string;
  readonly limits: ChannelLimits;
  /** ¿Está listo para enviar para esta empresa? (credenciales, plantilla aprobada…). Devuelve el motivo si no. */
  readiness(orgId: number, template: SendRequest["template"]): Promise<{ ready: true } | { ready: false; reason: string }>;
  send(req: SendRequest): Promise<SendOutcome>;
}
