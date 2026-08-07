import type { InvoiceRecord } from "./domain.js";

/**
 * ChainStore — where the per-org sequence of InvoiceRecords lives.
 * The hub's adapters never touch the DB directly; this interface is the
 * seam, and the app layer supplies a real Postgres-backed implementation
 * (see artifacts/api-server/src/services/verifactuChainStore.ts) when
 * wiring the adapter in hub/adapters/verifactuAdapter.ts. InMemoryChainStore
 * exists for tests and demos.
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
