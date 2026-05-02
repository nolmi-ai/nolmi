// ─── AUTH STUB (DEPRECATED) ──────────────────────────────────────────────────
//
// 2.5.3 hatte hier einen synchronen Stub. 2.5.4 hat das durch echte Logic
// ersetzt — siehe `auth/get-current-user.ts` (mit FastifyRequest +
// Database). Diese Datei bleibt nur für Imports während der Refactor-Welle;
// neue Aufrufer sollten direkt aus `auth/get-current-user.js` importieren.

export { getCurrentUser } from "./auth/get-current-user.js";
export type { User as CurrentUser } from "./auth/users-repo.js";
