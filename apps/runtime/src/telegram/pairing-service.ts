import { randomInt } from "node:crypto";
import {
  TelegramConfigsRepo,
  type TelegramConfigRow,
} from "./configs-repo.js";

// ─── PAIRING SERVICE (#130 Phase 2) ─────────────────────────────────────────
//
// Dünne Business-Schicht über TelegramConfigsRepo: 6-stellige Codes (10 Min
// Default-TTL), atomare Validate-and-Consume-Calls, Resolve-by-Telegram-User-ID
// für Inbound-Routing.
//
// Layering: der Telegraf-/start-Handler wrapped PairingService, kein direkter
// Repo-Touch in den Bot-Handlern. So bleiben Code-Format und TTL eine Stelle,
// und ein späterer Stufe-2-Multi-User-Pairing-Flow muss nur hier eingebaut
// werden, nicht in jedem Handler.

const DEFAULT_TTL_SECONDS = 600; // 10 Minuten
const CODE_MIN = 100_000;
const CODE_MAX = 999_999; // crypto.randomInt-Max ist exklusiv, daher +1 unten

export class PairingService {
  constructor(private configsRepo: TelegramConfigsRepo) {}

  /**
   * Generiert einen 6-stelligen Pairing-Code für einen Twin und persistiert
   * ihn mit Expiry. Überschreibt einen existierenden Code (Re-Pairing-Case:
   * Settings-UI „Code neu generieren"-Button). Aufrufer (Settings-UI) zeigt
   * den Code danach an, Owner gibt ihn via `/start <code>` an seinen Bot.
   */
  generatePairingCode(
    twin_id: string,
    ttl_seconds: number = DEFAULT_TTL_SECONDS,
  ): string {
    const code = String(randomInt(CODE_MIN, CODE_MAX + 1));
    this.configsRepo.setPairingCode(twin_id, code, ttl_seconds);
    return code;
  }

  /**
   * Validiert + verbraucht den Code (atomar im Repo via Transaction). Bei
   * Erfolg: Telegram-User-ID wird gespeichert, Code gelöscht. Bei Mismatch
   * (Code falsch oder abgelaufen): null. Aufrufer (Telegraf-/start-Handler)
   * antwortet entsprechend.
   */
  consumePairingCode(
    twin_id: string,
    code: string,
    telegram_user_id: number,
  ): TelegramConfigRow | null {
    return this.configsRepo.consumePairingCode(twin_id, code, telegram_user_id);
  }

  /**
   * Routing-Lookup: welcher Twin gehört zu dieser Telegram-User-ID? Wird vom
   * Text-Handler in Phase 3 für die Conversation-Resolution gebraucht. In
   * Phase 2 nur für die Reject-Logik (fremder User → „This bot is paired with
   * a different user").
   */
  resolveTwinByPairedUser(telegram_user_id: number): TelegramConfigRow | null {
    return this.configsRepo.findByPairedUserId(telegram_user_id);
  }

  /** Owner löst Pairing — z.B. nach Telegram-Account-Wechsel oder Bot-Reset. */
  unpair(twin_id: string): void {
    this.configsRepo.unpair(twin_id);
  }
}
