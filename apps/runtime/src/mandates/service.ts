import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { nanoid } from "nanoid";
import type { Mandate } from "@twin-lab/shared";
import type { MandateRepository } from "../repository/types.js";

// ─── MANDATE LOADER ──────────────────────────────────────────────────────────
//
// Mandates kommen aus docs/mandates.yaml und werden beim Start synchronisiert
// (existierende ID → update, neue ID → insert).

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

export async function syncMandates(
  repo: MandateRepository,
  mandates: Mandate[],
): Promise<void> {
  for (const m of mandates) {
    await repo.upsert(m);
  }
}

// ─── MANDATE CHECK ───────────────────────────────────────────────────────────
//
// Vor jeder Twin-Aktion wird geprüft: gibt es ein passendes Mandate?
// Wenn nicht → blocked. Wenn ja → result enthält das Mandate.

export interface MandateCheckResult {
  allowed: boolean;
  mandate: Mandate | null;
  reason: string | null;
}

export async function checkMandate(
  repo: MandateRepository,
  capability: string,
): Promise<MandateCheckResult> {
  const mandate = await repo.findByCapability(capability);

  if (!mandate) {
    return {
      allowed: false,
      mandate: null,
      reason: `No mandate found for capability "${capability}"`,
    };
  }

  // In Phase 1: Mandate vorhanden = erlaubt.
  // Conditions-Auswertung kommt in Phase 2 (z.B. maxLength, requiresApproval).
  return {
    allowed: true,
    mandate,
    reason: null,
  };
}
