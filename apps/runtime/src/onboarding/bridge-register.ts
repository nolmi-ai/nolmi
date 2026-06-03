// ─── BRIDGE HANDLE-REGISTRATION ──────────────────────────────────────────────
//
// Ein-Schuss-Helper für den Onboarding-Flow: registriert einen Handle an der
// Bridge und holt den frischen API-Token zurück. Nutzt den existierenden
// `POST /twins/register`-Endpoint aus Phase 2 (apps/bridge/src/server.ts) —
// keine Bridge-Änderung nötig.
//
// Bei 409 (Handle existiert bereits) wirft die Funktion mit klarer Message —
// der Wizard soll vorher via /onboarding/check-handle prüfen, aber die
// Server-Race-Bedingung (zwei Onboardings gleichzeitig) muss abgefangen sein.

export class BridgeRegisterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "BridgeRegisterError";
  }
}

export async function registerHandleOnBridge(opts: {
  bridgeUrl: string;
  handle: string;
  displayName: string;
  /**
   * Distribution Etappe 2.4b: expliziter Register-Token (CLI-Re-Bind an die
   * eigene Bridge — der Owner kennt das Token). Wenn nicht gesetzt, Fallback
   * auf `BRIDGE_REGISTER_TOKEN` aus der ENV (unveränderter Onboarding-Pfad).
   */
  registerToken?: string;
}): Promise<{ token: string }> {
  const url = `${opts.bridgeUrl.replace(/\/$/, "")}/twins/register`;
  // BRIDGE_REGISTER_TOKEN ist seit #60 Pflicht für /twins/register. Trim
  // gegen versehentlichen ENV-Whitespace (Lesson aus 2.5.4). Wenn unset
  // oder leer: Header weglassen — funktioniert weiter gegen ungeschützte
  // Bridges, läuft in Production aber gegen 401.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const registerToken =
    opts.registerToken?.trim() || process.env.BRIDGE_REGISTER_TOKEN?.trim();
  if (registerToken) {
    headers["X-Register-Token"] = registerToken;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      handle: opts.handle,
      displayName: opts.displayName,
    }),
  });

  if (res.status === 409) {
    throw new BridgeRegisterError(
      `Handle '${opts.handle}' ist an der Bridge bereits registriert`,
      409,
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new BridgeRegisterError(
      `Bridge POST /twins/register → HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }

  const body = (await res.json()) as { apiToken: string };
  if (!body.apiToken) {
    throw new BridgeRegisterError(
      "Bridge-Response enthielt keinen apiToken",
      500,
    );
  }
  return { token: body.apiToken };
}

// ─── BRIDGE HANDLE-DEREGISTRATION ────────────────────────────────────────────
//
// Gegenstück zu `registerHandleOnBridge` (#744): entfernt einen Handle wieder
// von der Bridge. Genutzt vom späteren Twin-Lösch-Flow (Schritt 2) — best-
// effort: der Caller fängt einen Throw ab, loggt laut, löscht den Twin lokal
// trotzdem.
//
// Auth: Der Twin weist sich mit seinem eigenen `bridge_token` aus
// (`Authorization: Bearer <token>`) — dasselbe Modell wie alle authentifizierten
// Bridge-Routen. Die Bridge prüft Owner-Scope (Token muss zum Handle gehören).
//
// 404 = Erfolg: ist der Handle an der Bridge schon weg, ist das Ziel erreicht
// (idempotent). Jeder andere Non-2xx wirft mit klarer Diagnose.
export async function deregisterHandleFromBridge(opts: {
  bridgeUrl: string;
  handle: string;
  /** Der `bridge_token` des Twins (pre-shared API-Token von der Registrierung). */
  token: string;
}): Promise<void> {
  const url = `${opts.bridgeUrl.replace(/\/$/, "")}/twins/${encodeURIComponent(
    opts.handle,
  )}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${opts.token}`,
    },
  });

  // 2xx → gelöscht. 404 → Row schon weg, Ziel erreicht (idempotent).
  if (res.ok || res.status === 404) {
    return;
  }

  let detail = "";
  try {
    const errBody = (await res.json()) as { error?: string };
    detail = errBody.error ?? "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  throw new BridgeRegisterError(
    `Bridge DELETE /twins/${opts.handle} → HTTP ${res.status}${
      detail ? `: ${detail}` : ""
    }`,
    res.status,
  );
}
