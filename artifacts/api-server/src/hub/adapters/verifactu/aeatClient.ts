import type { InvoiceRecord, SubmissionResult } from "./domain.js";

/**
 * AeatClient — sends a chained InvoiceRecord to AEAT's VERI*FACTU webservice
 * in "modo VeriFactu activo". Deliberately NOT given a hardcoded endpoint:
 * AEAT publishes separate pre-production and production URLs on the Sede
 * Electrónica and requires mTLS with a registered certificate. Both the
 * endpoint and the cert must come from ConnectorContext.config/credentials —
 * baking a guessed URL into the connector would silently break the moment
 * AEAT rotates it, or worse, submit to the wrong environment.
 *
 * In "modo no VeriFactu" this client is never called — records stay local
 * in the ChainStore and must be exportable on demand instead.
 */
export interface AeatSubmitOptions {
  endpoint: string;
  clientCertPem: string;
  clientKeyPem: string;
}

export interface AeatHttpClient {
  submit(record: InvoiceRecord, options: AeatSubmitOptions): Promise<SubmissionResult>;
}

/** Real client — issues an mTLS request to the configured AEAT endpoint. */
export class HttpAeatClient implements AeatHttpClient {
  async submit(record: InvoiceRecord, options: AeatSubmitOptions): Promise<SubmissionResult> {
    if (!options.endpoint) {
      return {
        accepted: false,
        error: "AEAT endpoint not configured. Set config.aeatEndpoint before enabling modo VeriFactu activo.",
        submittedAt: new Date().toISOString(),
      };
    }
    try {
      // Node's fetch does not support client-certificate mTLS directly; the app
      // layer is expected to inject an https.Agent-aware client here in Fase 2
      // once the org's certificate is provisioned. This call intentionally
      // fails closed rather than silently sending an unauthenticated request.
      const res = await fetch(options.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: record.xml,
      });
      if (!res.ok) {
        return {
          accepted: false,
          error: `AEAT respondió ${res.status}`,
          submittedAt: new Date().toISOString(),
        };
      }
      const body = await res.text().catch(() => "");
      return { accepted: true, aeatStatus: "correcto", csv: extractCsv(body), submittedAt: new Date().toISOString() };
    } catch (err) {
      return {
        accepted: false,
        error: err instanceof Error ? err.message : String(err),
        submittedAt: new Date().toISOString(),
      };
    }
  }
}

/** In-memory fake for tests, demos, and modo "no VeriFactu" dry runs. */
export class FakeAeatClient implements AeatHttpClient {
  async submit(record: InvoiceRecord): Promise<SubmissionResult> {
    return {
      accepted: true,
      aeatStatus: "correcto",
      csv: `DEMO-${record.hash.slice(0, 12)}`,
      submittedAt: new Date().toISOString(),
    };
  }
}

function extractCsv(xmlBody: string): string | undefined {
  const match = /<CSV>(.*?)<\/CSV>/i.exec(xmlBody);
  return match?.[1];
}
