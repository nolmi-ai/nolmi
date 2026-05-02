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
}): Promise<{ token: string }> {
  const url = `${opts.bridgeUrl.replace(/\/$/, "")}/twins/register`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
