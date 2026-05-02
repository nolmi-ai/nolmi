// ─── AUTH STUB ───────────────────────────────────────────────────────────────
//
// Heute (Phase 2.5.3) gibt's keine User-Auth. `/onboarding` ist öffentlich.
// `getCurrentUser` liefert null → owner_user_id eines neu angelegten Twins
// bleibt null. In 2.5.4 wird das durch echte Session-Logic ersetzt; alle
// Aufrufer hier müssen dann den User aus dem Request-Context bekommen.
//
// Bewusst sehr klein gehalten: ein Drop-in-Hook, der später strukturiert
// erweitert wird, ohne dass wir alle Call-Sites jetzt schon mit
// Request-Argumenten ausstatten müssen.

export interface CurrentUser {
  userId: string;
  email: string;
}

export function getCurrentUser(): CurrentUser | null {
  return null;
}
