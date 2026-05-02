import { randomBytes } from "node:crypto";

// ─── GENERATE SESSION SECRET ─────────────────────────────────────────────────
//
// One-Shot CLI für TWIN_LAB_SESSION_SECRET. iron-session braucht mind. 32
// Zeichen — wir geben hex-encodete 32 Bytes (= 64 hex-chars) aus, das
// erfüllt das Limit zweifach.
//
// Aufruf: pnpm --filter @twin-lab/runtime session-secret:generate
//
// Wichtig: separater Wert von TWIN_LAB_ENCRYPTION_KEY (verschlüsselt
// API-Keys). Verlust ist hier weniger schlimm — bei Rotation müssen
// Sessions neu erstellt werden, alle User loggen sich neu ein, fertig.

const secret = randomBytes(32).toString("hex");

console.log(`TWIN_LAB_SESSION_SECRET=${secret}`);
console.log("");
console.log("Lege diesen Wert in deine .env. Niemals in Git committen.");
console.log("Bei Rotation: alle Session-Cookies werden invalidiert,");
console.log("User müssen sich neu einloggen.");
