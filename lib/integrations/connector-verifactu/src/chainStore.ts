import type { InvoiceRecord } from "./domain.js";

/**
 * ChainStore — where the per-org sequence of InvoiceRecords lives.
 * The Core forbids the Core itself from touching the DB directly; this
 * connector package defines the seam, and the app layer supplies a real
 * Postgres-backed implementation when wiring the connector into
 * connectors/manifest.ts. InMemoryChainStore exists for tests, demos, and
 * the CLI dry-run path.
 */
export interface ChainStore {
  getLastRecord(orgId: number): Promise<InvoiceRecord | null>;
  append(orgId: number, record: InvoiceRecord): Promise<void>;
  list(orgId: number): Promise<InvoiceRecord[]>;
}

export class InMemoryChainStore implements ChainStore {
  private chains = new Map<number, InvoiceRecord[]>();

  async getLastRecord(orgId: number): Promise<InvoiceRecord | null> {
    const chain = this.chains.get(orgId);
    return chain && chain.length > 0 ? chain[chain.length - 1] : null;
  }

  async append(orgId: number, record: InvoiceRecord): Promise<void> {
    const chain = this.chains.get(orgId) ?? [];
    chain.push(record);
    this.chains.set(orgId, chain);
  }

  async list(orgId: number): Promise<InvoiceRecord[]> {
    return this.chains.get(orgId) ?? [];
  }
}
