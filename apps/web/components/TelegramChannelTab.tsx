"use client";

import { useCallback, useEffect, useState } from "react";
import { ModalWrapper } from "./ModalWrapper";

// ─── TelegramChannelTab (#130 Phase 4.4) ────────────────────────────────────
//
// Owner-Settings-UI für den Telegram-Bot-Channel. Fünf Render-Modi:
//
//   loading              — initial fetch läuft
//   empty                — 404 von GET /config (kein Bot konfiguriert)
//   configured-unpaired  — Bot da, Owner muss /start <code> via Telegram senden
//   configured-paired    — Bot + Owner verbunden, Chat funktioniert
//   error                — Network-/Permission-Fehler, Retry-Button
//
// Backend-API-Calls (alle credentials: 'include' für Session-Cookie):
//
//   GET  /twins/:handle/telegram/config        — Status-Read, 404 → empty
//   POST /twins/:handle/telegram/config        — Create, validiert Token
//                                                 via Telegram-getMe()
//   POST /twins/:handle/telegram/pairing-code  — Code generieren (10min TTL)
//   POST /twins/:handle/telegram/unpair        — Pair-State zurücksetzen,
//                                                 Token + Webhook bleiben
//   PUT  /twins/:handle/telegram/config        — Token rotieren, Pairing bleibt
//   DELETE /twins/:handle/telegram/config      — Komplett-Entfernen
//
// Empty → Unpaired ist 2-Call-Flow: POST /config (Bot setzen) → POST /pairing-
// code (Code generieren) → GET /config refresh → Render. Auto-chain ohne
// User-Interaction, weil ohne Code in Unpaired-Modus keine sinnvolle UI.
//
// Section-Wrapper inline (4 Tailwind-Klassen, kein Section-Component-Extract
// nötig — matched existing settings-page-Section-Pattern).

const RUNTIME_URL =
  process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

interface TelegramConfig {
  id: string;
  bot_username: string;
  hasToken: boolean;
  isPaired: boolean;
  pairing_code: string | null;
  pairing_code_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

type Mode =
  | "loading"
  | "empty"
  | "configured-unpaired"
  | "configured-paired"
  | "error";

interface Props {
  twinHandle: string;
}

function cardClass() {
  // Matched existing settings-page Section-Wrapper (Z.1122 dort).
  return "bg-surface border border-border rounded p-5";
}

function btnPrimaryClass() {
  return "px-3 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors";
}

function btnGhostClass() {
  return "px-3 py-2 border border-border text-text text-sm rounded hover:bg-bg/40 transition-colors";
}

function btnWarnClass() {
  return "px-3 py-2 border border-warn text-warn text-sm rounded hover:bg-warn hover:text-bg transition-colors";
}

function inputClass() {
  return "w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent";
}

export function TelegramChannelTab({ twinHandle }: Props) {
  const [mode, setMode] = useState<Mode>("loading");
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Form-State (Empty + Token-Change-Inline)
  const [tokenInput, setTokenInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Inline-Edit-Mode für Token ändern (Modus 2 + 3)
  const [tokenEditOpen, setTokenEditOpen] = useState(false);
  const [tokenEditInput, setTokenEditInput] = useState("");
  const [tokenEditUsername, setTokenEditUsername] = useState("");
  const [tokenEditError, setTokenEditError] = useState<string>("");

  // Confirm-Modals
  const [showUnpairConfirm, setShowUnpairConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // Copy-Feedback (Polish-Fix Tag 26 Abend) — "Kopiert!"-Hint nach Click.
  const [copied, setCopied] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      setErrorMessage("");
      const res = await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/config`,
        { credentials: "include" },
      );
      if (res.status === 404) {
        setConfig(null);
        setMode("empty");
        return;
      }
      if (!res.ok) {
        setErrorMessage(`HTTP ${res.status}`);
        setMode("error");
        return;
      }
      const data = (await res.json()) as TelegramConfig;
      setConfig(data);
      setMode(data.isPaired ? "configured-paired" : "configured-unpaired");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Netzwerk-Fehler");
      setMode("error");
    }
  }, [twinHandle]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // Polish-Fix Tag 26 Abend: User klickt Telegram-Deeplink → pairt extern
  // via Bot → kommt zurück in den Browser. Ohne Auto-Refresh sieht User
  // weiterhin Modus 2 mit Pairing-Code statt Modus 3. Window-Focus-Listener
  // (nur in Modus „configured-unpaired" aktiv) ruft fetchConfig() bei
  // Tab-Re-Focus — wenn Backend `isPaired=true` zurückgibt, schaltet der
  // Render-Switch automatisch auf Modus 3 um. Initial-Mount-Focus fired
  // nicht; das existing fetchConfig oben deckt den Boot-Pfad ab.
  useEffect(() => {
    if (mode !== "configured-unpaired") return;
    const handleFocus = () => {
      void fetchConfig();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [mode, fetchConfig]);

  async function saveConfig() {
    if (!tokenInput || !usernameInput) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const createRes = await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/config`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bot_token: tokenInput,
            bot_username: usernameInput,
          }),
        },
      );
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setErrorMessage(body.error ?? `HTTP ${createRes.status}`);
        return;
      }
      // Pairing-Code separat triggern (POST /config generiert nicht automatisch).
      // Failure ist hier nicht-fatal — Refresh-Button im Unpaired-Modus erlaubt
      // späteres Nachholen.
      await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/pairing-code`,
        { method: "POST", credentials: "include" },
      );
      setTokenInput("");
      setUsernameInput("");
      await fetchConfig();
    } finally {
      setSaving(false);
    }
  }

  async function refreshPairingCode() {
    setActionBusy(true);
    try {
      await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/pairing-code`,
        { method: "POST", credentials: "include" },
      );
      await fetchConfig();
    } finally {
      setActionBusy(false);
    }
  }

  async function unpair() {
    setActionBusy(true);
    try {
      await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/unpair`,
        { method: "POST", credentials: "include" },
      );
      await fetchConfig();
    } finally {
      setActionBusy(false);
      setShowUnpairConfirm(false);
    }
  }

  async function deleteConfig() {
    setActionBusy(true);
    try {
      await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/config`,
        { method: "DELETE", credentials: "include" },
      );
      setConfig(null);
      setMode("empty");
    } finally {
      setActionBusy(false);
      setShowDeleteConfirm(false);
    }
  }

  async function submitTokenChange() {
    if (!tokenEditInput || !tokenEditUsername) return;
    setActionBusy(true);
    setTokenEditError("");
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/telegram/config`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bot_token: tokenEditInput,
            bot_username: tokenEditUsername,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setTokenEditError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setTokenEditOpen(false);
      setTokenEditInput("");
      setTokenEditUsername("");
      await fetchConfig();
    } finally {
      setActionBusy(false);
    }
  }

  async function copyPairingCode() {
    if (!config?.pairing_code) return;
    try {
      await navigator.clipboard.writeText(config.pairing_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API kann in unsicheren Kontexten verweigert werden — silent
    }
  }

  // ─── Render-Switch ────────────────────────────────────────────────────────

  if (mode === "loading") {
    return (
      <div className={cardClass()}>
        <p className="text-sm text-muted">Lade Telegram-Konfiguration…</p>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className={cardClass()}>
        <p className="text-sm text-warn mb-3">
          Telegram-Konfiguration konnte nicht geladen werden: {errorMessage}
        </p>
        <button onClick={() => void fetchConfig()} className={btnGhostClass()}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (mode === "empty") {
    return (
      <div className={cardClass()}>
        <h3 className="text-sm font-semibold text-text mb-3">
          Telegram-Bot einrichten
        </h3>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Erstelle einen Bot via{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            @BotFather
          </a>{" "}
          und füge den Bot-Token hier ein. Dein Twin ist dann via Telegram
          erreichbar — Memory und Persona bleiben dieselben wie im Web-Chat.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs text-muted mb-1">Bot-Token</span>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="123456789:ABC-DEF…"
              className={inputClass()}
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted mb-1">
              Bot-Username (ohne @)
            </span>
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="my_twin_bot"
              className={inputClass()}
              autoComplete="off"
            />
          </label>
          {errorMessage && (
            <p className="text-xs text-warn">{errorMessage}</p>
          )}
          <button
            onClick={() => void saveConfig()}
            disabled={!tokenInput || !usernameInput || saving}
            className={btnPrimaryClass()}
          >
            {saving ? "Speichert + validiert…" : "Speichern"}
          </button>
        </div>
      </div>
    );
  }

  // Modi configured-* brauchen config
  if (!config) return null;

  const deeplink = config.pairing_code
    ? `tg://resolve?domain=${encodeURIComponent(config.bot_username)}&start=${encodeURIComponent(config.pairing_code)}`
    : null;

  return (
    <div className={cardClass()}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-accent">✓</span>
        <h3 className="text-sm font-semibold text-text">
          {mode === "configured-paired"
            ? "Telegram aktiv"
            : "Telegram-Bot konfiguriert"}
        </h3>
      </div>

      <p className="text-sm text-text mb-4">
        Bot:{" "}
        <code className="font-mono text-accent">@{config.bot_username}</code>
      </p>

      {mode === "configured-unpaired" && (
        <div className="bg-bg border border-border rounded p-4 mb-4">
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Pairing-Code
          </p>
          {config.pairing_code ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                <code className="text-2xl font-mono text-text tracking-wider">
                  {config.pairing_code}
                </code>
                <button
                  onClick={() => void copyPairingCode()}
                  className={btnGhostClass()}
                >
                  {copied ? "Kopiert!" : "Kopieren"}
                </button>
              </div>
              <p className="text-xs text-muted mb-2">
                Send{" "}
                <code className="font-mono text-accent">
                  /start {config.pairing_code}
                </code>{" "}
                an deinen Bot:
              </p>
              {deeplink && (
                <a
                  href={deeplink}
                  className="text-accent underline text-sm"
                  rel="noopener noreferrer"
                >
                  Telegram öffnen
                </a>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              Noch kein Pairing-Code generiert.
            </p>
          )}
        </div>
      )}

      {tokenEditOpen ? (
        <div className="border border-border rounded p-4 mb-4 space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted">
            Token ändern
          </p>
          <p className="text-xs text-muted">
            Pairing bleibt erhalten — Token + Webhook-Secret werden rotiert.
          </p>
          <label className="block">
            <span className="block text-xs text-muted mb-1">Neuer Token</span>
            <input
              type="password"
              value={tokenEditInput}
              onChange={(e) => setTokenEditInput(e.target.value)}
              className={inputClass()}
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted mb-1">
              Bot-Username (ohne @)
            </span>
            <input
              type="text"
              value={tokenEditUsername}
              onChange={(e) => setTokenEditUsername(e.target.value)}
              className={inputClass()}
              autoComplete="off"
            />
          </label>
          {tokenEditError && (
            <p className="text-xs text-warn">{tokenEditError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void submitTokenChange()}
              disabled={!tokenEditInput || !tokenEditUsername || actionBusy}
              className={btnPrimaryClass()}
            >
              {actionBusy ? "Speichert…" : "Speichern"}
            </button>
            <button
              onClick={() => {
                setTokenEditOpen(false);
                setTokenEditError("");
                setTokenEditInput("");
                setTokenEditUsername("");
              }}
              className={btnGhostClass()}
            >
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {mode === "configured-unpaired" && (
            <button
              onClick={() => void refreshPairingCode()}
              disabled={actionBusy}
              className={btnGhostClass()}
            >
              Neuen Code generieren
            </button>
          )}
          <button
            onClick={() => {
              setTokenEditInput("");
              setTokenEditUsername(config.bot_username);
              setTokenEditError("");
              setTokenEditOpen(true);
            }}
            className={btnGhostClass()}
          >
            Token ändern
          </button>
          {mode === "configured-paired" && (
            <button
              onClick={() => setShowUnpairConfirm(true)}
              className={btnGhostClass()}
            >
              Telegram entkoppeln
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className={btnWarnClass()}
          >
            Bot löschen
          </button>
        </div>
      )}

      {showUnpairConfirm && (
        <ModalWrapper onClose={() => setShowUnpairConfirm(false)}>
          <div className="p-6">
            <h3 className="text-base font-semibold text-text mb-3">
              Telegram entkoppeln?
            </h3>
            <p className="text-sm text-muted mb-5">
              Das Pairing wird zurückgesetzt — du musst danach erneut{" "}
              <code className="font-mono text-accent">
                /start &lt;code&gt;
              </code>{" "}
              an deinen Bot senden. Bot-Token und Webhook bleiben aktiv.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowUnpairConfirm(false)}
                className={btnGhostClass()}
              >
                Abbrechen
              </button>
              <button
                onClick={() => void unpair()}
                disabled={actionBusy}
                className={btnWarnClass()}
              >
                {actionBusy ? "Entkoppelt…" : "Ja, entkoppeln"}
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}

      {showDeleteConfirm && (
        <ModalWrapper onClose={() => setShowDeleteConfirm(false)}>
          <div className="p-6">
            <h3 className="text-base font-semibold text-text mb-3">
              Bot löschen?
            </h3>
            <p className="text-sm text-muted mb-5">
              Bot-Token, Pairing und Webhook werden komplett entfernt. Du
              musst danach mit einem neuen Token erneut konfigurieren.
              Telegram-Message-Verlauf in deiner Twin-Konversation bleibt
              erhalten.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={btnGhostClass()}
              >
                Abbrechen
              </button>
              <button
                onClick={() => void deleteConfig()}
                disabled={actionBusy}
                className={btnWarnClass()}
              >
                {actionBusy ? "Löscht…" : "Ja, löschen"}
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}
    </div>
  );
}
