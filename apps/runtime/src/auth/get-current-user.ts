import type { FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { getSession } from "./session.js";
import { UsersRepo, type User } from "./users-repo.js";

// ─── GET CURRENT USER ────────────────────────────────────────────────────────
//
// Drop-in-Replacement für den 2.5.3-Auth-Stub. Liest Session-Cookie über
// iron-session, lädt User per ID aus DB. Returns null wenn nicht eingeloggt
// ODER User nicht mehr existiert (z.B. nach Account-Löschung).
//
// db kommt vom Server-Layer rein (statt globalem Singleton), damit Tests
// einfacher bleiben und der Repository-Pattern konsistent ist.

export async function getCurrentUser(
  request: FastifyRequest,
  db: Database.Database,
): Promise<User | null> {
  const session = await getSession(request);
  if (!session) return null;
  const repo = new UsersRepo(db);
  return repo.findById(session.userId);
}
