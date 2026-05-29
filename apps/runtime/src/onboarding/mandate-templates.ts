import { nanoid } from "nanoid";
import type { Mandate } from "@nolmi/shared";

// ─── MANDATE TEMPLATES ───────────────────────────────────────────────────────
//
// Drei vordefinierte Mandate-Sets für den Onboarding-Wizard. Mapping:
//   requires_approval=true  → escalation: 'always_pending'
//   requires_approval=false → escalation: 'auto'
//   max_length              → conditions.maxLength
//   sonstige Conditions     → conditions.<field>
//
// Wichtig: requires_approval/max_length werden vom aktuellen
// `checkMandate` (apps/runtime/src/mandates/service.ts) NICHT ausgewertet —
// nur escalation. Wir speichern die Felder trotzdem, damit der Wizard
// zukunftssicher ist (Backlog #3 wertet sie aus).
//
// Capabilities:
//   - respond_to_chat            : Chat-Antworten
//   - respond_to_twin_message    : eingehende Twin-Nachrichten
//   - delegate_research          : Recherche-Aufgaben an Sub-Agent (Backlog)
//   - auto_schedule              : Termine eigenständig legen (Backlog)
//   - share_profile              : Profil/Visitenkarte teilen (Backlog)

export type MandateTemplateId = "cautious" | "trusting" | "business";

export function loadMandateTemplate(id: MandateTemplateId): Mandate[] {
  const now = new Date().toISOString();
  const mk = (
    capability: string,
    description: string,
    escalation: Mandate["escalation"],
    conditions: Record<string, unknown> = {},
    scope: Mandate["scope"] = ["private", "connected"],
  ): Mandate => ({
    id: `mandate_${nanoid(10)}`,
    capability,
    description,
    scope,
    conditions,
    escalation,
    createdAt: now,
  });

  switch (id) {
    case "cautious":
      return [
        mk(
          "respond_to_chat",
          "Antworten in interaktiven Chat-Sessions — alles geht durch Approval.",
          "always_pending",
          { maxLength: 500, requiresApproval: true },
        ),
        mk(
          "respond_to_twin_message",
          "Eingehende Twin-Nachrichten beantworten — alles geht durch Approval.",
          "always_pending",
          { requiresApproval: true },
        ),
        mk(
          "delegate_research",
          "Recherche an Sub-Agent delegieren — deaktiviert.",
          "always_pending",
          { enabled: false },
        ),
        mk(
          "auto_schedule",
          "Termine eigenständig legen — deaktiviert.",
          "always_pending",
          { enabled: false },
        ),
        mk(
          "share_profile",
          "Profil/Kontakt teilen — alles geht durch Approval.",
          "always_pending",
          { requiresApproval: true },
        ),
      ];

    case "trusting":
      return [
        mk(
          "respond_to_chat",
          "Antworten in interaktiven Chat-Sessions ohne Approval.",
          "auto",
          { requiresApproval: false },
        ),
        mk(
          "respond_to_twin_message",
          "Twin-Nachrichten ohne Approval — außer bei sensiblen Themen.",
          "auto",
          {
            requiresApproval: false,
            // Heute noch nicht ausgewertet vom Mandate-Check; Backlog #3
            // soll das matching gegen msg.content laufen lassen.
            requiresApprovalIfMatches: ["Termin", "Geld", "Vertrag", "Vereinbarung"],
          },
        ),
        mk(
          "delegate_research",
          "Recherche-Tasks autonom abarbeiten.",
          "auto",
          { requiresApproval: false },
        ),
        mk(
          "auto_schedule",
          "Termine eigenständig legen — deaktiviert.",
          "always_pending",
          { enabled: false },
        ),
        mk(
          "share_profile",
          "Profil ohne Approval teilen.",
          "auto",
          { requiresApproval: false },
        ),
      ];

    case "business":
      return [
        mk(
          "respond_to_chat",
          "Nur geschäftliche Themen — Privates abweisen. Approval nötig.",
          "always_pending",
          {
            requiresApproval: true,
            note: "Nur geschäftliche Themen — Privates abweisen",
          },
        ),
        mk(
          "respond_to_twin_message",
          "Twin-Nachrichten mit Approval.",
          "always_pending",
          { requiresApproval: true },
        ),
        mk(
          "delegate_research",
          "Recherche autonom.",
          "auto",
          { requiresApproval: false },
        ),
        mk(
          "auto_schedule",
          "Termine eigenständig — Approval nötig.",
          "always_pending",
          { requiresApproval: true },
        ),
        mk(
          "share_profile",
          "Profil teilen mit Approval.",
          "always_pending",
          { requiresApproval: true },
        ),
      ];
  }
}
