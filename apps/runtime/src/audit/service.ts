import { nanoid } from "nanoid";
import type { AuditEntry, AuditStatus } from "@twin-lab/shared";
import type { AuditRepository } from "../repository/types.js";
import type { EventBus } from "../events/bus.js";

// ─── AUDIT SERVICE ───────────────────────────────────────────────────────────
//
// Wrapper um das Audit-Repository: erzeugt IDs, schreibt Events auf den Bus.
// Jede Twin-Aktion durchläuft:
//   start()    → status: pending oder approved
//   complete() → status: executed (mit output)
//   fail()     → status: failed
//   reject()   → status: rejected (vom Mensch abgelehnt)
//   block()    → status: blocked (Mandate-Verstoß)
//
// `repo` ist bewusst public, damit höhere Schichten (z.B. Twin-Service)
// direkt lesen können, ohne den Service mit Read-Methoden zu überfrachten.

export class AuditService {
  constructor(
    public readonly repo: AuditRepository,
    private bus: EventBus,
  ) {}

  async start(opts: {
    capability: string;
    mandateId: string | null;
    input: Record<string, unknown>;
    initialStatus?: AuditStatus;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: `audit_${nanoid(12)}`,
      timestamp: new Date().toISOString(),
      capability: opts.capability,
      mandateId: opts.mandateId,
      status: opts.initialStatus ?? "approved",
      input: opts.input,
      output: null,
      reason: null,
    };
    await this.repo.append(entry);
    this.bus.emit({ type: "audit.created", payload: entry });
    return entry;
  }

  async complete(id: string, output: Record<string, unknown>): Promise<AuditEntry> {
    const existing = await this.repo.get(id);
    if (!existing) throw new Error(`Audit entry ${id} not found`);

    const updated: AuditEntry = {
      ...existing,
      status: "executed",
      output,
      timestamp: new Date().toISOString(),
    };
    await this.repo.update(id, updated);
    this.bus.emit({ type: "audit.updated", payload: updated });
    return updated;
  }

  async fail(id: string, reason: string): Promise<AuditEntry> {
    const existing = await this.repo.get(id);
    if (!existing) throw new Error(`Audit entry ${id} not found`);

    const updated: AuditEntry = {
      ...existing,
      status: "failed",
      reason,
      timestamp: new Date().toISOString(),
    };
    await this.repo.update(id, updated);
    this.bus.emit({ type: "audit.updated", payload: updated });
    return updated;
  }

  async reject(id: string, reason: string): Promise<AuditEntry> {
    const existing = await this.repo.get(id);
    if (!existing) throw new Error(`Audit entry ${id} not found`);

    const updated: AuditEntry = {
      ...existing,
      status: "rejected",
      reason,
      timestamp: new Date().toISOString(),
    };
    await this.repo.update(id, updated);
    this.bus.emit({ type: "audit.updated", payload: updated });
    return updated;
  }

  async block(opts: {
    capability: string;
    input: Record<string, unknown>;
    reason: string;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: `audit_${nanoid(12)}`,
      timestamp: new Date().toISOString(),
      capability: opts.capability,
      mandateId: null,
      status: "blocked",
      input: opts.input,
      output: null,
      reason: opts.reason,
    };
    await this.repo.append(entry);
    this.bus.emit({ type: "audit.created", payload: entry });
    return entry;
  }
}