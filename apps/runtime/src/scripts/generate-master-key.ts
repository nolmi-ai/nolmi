import { generateMasterKey } from "../crypto-utils.js";

// ─── GENERATE MASTER KEY ─────────────────────────────────────────────────────
//
// One-Shot CLI: erzeugt einen frischen 32-Byte-Master-Key, base64-encoded,
// und gibt die ENV-Zeile + Warnhinweise auf stdout aus.
//
// Aufruf:  pnpm --filter @nolmi/runtime key:generate
//
// Wichtig: dieser Schlüssel verschlüsselt alle API-Keys in twin_profiles.
// Bei Verlust gibt's keinen Recovery — alle Twins müssten via re-bootstrap
// neue verschlüsselte Werte bekommen. Daher: in .env, niemals in Git, im
// Production-Deploy in einem separaten Secret-Store.

const key = generateMasterKey();

console.log(`NOLMI_ENCRYPTION_KEY=${key}`);
console.log("");
console.log("Lege diesen Wert in deine .env. Niemals in Git committen.");
console.log("Bei Verlust: alle verschlüsselten API-Keys in der DB sind unwiederbringbar");
console.log("(Re-Bootstrap der Twins nötig).");
