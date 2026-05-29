// ─── ENV-VAR-ALIASING (Rebrand Twin-Lab → Nolmi) ─────────────────────────────
//
// `getEnv` liest eine Env-Var zuerst unter dem neuen `NOLMI_*`-Namen,
// fällt auf den alten `TWIN_LAB_*`-Namen zurück und loggt einmal pro
// Prozess-Lifetime eine Deprecation-Warning, wenn der alte Name greift.
//
// Aliasing-Fenster: 6–12 Monate (Tag 31, Mai 2026). Danach wird der
// `oldName`-Parameter entfernt und nur noch `newName` gelesen — Hart-Cut.
// Wer den Cut macht: hier zentral umstellen, in den Call-Sites bleibt
// alles wie es ist (nur Cleanup der zweiten Argumente).

const warned = new Set<string>();

function warnOnce(oldName: string, newName: string): void {
  if (warned.has(oldName)) return;
  warned.add(oldName);
  console.warn(
    `[deprecated] Env-Var "${oldName}" ist deprecated. ` +
      `Bitte auf "${newName}" umstellen. Aliasing wird in einer ` +
      `künftigen Version entfernt.`,
  );
}

/**
 * Liest eine Env-Var mit Backward-Compat-Aliasing.
 *
 * @param newName Der neue Env-Var-Name (z.B. "NOLMI_ENCRYPTION_KEY")
 * @param oldName Der alte Env-Var-Name (z.B. "TWIN_LAB_ENCRYPTION_KEY")
 * @returns Der gefundene Wert oder undefined, wenn beide nicht gesetzt sind.
 *          Bei Treffer auf `oldName` wird einmalig eine Deprecation-Warning
 *          ausgegeben. Bei beidem gesetzt gewinnt `newName`.
 */
export function getEnv(
  newName: string,
  oldName: string,
): string | undefined {
  const newValue = process.env[newName];
  if (newValue !== undefined) return newValue;

  const oldValue = process.env[oldName];
  if (oldValue !== undefined) {
    warnOnce(oldName, newName);
    return oldValue;
  }

  return undefined;
}

/**
 * Nur für Tests: setzt die Warn-Once-Map zurück.
 */
export function __resetEnvWarnings(): void {
  warned.clear();
}
