import "dotenv/config";
import Database from "better-sqlite3";
import type { SkillManifest } from "@nolmi/shared";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  SkillAlreadyExistsError,
  SkillNotFoundError,
  SkillRepo,
} from "../skills/repo.js";

// ─── TEST: SKILL-REPO (Phase 3.1.A) ─────────────────────────────────────────
//
// Schema-Test gegen die lokale DB. Nimmt einen existierenden Twin (default
// @markus, override per CLI-Arg). Inhalte sind Platzhalter — die Pilot-Skills
// folgen in 3.1.F.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-skill-repo.ts
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-skill-repo.ts @markus
//
// Voraussetzung: pnpm db:init lief (Migration 008 angewendet) und der Ziel-Twin
// existiert in twin_profiles.

const TWIN_HANDLE_DEFAULT = "@markus";
const SKILL_NAME = "workshop-context";

async function main() {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const skillRepo = new SkillRepo(db);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(
      `Twin '${handle}' nicht in DB — bitte zuerst onboarden oder Handle anpassen.`,
    );
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  // Reset: falls ein Vor-Lauf den Skill liegen gelassen hat. Reproduzierbar.
  removeSkillQuiet(skillRepo, profile.twinId, SKILL_NAME);

  let issues = 0;

  const manifest: SkillManifest = {
    name: SKILL_NAME,
    description: "Test-Manifest für Schema-Sanity (Platzhalter, Inhalte folgen in 3.1.F).",
    capability: "respond_to_chat",
    requiresApproval: false,
    inputs: [
      {
        name: "topic",
        type: "string",
        description: "Thema des Workshops",
        required: true,
      },
    ],
  };

  // ─── STEP 1: add ──────────────────────────────────────────────────────────
  banner("STEP 1 — add()");
  const created = skillRepo.add({
    twinId: profile.twinId,
    name: SKILL_NAME,
    description: "Wissens-Skill: Kontext zu Workshop-Inhalten.",
    manifestJson: manifest,
    instructionsMd: "# Workshop Context\n\nPlatzhalter — finale Inhalte folgen in 3.1.F.",
  });
  log(`  skillId:   ${created.skillId}`);
  log(`  source:    ${created.source}`);
  log(`  isActive:  ${created.isActive}`);
  log(`  createdAt: ${new Date(created.createdAt).toISOString()}`);
  if (!created.skillId.startsWith("skill_")) {
    issues += 1;
    log(`  ⚠ skillId-Präfix unerwartet.`);
  }
  if (created.source !== "manual") {
    issues += 1;
    log(`  ⚠ source default ist nicht 'manual'.`);
  }
  if (created.scriptTs !== null) {
    issues += 1;
    log(`  ⚠ scriptTs sollte null sein (Wissens-Skill ohne Script).`);
  }
  log("");

  // ─── STEP 2: findById ─────────────────────────────────────────────────────
  banner("STEP 2 — findById()");
  const byId = skillRepo.findById(created.skillId);
  if (!byId) {
    issues += 1;
    log(`  ⚠ findById liefert null.`);
  } else {
    log(`  gefunden: ${byId.name} / ${byId.description}`);
    if (byId.manifestJson.capability !== "respond_to_chat") {
      issues += 1;
      log(`  ⚠ manifestJson.capability falsch deserialisiert.`);
    }
    if (byId.manifestJson.inputs?.[0]?.name !== "topic") {
      issues += 1;
      log(`  ⚠ manifestJson.inputs nicht roundtrippt.`);
    }
  }
  log("");

  // ─── STEP 3: findByName ───────────────────────────────────────────────────
  banner("STEP 3 — findByName()");
  const byName = skillRepo.findByName(profile.twinId, SKILL_NAME);
  if (!byName || byName.skillId !== created.skillId) {
    issues += 1;
    log(`  ⚠ findByName liefert nicht den erwarteten Skill.`);
  } else {
    log(`  gefunden: ${byName.skillId}`);
  }
  log("");

  // ─── STEP 4: list (active) ────────────────────────────────────────────────
  banner("STEP 4 — list()");
  const all = skillRepo.list(profile.twinId);
  const active = skillRepo.list(profile.twinId, { activeOnly: true });
  log(`  total für Twin: ${all.length}`);
  log(`  active:         ${active.length}`);
  if (all.find((s) => s.skillId === created.skillId) === undefined) {
    issues += 1;
    log(`  ⚠ Skill nicht in list().`);
  }
  log("");

  // ─── STEP 5: update ───────────────────────────────────────────────────────
  banner("STEP 5 — update()");
  const updated = skillRepo.update(created.skillId, {
    description: "Aktualisierte Beschreibung — Update-Pfad-Test.",
  });
  if (updated.description !== "Aktualisierte Beschreibung — Update-Pfad-Test.") {
    issues += 1;
    log(`  ⚠ description nicht aktualisiert.`);
  }
  if (updated.updatedAt <= created.updatedAt) {
    issues += 1;
    log(`  ⚠ updatedAt nicht erhöht (created=${created.updatedAt}, updated=${updated.updatedAt}).`);
  } else {
    log(`  description: ${updated.description}`);
    log(`  updatedAt bewegt: ${updated.updatedAt - created.updatedAt}ms`);
  }
  log("");

  // ─── STEP 6: setActive(false) + filter ────────────────────────────────────
  banner("STEP 6 — setActive(false)");
  skillRepo.setActive(created.skillId, false);
  const activeAfterDeactivate = skillRepo.list(profile.twinId, {
    activeOnly: true,
  });
  log(`  active nach deactivate: ${activeAfterDeactivate.length}`);
  if (activeAfterDeactivate.find((s) => s.skillId === created.skillId)) {
    issues += 1;
    log(`  ⚠ deaktivierter Skill taucht in activeOnly-Liste auf.`);
  }
  const allAfterDeactivate = skillRepo.list(profile.twinId);
  if (allAfterDeactivate.find((s) => s.skillId === created.skillId) === undefined) {
    issues += 1;
    log(`  ⚠ deaktivierter Skill verschwindet ganz aus list() (sollte nur active=false sein).`);
  }
  log("");

  // ─── STEP 7: setActive(true) ──────────────────────────────────────────────
  banner("STEP 7 — setActive(true)");
  skillRepo.setActive(created.skillId, true);
  const reactivated = skillRepo.findById(created.skillId);
  if (!reactivated?.isActive) {
    issues += 1;
    log(`  ⚠ Skill nicht reaktiviert.`);
  } else {
    log(`  isActive: ${reactivated.isActive}`);
  }
  log("");

  // ─── STEP 8: UNIQUE-Constraint ────────────────────────────────────────────
  banner("STEP 8 — UNIQUE (twin_id, name)");
  let threwUnique = false;
  try {
    skillRepo.add({
      twinId: profile.twinId,
      name: SKILL_NAME,
      description: "Duplikat",
      manifestJson: manifest,
      instructionsMd: "duplicate",
    });
  } catch (err) {
    if (err instanceof SkillAlreadyExistsError) {
      threwUnique = true;
      log(`  ✓ SkillAlreadyExistsError geworfen.`);
    } else {
      log(`  ⚠ falscher Error-Typ: ${err instanceof Error ? err.name : String(err)}`);
    }
  }
  if (!threwUnique) {
    issues += 1;
    log(`  ⚠ Duplikat-Insert hätte werfen müssen.`);
  }
  log("");

  // ─── STEP 9: remove ───────────────────────────────────────────────────────
  banner("STEP 9 — remove()");
  skillRepo.remove(created.skillId);
  const afterRemove = skillRepo.findById(created.skillId);
  if (afterRemove !== null) {
    issues += 1;
    log(`  ⚠ Skill nach remove() noch findbar.`);
  } else {
    log(`  findById nach remove(): null`);
  }
  let threwNotFound = false;
  try {
    skillRepo.remove(created.skillId);
  } catch (err) {
    if (err instanceof SkillNotFoundError) {
      threwNotFound = true;
      log(`  ✓ zweites remove() wirft SkillNotFoundError.`);
    }
  }
  if (!threwNotFound) {
    issues += 1;
    log(`  ⚠ remove() auf nicht-existierenden Skill hätte werfen müssen.`);
  }
  log("");

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

function removeSkillQuiet(repo: SkillRepo, twinId: string, name: string) {
  const existing = repo.findByName(twinId, name);
  if (existing) {
    try {
      repo.remove(existing.skillId);
    } catch {
      // egal — Reset darf scheitern
    }
  }
}

main().catch((err) => {
  console.error("\n[skill:test] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
