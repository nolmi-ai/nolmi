import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { nanoid } from "nanoid";
import type { Mandate } from "@nolmi/shared";

// ─── MANDATE LOADER (BOOTSTRAP-ONLY) ─────────────────────────────────────────
//
// Liest docs/mandates.yaml und liefert ein Mandate-Array. Wird seit Phase 2.5
// nicht mehr beim Boot benutzt — der Runtime liest Mandates aus
// `twin_profiles.mandates_json`. Bleibt hier nur, weil das Bootstrap-Script
// (apps/runtime/src/scripts/bootstrap-markus-twin.ts) die YAML in die DB
// überträgt.

interface MandateYamlEntry {
  id?: string;
  capability: string;
  description: string;
  scope: string[];
  conditions?: Record<string, unknown>;
  escalation: "auto" | "always_pending" | "above_threshold";
}

export async function loadMandatesFromYaml(path: string): Promise<Mandate[]> {
  const content = await readFile(path, "utf-8");
  const parsed = parseYaml(content) as { mandates: MandateYamlEntry[] };
  if (!parsed?.mandates) return [];

  const now = new Date().toISOString();
  return parsed.mandates.map((entry) => ({
    id: entry.id ?? `mandate_${nanoid(10)}`,
    capability: entry.capability,
    description: entry.description,
    scope: entry.scope as Mandate["scope"],
    conditions: entry.conditions ?? {},
    escalation: entry.escalation,
    createdAt: now,
  }));
}

// ─── MANDATE CHECK ───────────────────────────────────────────────────────────
//
// Vor jeder Twin-Aktion: gibt es ein Mandate für diese Capability im aktiven
// Twin-Profil? Wenn nicht → blocked. Wenn ja → result enthält das Mandate.
//
// Operiert auf einem in-memory Mandate-Array (kommt aus `TwinProfile.mandates`
// vom Boot). Kein DB-Lookup pro Call mehr.

export interface MandateCheckResult {
  allowed: boolean;
  mandate: Mandate | null;
  reason: string | null;
}

export function checkMandate(
  mandates: Mandate[],
  capability: string,
): MandateCheckResult {
  const mandate = mandates.find((m) => m.capability === capability);

  if (!mandate) {
    return {
      allowed: false,
      mandate: null,
      reason: `Kein Mandate für Capability "${capability}"`,
    };
  }

  // Mandate vorhanden = erlaubt. Conditions werden hier BEWUSST nicht
  // ausgewertet — sie sind keine Allow/Block-Entscheidung:
  //   - `requiresApproval` ist DEKLARATIV/redundant: das echte Approval-Gate
  //     ist `escalation: always_pending` (TwinService routet pending darüber,
  //     siehe twin-service.ts). requiresApproval bleibt nur als Doku-Wert in
  //     mandates.yaml stehen, hat keine eigene Logik.
  //   - `maxLength` ist eine OUTPUT-Bedingung → erst NACH der Generierung
  //     prüfbar; durchgesetzt in TwinService.enforceMaxLength (#3), nicht hier.
  // Deshalb gibt `check.mandate.conditions` den Wert nur durch (für
  // enforceMaxLength), ohne ihn im checkMandate-Pfad zu interpretieren.
  return {
    allowed: true,
    mandate,
    reason: null,
  };
}
