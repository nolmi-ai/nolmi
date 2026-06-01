import { networkInterfaces } from "node:os";

/**
 * Erste non-internal IPv4 dieses Rechners — als **Vorschlag** für die browser-
 * erreichbare Adresse. **Kein externer Dienst, kein Shell-Call** (os builtin),
 * damit ohne Netz-Abhängigkeit + ohne Fehlerquellen.
 *
 * Auf einem typischen VPS ist die gebundene IP die öffentliche → trifft. Hinter
 * NAT liefert es die private IP — dann überschreibt der User den Vorschlag
 * (Option a / der Prompt ist das Sicherheitsnetz). Link-local (169.254.x) wird
 * herausgefiltert. null, wenn nichts Passendes gefunden.
 */
export function detectPrimaryIPv4(): string | null {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      // node 20: ni.family ist "IPv4" | "IPv6".
      if (ni.family !== "IPv4" || ni.internal) continue;
      if (ni.address.startsWith("169.254.")) continue; // link-local
      return ni.address;
    }
  }
  return null;
}
