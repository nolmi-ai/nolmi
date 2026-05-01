import { customAlphabet } from "nanoid";
import type { Db } from "./db.js";

// ─── TWINS REPO ──────────────────────────────────────────────────────────────
//
// Hält die Twin-Registry: wer ist bekannt, mit welchem Display-Name, mit
// welchem Pre-Shared API-Token. Tokens sind 32-stellige hex-Strings (nanoid
// mit hex-Alphabet — kollisionsarm genug für eine überschaubare Twin-Zahl).

export interface Twin {
  handle: string;
  displayName: string;
  apiToken: string;
  registeredAt: string;
  lastSeenAt: string | null;
}

interface TwinRow {
  handle: string;
  display_name: string;
  api_token: string;
  registered_at: string;
  last_seen_at: string | null;
}

const generateToken = customAlphabet("0123456789abcdef", 32);

export class TwinsRepo {
  constructor(private db: Db) {}

  register(handle: string, displayName: string): Twin {
    const existing = this.getByHandle(handle);
    if (existing) {
      throw new TwinAlreadyExistsError(handle);
    }
    const twin: Twin = {
      handle,
      displayName,
      apiToken: generateToken(),
      registeredAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO twins (handle, display_name, api_token, registered_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(twin.handle, twin.displayName, twin.apiToken, twin.registeredAt, twin.lastSeenAt);
    return twin;
  }

  getByHandle(handle: string): Twin | null {
    const row = this.db
      .prepare("SELECT * FROM twins WHERE handle = ?")
      .get(handle) as TwinRow | undefined;
    return row ? rowToTwin(row) : null;
  }

  getByToken(token: string): Twin | null {
    const row = this.db
      .prepare("SELECT * FROM twins WHERE api_token = ?")
      .get(token) as TwinRow | undefined;
    return row ? rowToTwin(row) : null;
  }

  list(): Twin[] {
    const rows = this.db
      .prepare("SELECT * FROM twins ORDER BY registered_at ASC")
      .all() as TwinRow[];
    return rows.map(rowToTwin);
  }

  touchLastSeen(handle: string): void {
    this.db
      .prepare("UPDATE twins SET last_seen_at = ? WHERE handle = ?")
      .run(new Date().toISOString(), handle);
  }
}

export class TwinAlreadyExistsError extends Error {
  constructor(public handle: string) {
    super(`Twin "${handle}" ist bereits registriert`);
    this.name = "TwinAlreadyExistsError";
  }
}

function rowToTwin(row: TwinRow): Twin {
  return {
    handle: row.handle,
    displayName: row.display_name,
    apiToken: row.api_token,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  };
}
