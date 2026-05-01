import type { AuditEntry, ChatMessage, Mandate, Persona } from "@twin-lab/shared";
import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { checkMandate } from "./mandates/service.js";
import { AuditService } from "./audit/service.js";
import type { EventBus } from "./events/bus.js";
import type { BridgeClient } from "./bridge/client.js";
import { BridgeError } from "./bridge/client.js";
import type { BridgeMessage } from "./bridge/types.js";

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
//   6. Audit-Eintrap (complete)   → das Ergebnis wird festgehalten
//
// Phase 2 ergänzt zwei Bridge-Capabilities:
//   - send_to_twin            → ausgehende Nachricht an anderen Twin
//   - respond_to_twin_message → eingehende Bridge-Nachricht beantworten
// Beide laufen IMMER über always_pending: kein Twin schreibt einem anderen
// Twin ohne explizite Approval.

export interface TwinServiceDeps {
  /** Twin-ID aus dem Profil, für Audit-Filter und Logs. */
  twinId: string;
  /** Vercel-AI-SDK-LanguageModel — siehe `llm-client.ts`. */
  model: LanguageModel;
  /** Kompaktes Label "<provider>/<model>", landet in Audit-Metadata. */
  modelLabel: string;
  audit: AuditService;
  bus: EventBus;
  /** Persona kommt aus `twin_profiles.persona_md` + `display_name`/`handle`. */
  persona: Persona;
  /** Mandates kommen aus `twin_profiles.mandates_json` als in-memory Array. */
  mandates: Mandate[];
  bridgeClient?: BridgeClient | null;
}

export interface ApproveResult {
  auditId: string;
  message?: ChatMessage;
  reply?: string;
  sentMessageId?: string;
  targetHandle?: string;
}

export class TwinService {
  constructor(private deps: TwinServiceDeps) {}

  /**
   * Bridge-Client nach dem Service-Start nachreichen. Boot-Reihenfolge will
   * Server zuerst hochziehen (für den Logger), dann Bridge — und dabei muss
   * der TwinService schon stehen, damit `receiveBridgeMessage` ihn nutzen kann.
   */
  setBridgeClient(client: BridgeClient | null): void {
    this.deps.bridgeClient = client;
  }

  async chat(
    messages: ChatMessage[],
  ): Promise<{ message: ChatMessage | null; auditId: string; pending: boolean }> {
    // 1. Capability detecten
    const lastUser = messages.at(-1)?.content ?? "";
    const detection = detectCapability(lastUser);

    // 2. Mandate-Check
    const check = checkMandate(this.deps.mandates, detection.capability);
    if (!check.allowed) {
      const blocked = await this.deps.audit.block({
        capability: detection.capability,
        input: { messages },
        reason: check.reason ?? "Mandate check failed",
      });
      throw new Error(`Twin blocked: ${blocked.reason}`);
    }

    // Bridge-only Capability ohne aktive Bridge → früh blocken, sonst landet
    // ein Pending-Audit in der Queue, das man nie approven kann.
    if (detection.capability === "send_to_twin" && !this.deps.bridgeClient) {
      const blocked = await this.deps.audit.block({
        capability: detection.capability,
        input: { messages, targetHandle: detection.targetHandle },
        reason: "Bridge-Modus ist nicht aktiv",
      });
      throw new Error(`Twin blocked: ${blocked.reason}`);
    }

    const persona = this.deps.persona;

    // 3. Escalation-Check: läuft auto oder bleibt pending?
    const isPending = check.mandate?.escalation === "always_pending";

    // 4. Audit öffnen — Capability-spezifischer Input.
    const baseInput: Record<string, unknown> = {
      messages,
      lastMessage: lastUser,
    };
    if (detection.capability === "send_to_twin") {
      baseInput.targetHandle = detection.targetHandle;
    }
    const audit = await this.deps.audit.start({
      capability: detection.capability,
      mandateId: check.mandate?.id ?? null,
      input: baseInput,
      initialStatus: isPending ? "pending" : "approved",
    });

    if (isPending) {
      // Pending: kein Modell-Call jetzt. Aktion wartet auf Approval.
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return { message: null, auditId: audit.id, pending: true };
    }

    // 5. Auto: direkt zum Modell
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: detection.capability } });
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

  // ─── Bridge-Empfang ────────────────────────────────────────────────────────
  //
  // Wird sowohl vom Inbox-Sync beim Boot als auch live vom SSE-Stream
  // aufgerufen. Erzeugt einen Pending-Audit pro Bridge-Nachricht, ackt die
  // Nachricht bei der Bridge und benachrichtigt die UI per EventBus.
  //
  // Idempotent: gleiche bridgeMessageId → silent return.

  async receiveBridgeMessage(msg: BridgeMessage): Promise<void> {
    if (!this.deps.bridgeClient) {
      // Sollte nie passieren, weil receiveBridgeMessage nur im Bridge-Modus
      // gecallt wird. Defensive Sanity-Check.
      throw new Error("receiveBridgeMessage ohne aktiven BridgeClient aufgerufen");
    }

    const existing = await this.deps.audit.repo.findByInputField(
      "bridgeMessageId",
      msg.id,
      { twinId: this.deps.twinId },
    );
    if (existing) {
      return;
    }

    const check = checkMandate(this.deps.mandates, "respond_to_twin_message");
    // Auch ohne Mandate erfassen wir die Nachricht — als blocked. So sieht der
    // User im Audit-Log, dass jemand geschrieben hat, kann aber nicht antworten
    // ohne erst das Mandate zu setzen.
    if (!check.allowed) {
      await this.deps.audit.block({
        capability: "respond_to_twin_message",
        input: {
          bridgeMessageId: msg.id,
          fromHandle: msg.fromHandle,
          content: msg.content,
          inReplyTo: msg.inReplyTo,
        },
        reason: check.reason ?? "Kein Mandate für respond_to_twin_message",
      });
      // Trotzdem ackn — sonst spammt die Bridge uns endlos die gleiche Message.
      await this.safeAck(msg.id);
      return;
    }

    const audit = await this.deps.audit.start({
      capability: "respond_to_twin_message",
      mandateId: check.mandate?.id ?? null,
      input: {
        bridgeMessageId: msg.id,
        fromHandle: msg.fromHandle,
        content: msg.content,
        inReplyTo: msg.inReplyTo,
      },
      initialStatus: "pending",
    });

    await this.safeAck(msg.id);

    this.deps.bus.emit({
      type: "bridge.message.received",
      payload: { auditId: audit.id, fromHandle: msg.fromHandle },
    });
  }

  // ─── Approve & Reject ──────────────────────────────────────────────────────
  //
  // Werden vom Server-Layer aufgerufen, wenn der Mensch in Settings auf
  // Approve oder Reject klickt. Verhalten je nach Capability unterschiedlich:
  //   - respond_to_twin_message → Modell antwortet, Reply geht über Bridge
  //   - send_to_twin            → Modell formuliert, Nachricht geht über Bridge
  //   - sonst (z.B. draft_…)    → Modell antwortet, Reply landet im Audit

  async approvePending(auditId: string): Promise<ApproveResult> {
    const entry = await this.deps.audit.repo.get(auditId);
    if (!entry) throw new Error(`Audit ${auditId} not found`);
    if (entry.status !== "pending") {
      throw new Error(`Audit ${auditId} is not pending (status: ${entry.status})`);
    }

    const persona = this.deps.persona;

    switch (entry.capability) {
      case "respond_to_twin_message":
        return this.approveTwinResponse(entry, persona);
      case "send_to_twin":
        return this.approveTwinSend(entry, persona);
      default:
        return this.approveDefault(entry, persona);
    }
  }

  async rejectPending(auditId: string, reason: string): Promise<void> {
    const entry = await this.deps.audit.repo.get(auditId);
    if (!entry) throw new Error(`Audit ${auditId} not found`);
    if (entry.status !== "pending") {
      throw new Error(`Audit ${auditId} is not pending (status: ${entry.status})`);
    }
    // Reject ist Capability-agnostisch: bei respond_to_twin_message wird
    // bewusst KEINE Notification an den Absender geschickt — der andere Twin
    // sieht einfach keine Antwort. (Phase 2.5 ggf. optionaler Decline-Hinweis.)
    await this.deps.audit.reject(auditId, reason);
  }

  // ─── Approve-Branches ──────────────────────────────────────────────────────

  private async approveDefault(entry: AuditEntry, persona: Persona): Promise<ApproveResult> {
    const messages = extractMessages(entry, "messages");
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, messages);
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        auditId: entry.id,
        message: { role: "assistant", content: reply.content },
        reply: reply.content,
      };
    } catch (err) {
      await this.failWithReason(entry.id, err);
      throw err;
    }
  }

  private async approveTwinSend(entry: AuditEntry, persona: Persona): Promise<ApproveResult> {
    if (!this.deps.bridgeClient) {
      throw new Error("Bridge-Modus ist nicht aktiv — send_to_twin nicht möglich");
    }
    const targetHandle = (entry.input as { targetHandle?: string }).targetHandle;
    if (!targetHandle) {
      throw new Error(`Audit ${entry.id} hat keinen targetHandle`);
    }
    const messages = extractMessages(entry, "messages");

    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, messages);
      const sent = await this.deps.bridgeClient.sendMessage({
        to: targetHandle,
        content: reply.content,
      });
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        auditId: entry.id,
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle,
      };
    } catch (err) {
      await this.failWithReason(entry.id, err);
      throw err;
    }
  }

  private async approveTwinResponse(
    entry: AuditEntry,
    persona: Persona,
  ): Promise<ApproveResult> {
    if (!this.deps.bridgeClient) {
      throw new Error("Bridge-Modus ist nicht aktiv — respond_to_twin_message nicht möglich");
    }
    const input = entry.input as {
      bridgeMessageId?: string;
      fromHandle?: string;
      content?: string;
    };
    if (!input.fromHandle || !input.content || !input.bridgeMessageId) {
      throw new Error(`Audit ${entry.id} hat unvollständigen Bridge-Input`);
    }

    // Konversations-Thread aus dem Audit-Log rekonstruieren — frühere
    // gesendete und beantwortete Nachrichten zwischen uns und fromHandle, plus
    // die aktuelle eingehende Nachricht ans Ende. Ohne diesen Kontext sieht
    // das Modell nur die aktuelle Message und antwortet kontextlos.
    const thread = await this.buildBridgeThread(entry, input.fromHandle);

    const contextHint =
      `Du führst gerade eine Konversation mit dem Twin ${input.fromHandle} über die Bridge.\n` +
      `Beziehe dich auf den Verlauf. Wenn der andere Twin auf eine deiner früheren\n` +
      `Nachrichten antwortet, geh konkret darauf ein — frag nicht nach dem Worum-geht's,\n` +
      `das weißt du selbst.`;

    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, thread, contextHint);
      const sent = await this.deps.bridgeClient.sendMessage({
        to: input.fromHandle,
        content: reply.content,
        inReplyTo: input.bridgeMessageId,
      });
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle: input.fromHandle,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        auditId: entry.id,
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle: input.fromHandle,
      };
    } catch (err) {
      await this.failWithReason(entry.id, err);
      throw err;
    }
  }

  // ─── private helpers ─────────────────────────────────────────────────────

  /**
   * Ein Modell-Call über das Vercel AI SDK. Persona kommt als top-level
   * `system`-Parameter, der optionale `extraSystem`-Hinweis (z.B.
   * Bridge-Konversations-Kontext) wird vor die Persona gesetzt — gleicher
   * Wirkung wie früher die zwei system-Messages, aber ohne Provider-Splitting.
   *
   * Rückgabe-Shape ist die alte ProviderCompleteOutput, damit die Aufrufer
   * (`approveDefault`, `approveTwinSend`, …) unverändert bleiben.
   */
  private async runModel(
    persona: Persona,
    messages: ChatMessage[],
    extraSystem?: string,
  ): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const system = extraSystem
      ? `${extraSystem}\n\n${persona.systemPrompt}`
      : persona.systemPrompt;

    const result = await generateText({
      model: this.deps.model,
      system,
      messages: toModelMessages(messages),
    });

    return {
      content: result.text,
      metadata: {
        provider: this.deps.modelLabel,
        usage: result.usage,
        finishReason: result.finishReason,
      },
    };
  }

  /**
   * Baut den Konversations-Thread mit einem bestimmten Twin aus den eigenen
   * Audit-Einträgen. Berücksichtigt:
   *   - send_to_twin executed mit output.targetHandle === fromHandle
   *     → eigene gesendete Nachricht (assistant)
   *   - respond_to_twin_message executed mit input.fromHandle === fromHandle
   *     → eingehende Nachricht (user) + unsere Antwort darauf (assistant)
   *
   * Sortierung chronologisch nach Audit-Timestamp; Limit 5 vorherige Einträge,
   * danach die aktuelle Nachricht — macht zusammen genau 6 Messages
   * (3 Roundtrips), wie spezifiziert.
   */
  private async buildBridgeThread(
    current: AuditEntry,
    fromHandle: string,
  ): Promise<ChatMessage[]> {
    type ThreadItem = { ts: string; role: ChatMessage["role"]; content: string };
    const items: ThreadItem[] = [];

    // Pragmatisch: letzte 200 Audits laden und filtern. Bei wachsendem
    // Volumen würde man hier eine indizierte SQL-Query bauen.
    const all = await this.deps.audit.repo.list({ limit: 200 });

    for (const e of all) {
      if (e.id === current.id) continue;
      if (e.status !== "executed") continue;

      if (e.capability === "send_to_twin") {
        const out = e.output as { targetHandle?: string; reply?: string } | null;
        if (out?.targetHandle === fromHandle && typeof out.reply === "string") {
          items.push({ ts: e.timestamp, role: "assistant", content: out.reply });
        }
        continue;
      }

      if (e.capability === "respond_to_twin_message") {
        const inp = e.input as { fromHandle?: string; content?: string };
        if (inp.fromHandle !== fromHandle) continue;
        const out = e.output as { reply?: string } | null;
        if (typeof inp.content === "string") {
          items.push({ ts: e.timestamp, role: "user", content: inp.content });
        }
        if (typeof out?.reply === "string") {
          items.push({ ts: e.timestamp, role: "assistant", content: out.reply });
        }
      }
    }

    // Stable sort: gleicher Timestamp (z.B. user+assistant aus demselben Audit)
    // behält die Push-Reihenfolge, also user vor assistant.
    items.sort((a, b) => a.ts.localeCompare(b.ts));

    // 5 historische Einträge + aktuelle Nachricht = 6 (3 Roundtrips).
    const recent = items.slice(-5);
    recent.push({
      ts: current.timestamp,
      role: "user",
      content: (current.input as { content?: string }).content ?? "",
    });

    return recent.map(({ role, content }) => ({ role, content }));
  }

  private async failWithReason(auditId: string, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    await this.deps.audit.fail(auditId, reason);
    this.deps.bus.emit({ type: "twin.idle", payload: {} });
  }

  private async safeAck(messageId: string): Promise<void> {
    if (!this.deps.bridgeClient) return;
    try {
      await this.deps.bridgeClient.acknowledge(messageId);
    } catch (err) {
      // Ack-Fehler ist nicht fatal — Bridge wird die Nachricht erneut zustellen,
      // und unsere Idempotenz (findByInputField) verhindert Doubletten.
      const msg = err instanceof BridgeError ? err.message : String(err);
      console.warn(`[twin] ack für ${messageId} fehlgeschlagen: ${msg}`);
    }
  }
}

// ─── helpers (modul-lokal) ───────────────────────────────────────────────────

function extractMessages(entry: { input: Record<string, unknown> }, key: string): ChatMessage[] {
  const value = entry.input[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Audit-Input enthält keine "${key}"-Liste`);
  }
  return value as ChatMessage[];
}

/**
 * Konvertiert unser kompakt-internes ChatMessage-Format ins ModelMessage-Shape
 * des Vercel AI SDK. Wir filtern hier defensiv `system`-Rollen heraus — die
 * Persona kommt über den `system`-Parameter von `generateText`, system-Slots
 * im messages-Array sind in der neuen API verboten/redundant.
 */
function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

// ─── CAPABILITY DETECTION ────────────────────────────────────────────────────
//
// Phase 2: erweitert um send_to_twin, das zusätzlich einen targetHandle aus
// dem Text zieht. Weiterhin keyword-basiert; reicht für Phase 2, später kann
// das auch ein eigener Detector-Pass mit Modell sein.

export type CapabilityDetectionResult =
  | { capability: "respond_to_chat" }
  | { capability: "draft_linkedin_post" }
  | { capability: "summarize_topic" }
  | { capability: "send_to_twin"; targetHandle: string };

const KNOWN_HANDLES: Record<string, string> = {
  florian: "@florian",
  markus: "@markus",
  dev: "@dev",
};

export function detectCapability(userMessage: string): CapabilityDetectionResult {
  const lower = userMessage.toLowerCase();

  // 1. send_to_twin: Trigger-Wort + Empfänger erkennbar
  const sendTriggers = ["sende", "schicke", "frag ", "frage ", "schreib", "kontaktier"];
  const hasSendTrigger = sendTriggers.some((t) => lower.includes(t));
  if (hasSendTrigger) {
    const target = detectTargetHandle(userMessage);
    if (target) {
      return { capability: "send_to_twin", targetHandle: target };
    }
  }

  // 2. LinkedIn-Drafts: bewusst eng triggern, damit nicht jede Frage zu LinkedIn
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

  if (isLinkedInDraft) return { capability: "draft_linkedin_post" };

  // 3. Zusammenfassungen
  const isSummary =
    lower.includes("fass zusammen") ||
    lower.includes("zusammenfassung") ||
    lower.includes("summarize");

  if (isSummary) return { capability: "summarize_topic" };

  // Default: normale Chat-Antwort
  return { capability: "respond_to_chat" };
}

function detectTargetHandle(text: string): string | null {
  // 1. Explizites @handle gewinnt — "frag @florian", "an @dev"
  const atMatch = text.match(/@([a-zA-Z0-9_-]+)/);
  if (atMatch?.[1]) return `@${atMatch[1].toLowerCase()}`;

  // 2. Bekannte Klartext-Namen mit Wortgrenzen
  for (const [name, handle] of Object.entries(KNOWN_HANDLES)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return handle;
  }
  return null;
}
