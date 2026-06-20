import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

// ─── SSRF-GUARD (web_fetch SS1) ──────────────────────────────────────────────
//
// Sicherheitskern für das spätere native web_fetch-Tool. Das LLM wählt die URL,
// also muss VOR jedem connect — und auf JEDEM Redirect-Hop — gegen die
// AUFGELÖSTE IP geprüft werden. Strategie: Allowlist statt Blocklist auf
// IP-Range-Ebene — nur öffentliches Unicast ist erlaubt, ALLES andere
// (loopback, private, link-local/Cloud-Metadata, CGNAT, multicast, reserved,
// documentation, unspecified, IPv4-mapped-IPv6, …) wird blockiert. Neue
// Spezial-Ranges sind damit by-default blockiert, nicht versehentlich erlaubt.
//
// IP-Range-Klassifikation via ipaddr.js (gepinnt) — Hand-Rolling von IPv6-CIDR
// ist hier zu fehleranfällig.

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** Nur diese Schemata sind erlaubt — file/gopher/ftp/data/blob etc. werfen. */
export const ALLOWED_SCHEMES = ["http:", "https:"] as const;

/** Max. Redirect-Hops (für SS2s Fetch-Loop). */
export const MAX_REDIRECTS = 5;

// ipaddr.js range()-Kategorien, die als sicher gelten = öffentliches Unicast.
// Whitelist: alles, was NICHT hier steht, wird blockiert.
const SAFE_RANGES: ReadonlySet<string> = new Set(["unicast"]);

/**
 * Wirft, wenn die IP nicht öffentliches Unicast ist. 🔴 IPv4-mapped IPv6
 * (::ffff:127.0.0.1) wird auf die eingebettete v4 reduziert und neu geprüft —
 * sonst Bypass der v4-Blocklist über die v6-Schreibweise.
 */
export function assertIpSafe(ipStr: string): void {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ipStr);
  } catch {
    throw new SsrfError(`Ungültige IP: ${ipStr}`);
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      addr = v6.toIPv4Address();
    }
  }
  const range = addr.range();
  if (!SAFE_RANGES.has(range)) {
    throw new SsrfError(`Blockierte IP ${ipStr} (range=${range})`);
  }
}

/**
 * Validiert eine URL: Schema-Allowlist → DNS-Auflösung (alle A+AAAA) →
 * IP-Blocklist auf JEDER aufgelösten Adresse. Wirft bei unsicher (inkl. nicht
 * auflösbar — „kann nicht verifizieren" = unsicher). Literal-IPs (auch WHATWG-
 * normalisierte dezimal/hex/oktal IPv4 + IPv6 in Klammern) werden direkt
 * geprüft, ohne DNS. Gibt die geparste URL + die geprüften IPs zurück.
 */
export async function assertUrlSafe(
  rawUrl: string,
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Ungültige URL: ${rawUrl}`);
  }

  if (!ALLOWED_SCHEMES.includes(url.protocol as (typeof ALLOWED_SCHEMES)[number])) {
    throw new SsrfError(`Blockiertes Schema "${url.protocol}" (nur http/https)`);
  }

  // WHATWG-URL normalisiert dezimal/hex/oktal IPv4 → dotted; IPv6 in [Klammern].
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!host) throw new SsrfError("Leerer Hostname");

  let addresses: string[];
  if (isIP(host) !== 0) {
    // Literal-IP → direkt prüfen, kein DNS (verhindert auch DNS-Roundtrip-Drift).
    addresses = [host];
  } else {
    let resolved: { address: string }[];
    try {
      // verbatim:true = keine Reihenfolge-Manipulation; all:true = A UND AAAA.
      resolved = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new SsrfError(
        `DNS-Auflösung für "${host}" fehlgeschlagen — als unsicher behandelt`,
      );
    }
    if (resolved.length === 0) {
      throw new SsrfError(`Keine IP für "${host}" aufgelöst`);
    }
    addresses = resolved.map((r) => r.address);
  }

  // 🔴 JEDE aufgelöste IP muss sicher sein (nicht „mindestens eine") — sonst
  // DNS-Rebinding/Multi-Record-Bypass.
  for (const ip of addresses) assertIpSafe(ip);

  return { url, addresses };
}

/**
 * Redirect-Guard (für SS2s Fetch-Loop, redirect:"manual"): resolved die — evtl.
 * relative — Location gegen die aktuelle URL und validiert das Ziel mit
 * assertUrlSafe. Pro Hop aufzurufen; Hop-Zählung/-Limit (MAX_REDIRECTS) macht
 * der Caller.
 */
export async function assertRedirectTargetSafe(
  currentUrl: string,
  location: string,
): Promise<{ url: URL; addresses: string[] }> {
  let target: string;
  try {
    target = new URL(location, currentUrl).toString();
  } catch {
    throw new SsrfError(`Ungültige Redirect-Location: "${location}"`);
  }
  return assertUrlSafe(target);
}
