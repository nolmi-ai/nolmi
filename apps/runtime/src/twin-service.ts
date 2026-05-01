import type { ChatMessage, Persona } from "@twin-lab/shared";
import type { ModelProvider } from "./providers/index.js";
import type { MandateRepository, PersonaRepository } from "./repository/types.js";
import { checkMandate } from "./mandates/service.js";
import { AuditService } from "./audit/service.js";
import type { EventBus } from "./events/bus.js";

// ─── TWIN SERVICE ────────────────────────────────────────────────────────────
//
// Zentrale Orchestrierung. Jede vom User ausgelöste Twin-Aktion durchläuft
// hier die folgenden Schritte:
//
//   1. Capability Detection      → was will der User vom Twin?
//   2. Mandate-Check              → darf der Twin das überhaupt?
//   3. Escalation-Check           → läuft die Aktion auto oder pending?
//   4. Audit-Eintrag (start)      → was wird gerade getan, mit welchem Mandate?
//   5. Provider-Call (oder skip)  → bei pending: erst nach Approval
//   6. Audit-Eintrag (complete)   → das Ergebnis wird festgehalten

export interface TwinServiceDeps {
  provider: ModelProvider;
  audit: AuditService;
  bus: EventBus;
  personaRepo: PersonaRepository;
  mandateRepo: MandateRepository;
}

export class TwinService {
  constructor(private deps: TwinServiceDeps) {}

  async chat(
    messages: ChatMessage[],
  ): Promise<{ message: ChatMessage | null; auditId: string; pending: boolean }> {
    // 1. Capability detecten
    const lastUser = messages.at(-1)?.content ?? "";
    const capability = detectCapability(lastUser);

    // 2. Mandate-Check
    const check = await checkMandate(this.deps.mandateRepo, capability);
    if (!check.allowed) {
      const blocked = await this.deps.audit.block({
        capability,
        input: { messages },
        reason: check.reason ?? "Mandate check failed",
      });
      throw new Error(`Twin blocked: ${blocked.reason}`);
    }

    const persona = await this.deps.personaRepo.get();
    if (!persona) {
      throw new Error("Persona not initialized — run db:init first");
    }

    // 3. Escalation-Check: läuft auto oder bleibt pending?
    const isPending = check.mandate?.escalation === "always_pending";

    // 4. Audit öffnen — mit pending-Status, falls Escalation greift
    const audit = await this.deps.audit.start({
      capability,
      mandateId: check.mandate?.id ?? null,
      input: {
        messages,
        lastMessage: lastUser,
      },
      initialStatus: isPending ? "pending" : "approved",
    });

    if (isPending) {
      // Pending: kein Modell-Call jetzt. Aktion wartet auf Approval.
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return { message: null, auditId: audit.id, pending: true };
    }

    // 5. Auto: direkt zum Modell
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability } });
    try {
      const reply = await this.runModel(persona, messages);
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        message: { role: "assistant", content: reply.content },
        auditId: audit.id,
        pending: false,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.deps.audit.fail(audit.id, reason);
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      throw err;
    }
  }

  // ─── Approve & Reject ──────────────────────────────────────────────────────
  //
  // Werden vom Server-Layer aufgerufen, wenn der Mensch in Settings auf
  // Approve oder Reject klickt.

  async approvePending(
    auditId: string,
  ): Promise<{ message: ChatMessage; auditId: string }> {
    const entry = await this.deps.audit.repo.get(auditId);
    if (!entry) throw new Error(`Audit ${auditId} not found`);
    if (entry.status !== "pending") {
      throw new Error(`Audit ${auditId} is not pending (status: ${entry.status})`);
    }

    const persona = await this.deps.personaRepo.get();
    if (!persona) throw new Error("Persona not initialized");

    const messages = (entry.input as { messages?: ChatMessage[] }).messages ?? [];
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error(`Audit ${auditId} has no messages in input`);
    }

    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, messages);
      await this.deps.audit.complete(auditId, {
        reply: reply.content,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        message: { role: "assistant", content: reply.content },
        auditId,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.deps.audit.fail(auditId, reason);
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      throw err;
    }
  }

  async rejectPending(auditId: string, reason: string): Promise<void> {
    const entry = await this.deps.audit.repo.get(auditId);
    if (!entry) throw new Error(`Audit ${auditId} not found`);
    if (entry.status !== "pending") {
      throw new Error(`Audit ${auditId} is not pending (status: ${entry.status})`);
    }
    await this.deps.audit.reject(auditId, reason);
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private async runModel(persona: Persona, messages: ChatMessage[]) {
    const fullMessages = withPersona(persona, messages);
    return this.deps.provider.complete({ messages: fullMessages });
  }
}

function withPersona(persona: Persona, messages: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: persona.systemPrompt }, ...messages];
}

// ─── CAPABILITY DETECTION ────────────────────────────────────────────────────
//
// Phase 1: simpler Keyword-Match.
// Phase 2+: könnte das Modell selbst übernehmen oder ein eigener Detector-Pass.

function detectCapability(userMessage: string): string {
  const lower = userMessage.toLowerCase();

  // LinkedIn-Drafts: bewusst eng triggern, damit nicht jede Frage zu LinkedIn
  // versehentlich pending wird.
  const isLinkedInDraft =
    (lower.includes("linkedin") || lower.includes("li-post") || lower.includes("li post")) &&
    (lower.includes("draft") ||
      lower.includes("entwurf") ||
      lower.includes("schreib mir") ||
      lower.includes("schreib einen") ||
      lower.includes("formulier") ||
      lower.includes("post zu") ||
      lower.includes("post über"));

  if (isLinkedInDraft) return "draft_linkedin_post";

  // Zusammenfassungen
  const isSummary =
    lower.includes("fass zusammen") ||
    lower.includes("zusammenfassung") ||
    lower.includes("summarize");

  if (isSummary) return "summarize_topic";

  // Default: normale Chat-Antwort
  return "respond_to_chat";
}