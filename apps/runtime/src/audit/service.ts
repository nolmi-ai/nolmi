import { nanoid } from "nanoid";
import type { AuditEntry, AuditStatus } from "@twin-lab/shared";
import type { AuditRepository } from "../repository/types.js";
import type { EventBus } from "../events/bus.js";

// ─── AUDIT SERVICE ───────────────────────────────────────────────────────────
//
// Wrapper um das Audit-Repository: erzeugt IDs, stempelt twin_id, schreibt
// Events auf den Bus. Eine Instanz pro Twin (Phase 2.5d Multi-Twin) — die
// twin_id im Constructor wird auf alle neu angelegten Entries gestempelt.
//
// Jede Twin-Aktion durchläuft:
//   start()    → status: pending oder approved
//   complete() → status: executed (mit output)
//   fail()     → status: failed
//   reject()   → status: rejected (vom Mensch abgelehnt)
//   block()    → status: blocked (Mandate-Verstoß)
//
// `repo` ist bewusst public, damit höhere Schichten direkt lesen können,
// ohne den Service mit Read-Methoden zu überfrachten.

export class AuditService {
  constructor(
    public readonly repo: AuditRepository,
    private bus: EventBus,
    private readonly twinId: string,
  ) {}

  async start(opts: {
    capability: string;
    mandateId: string | null;
    input: Record<string, unknown>;
    initialStatus?: AuditStatus;
    /**
     * #71b/#80: Verknüpfung zur conversations-Tabelle. In Sub-Schritt B nur
     * aus dem Direct-Chat-Pfad (`owner-direct`) gesetzt. Andere Capabilities
     * bleiben mit `null`.
     */
    conversationId?: string | null;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: `audit_${nanoid(12)}`,
      twinId: this.twinId,
      timestamp: new Date().toISOString(),
      capability: opts.capability,
      mandateId: opts.mandateId,
      status: opts.initialStatus ?? "approved",
      input: opts.input,
      output: null,
      reason: null,
      conversationId: opts.conversationId ?? null,
    };
    await this.repo.append(entry);
    this.bus.emit({ type: "audit.created", payload: entry });
    // 2.5.4.3: gezieltes Event für Inbox-Badge — nur bei tatsächlichem Pending,
    // damit das Frontend nicht jeden audit.created auf Status filtern muss.
    if (entry.status === "pending") {
      this.bus.emit({
        type: "pending-added",
        payload: { auditId: entry.id, capability: entry.capability },
      });
    }
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
    this.maybeResolvePending(existing.status, updated);
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
    this.maybeResolvePending(existing.status, updated);
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
    this.maybeResolvePending(existing.status, updated);
    return updated;
  }

  /**
   * Sendet pending-resolved nur, wenn der Eintrag VORHER pending war.
   * Verhindert Phantom-Decrements: ein executed→failed darf den Inbox-Badge
   * nicht doppelt verändern, weil der Eintrag nie als pending gezählt wurde.
   */
  private maybeResolvePending(prevStatus: AuditStatus, updated: AuditEntry): void {
    if (prevStatus !== "pending") return;
    this.bus.emit({
      type: "pending-resolved",
      payload: { auditId: updated.id, status: updated.status },
    });
  }

  async markRead(id: string): Promise<void> {
    await this.repo.markRead(id);
  }

  async block(opts: {
    capability: string;
    input: Record<string, unknown>;
    reason: string;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: `audit_${nanoid(12)}`,
      twinId: this.twinId,
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
