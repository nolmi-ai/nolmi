# Roadmap

## Phase 1 — Closed Twin (jetzt)

Erstes funktionierendes Setup, rein privat. Definition of Done aus dem
Diskussionspapier v2:

1. Markus hat einen funktionierenden Twin.
2. Mindestens drei Mandates sind aktiv und werden geprüft.
3. Audit-Log ist vollständig und lesbar.
4. UI ist benutzbar (Chat, Stream, Settings).
5. Reversibility-Lite funktioniert (pending → approved → executed).
6. C-Demo ist machbar (eine externe Person chattet mit dem Twin).

Bewusst nicht im Scope:
- Twin-zu-Twin-Kommunikation
- Public-Profilseite
- Identity / Reputation / Trust

## Phase 2 — Connected Twin (next)

Twin-zu-Twin-Kommunikation in Allowlist-Zellen.

Neue Building Blocks:
- A2A-Bridge (basiert auf bestehendem A2A-Protokoll-Standard)
- Discovery innerhalb der Allowlist
- Verhandlungs-Protokoll (Vorschlag → Gegenvorschlag → Bestätigung)
- Signed Mandates für Cross-Twin-Aktionen

## Phase 3 — Selective Public

Per-Capability-Switch öffnet Funktionen für die offene Welt.

Neue Building Blocks:
- Public-Profil unter `agent.<handle>.<domain>`
- Reputation-System v1
- Identity-Verifikation v1 (OAuth, Domain-Verify)

## Phase 4 — Open Network

Vollwertige öffentliche Twin-Schicht.

Neue Building Blocks:
- Trust-Layer v2 mit kryptografischen Identitäten
- Public Directory mit Capability-Search
- Optional: Capability-Marketplace mit Pricing

## Architektur-Notizen für Phase 2+

- Provider-Abstraktion ist da → Modell-Wechsel ohne Code-Änderung
- Repository-Pattern ist da → DB-Wechsel ohne Code-Änderung außerhalb
  der Repository-Klassen
- EventBus ist da → später durch Redis-Pub/Sub ersetzbar
- SQLite ist Phase-1-Wahl. Phase 3+ vermutlich Postgres pro Twin oder
  Postgres mit Multi-Tenancy. Migration: SQL-Dump + Import, vorbereitet
  durch das Repository-Pattern.
