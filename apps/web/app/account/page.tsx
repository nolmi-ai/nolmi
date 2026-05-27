"use client";

import { useEffect, useState } from "react";
import { PageContainer } from "../../components/PageContainer";
import { toast } from "../../lib/toast";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── ACCOUNT PAGE (#135) ────────────────────────────────────────────────────
//
// Account-Settings für eingeloggte User: Email und Passwort umstellen.
// Bewusst eine eigene Route statt Settings-Tab, weil Account user-global
// ist (nicht twin-scoped) — Settings lebt pro Twin.
//
// Phase-A-Setzungen (Tag 26): Email-Change ohne Verify-Link, direkt
// umstellen. Account-Delete nicht in diesem Item (semantisch heavy,
// Twin-Kaskadierung + A2A-Konversationen). Email-Verify-Flow defer.
//
// Beide Forms haben Current-Password-Confirm — ein gestohlenes Cookie
// reicht nicht, um Account zu kapern.

interface MeResponse {
  userId: string;
  email: string;
  displayName: string | null;
}

export default function AccountPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Email-Form
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  // Passwort-Form
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/auth/me`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<MeResponse>;
      })
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Account-Daten laden fehlgeschlagen",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (emailBusy || !newEmail || !emailCurrentPassword) return;
    setEmailBusy(true);
    try {
      const res = await fetch(`${RUNTIME_URL}/auth/me/email`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newEmail,
          currentPassword: emailCurrentPassword,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? `Email-Update fehlgeschlagen (HTTP ${res.status})`);
        return;
      }
      const updated = body as MeResponse;
      setMe(updated);
      setNewEmail("");
      setEmailCurrentPassword("");
      toast.success(`Email aktualisiert: ${updated.email}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Netzwerk-Fehler beim Email-Update",
      );
    } finally {
      setEmailBusy(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      passwordBusy ||
      !oldPassword ||
      newPassword.length < 8 ||
      newPassword !== newPasswordConfirm
    ) {
      return;
    }
    setPasswordBusy(true);
    try {
      const res = await fetch(`${RUNTIME_URL}/auth/me/password`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: oldPassword,
          newPassword,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? `Passwort-Update fehlgeschlagen (HTTP ${res.status})`);
        return;
      }
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      toast.success("Passwort aktualisiert");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Netzwerk-Fehler beim Passwort-Update",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  if (loadError) {
    return (
      <PageContainer>
        <div className="text-sm text-warn border border-warn rounded px-3 py-2">
          {loadError}
        </div>
      </PageContainer>
    );
  }

  if (!me) {
    return (
      <PageContainer>
        <div className="text-sm text-muted">Lade…</div>
      </PageContainer>
    );
  }

  const passwordMismatch =
    newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm;
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const passwordSubmitDisabled =
    passwordBusy ||
    !oldPassword ||
    newPassword.length < 8 ||
    newPassword !== newPasswordConfirm;

  return (
    <PageContainer className="space-y-8 max-w-2xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">Account</h1>
        <div className="text-xs text-muted">
          Account-weite Einstellungen — gelten für alle Twins.
        </div>
      </header>

      <section className="space-y-4 border border-border rounded p-6 bg-surface">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-text">Email</h2>
          <p className="text-xs text-muted">
            Aktuell: <span className="text-text">{me.email}</span>
          </p>
        </div>
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Neue Email
            </label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="email"
              required
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Aktuelles Passwort
            </label>
            <input
              type="password"
              value={emailCurrentPassword}
              onChange={(e) => setEmailCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={emailBusy || !newEmail || !emailCurrentPassword}
            className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
          >
            {emailBusy ? "Email ändern…" : "Email ändern"}
          </button>
        </form>
      </section>

      <section className="space-y-4 border border-border rounded p-6 bg-surface">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-text">Passwort</h2>
          <p className="text-xs text-muted">
            Mindestens 8 Zeichen. Du wirst nicht ausgeloggt — die laufende
            Session bleibt aktiv.
          </p>
        </div>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Aktuelles Passwort
            </label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Neues Passwort (mindestens 8 Zeichen)
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
            />
            {passwordTooShort && (
              <div className="text-xs text-warn mt-1">
                Mindestens 8 Zeichen nötig.
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Neues Passwort bestätigen
            </label>
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
            />
            {passwordMismatch && (
              <div className="text-xs text-warn mt-1">
                Passwörter stimmen nicht überein.
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={passwordSubmitDisabled}
            className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
          >
            {passwordBusy ? "Passwort ändern…" : "Passwort ändern"}
          </button>
        </form>
      </section>
    </PageContainer>
  );
}
