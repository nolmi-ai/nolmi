import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

// ─── USERS REPO ──────────────────────────────────────────────────────────────
//
// Email + bcrypt-Hash. Cost-Faktor 12 — ~250ms pro Hash auf modernem Laptop,
// gut gegen Brute-Force. Kein Pepper heute (Backlog #43).
//
// User-IDs als `user_<nanoid(16)>` — gleiches Format wie twin_<nanoid(16)>
// für visuelle Konsistenz.

const BCRYPT_COST = 12;

export interface User {
  userId: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export class UserAlreadyExistsError extends Error {
  constructor(public readonly email: string) {
    super(`User mit Email '${email}' existiert bereits`);
    this.name = "UserAlreadyExistsError";
  }
}

export class UsersRepo {
  constructor(private db: Database.Database) {}

  create(email: string, passwordPlain: string, displayName?: string): User {
    const normalizedEmail = email.trim().toLowerCase();
    if (this.findByEmail(normalizedEmail)) {
      throw new UserAlreadyExistsError(normalizedEmail);
    }
    const passwordHash = bcrypt.hashSync(passwordPlain, BCRYPT_COST);
    const now = new Date().toISOString();
    const user: User = {
      userId: `user_${nanoid(16)}`,
      email: normalizedEmail,
      passwordHash,
      displayName: displayName?.trim() || null,
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO users
           (user_id, email, password_hash, display_name, email_verified_at, created_at, updated_at)
         VALUES
           (@user_id, @email, @password_hash, @display_name, @email_verified_at, @created_at, @updated_at)`,
      )
      .run({
        user_id: user.userId,
        email: user.email,
        password_hash: user.passwordHash,
        display_name: user.displayName,
        email_verified_at: user.emailVerifiedAt,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      });
    return user;
  }

  findByEmail(email: string): User | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  findById(userId: string): User | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE user_id = ?")
      .get(userId) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /**
   * Validiert Email + Passwort. Returns User bei Erfolg, null sonst.
   * Bewusst KEIN unterschiedlicher Error für "User nicht gefunden" vs
   * "Passwort falsch" — verhindert User-Enumeration via Auth-Endpoint.
   */
  verifyPassword(email: string, passwordPlain: string): User | null {
    const user = this.findByEmail(email);
    if (!user) return null;
    const ok = bcrypt.compareSync(passwordPlain, user.passwordHash);
    return ok ? user : null;
  }

  /**
   * Setzt eine neue Email für den User. Wirft UserAlreadyExistsError, wenn
   * die Ziel-Email schon einem anderen User gehört. Normalisiert Email
   * analog zu create() (trim + lowercase). Caller ist verantwortlich für
   * Current-Password-Confirm (verifyPassword vorab), Repo macht das nicht.
   */
  updateEmail(userId: string, newEmail: string): User | null {
    const normalizedEmail = newEmail.trim().toLowerCase();
    const existing = this.findByEmail(normalizedEmail);
    if (existing && existing.userId !== userId) {
      throw new UserAlreadyExistsError(normalizedEmail);
    }
    const now = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE users SET email = ?, updated_at = ? WHERE user_id = ?")
      .run(normalizedEmail, now, userId);
    if (result.changes === 0) return null;
    return this.findById(userId);
  }

  /**
   * Re-hasht und setzt ein neues Passwort. Caller ist verantwortlich für
   * Current-Password-Confirm (verifyPassword vorab), Repo macht das nicht.
   */
  updatePassword(userId: string, newPasswordPlain: string): User | null {
    const passwordHash = bcrypt.hashSync(newPasswordPlain, BCRYPT_COST);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?",
      )
      .run(passwordHash, now, userId);
    if (result.changes === 0) return null;
    return this.findById(userId);
  }
}

function rowToUser(row: UserRow): User {
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
