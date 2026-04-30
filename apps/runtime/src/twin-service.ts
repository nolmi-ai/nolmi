import type { ChatMessage, Persona } from "@twin-lab/shared";
import type { ModelProvider } from "./providers/index.js";
import type { MandateRepository, PersonaRepository } from "./repository/types.js";
import { checkMandate } from "./mandates/service.js";
import { AuditService } from "./audit/service.js";
import type { EventBus } from "./events/bus.js";

// ─── TWIN SERVICE ────────────────────────────────────────────────────────────
//
// Zentrale Orchestrierung. Jede vom User ausgelöste Twin-Aktion durchläuft
// hier die gleichen vier Schritte:
//
//   1. Mandate-Check          → darf der Twin das überhaupt?
//   2. Audit-Eintrag (start)  → was wird gerade getan, mit welchem Mandate?
//   3. Provider-Call          → das Modell antwortet
//   4. Audit-Eintrag (complete) → das Ergebnis wird festgehalten
//
// In Phase 1 gibt es genau eine Capability: "respond_to_chat".
// In Phase 2 kommen weitere dazu (draft_post, summarize_inbox, etc.).

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
  ): Promise<{ message: ChatMessage; auditId: string }> {
    const capability = "respond_to_chat";

    // 1. Mandate-Check
    const check = await checkMandate(this.deps.mandateRepo, capability);
    if (!check.allowed) {
      const blocked = await this.deps.audit.block({
        capability,
        input: { messages },
        reason: check.reason ?? "Mandate check failed",
      });
      throw new Error(`Twin blocked: ${blocked.reason}`);
    }

    // 2. Persona laden
    const persona = await this.deps.personaRepo.get();
    if (!persona) {
      throw new Error("Persona not initialized — run db:init first");
    }

    // 3. Audit-Eintrag öffnen + thinking-Event
    const audit = await this.deps.audit.start({
      capability,
      mandateId: check.mandate?.id ?? null,
      input: { lastMessage: messages.at(-1)?.content ?? "" },
    });
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability } });

    // 4. Provider-Call
    try {
      const fullMessages = withPersona(persona, messages);
      const response = await this.deps.provider.complete({
        messages: fullMessages,
      });

      const reply: ChatMessage = { role: "assistant", content: response.content };

      await this.deps.audit.complete(audit.id, {
        reply: response.content,
        providerMetadata: response.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });

      return { message: reply, auditId: audit.id };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.deps.audit.fail(audit.id, reason);
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      throw err;
    }
  }
}

function withPersona(persona: Persona, messages: ChatMessage[]): ChatMessage[] {
  // Wenn der Caller selbst eine system-Message mitschickt, behalten wir sie.
  // Die Persona-System-Message wird als erste vorangestellt.
  return [{ role: "system", content: persona.systemPrompt }, ...messages];
}
