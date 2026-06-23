import { tool } from "ai";
import { z } from "zod";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import type { IncomingMessage, IncomingHttpHeaders } from "node:http";
import {
  assertUrlSafe,
  assertRedirectTargetSafe,
  MAX_REDIRECTS,
  SsrfError,
} from "./ssrf-guard.js";

// ─── NATIVES web_fetch-TOOL (SS2) ────────────────────────────────────────────
//
// GET-only, fester Nolmi-UA, SSRF-gehärtet (SS1). 🔴 DNS-Rebinding-Schutz via
// IP-PINNING: der TCP-Connect geht NUR auf die von assertUrlSafe geprüfte IP
// (custom `lookup`), während Host-Header + TLS-SNI auf dem Hostnamen bleiben
// (Zertifikat-Validierung intakt). Schließt das TOCTOU-Fenster zwischen Guard-
// DNS und Connect-DNS — ohne neue Dependency (built-in node:http/https).
//
// needsApproval:false → auto. Sicherheit liegt im Guard, nicht im Approval.
// NICHT in runModel verdrahtet (SS3).

export const NOLMI_UA =
  "Mozilla/5.0 (compatible) Safari/537.36 Nolmi/0.1 (+harwayexperience.com)";

// Gesamt-Timeout (Connect + TLS + Body + Redirect-Kette). 25s großzügig genug
// für kurz überlastete Hosts (httpbin: 10s zu knapp, Minuten später 899ms);
// per ENV justierbar (analog MAX_BYTES).
const TIMEOUT_MS = Number(process.env.WEB_FETCH_TIMEOUT_MS) || 25_000;
// ENV-Override v.a. für Tests (kleine Grenze → Truncation deterministisch prüfbar).
const MAX_BYTES = Number(process.env.WEB_FETCH_MAX_BYTES) || 2 * 1024 * 1024;

// Content-Type-Allowlist: Text/JSON/XML (inkl. +json/+xml-Suffixe). Sonst Reject.
const ALLOWED_CONTENT_TYPES: RegExp[] = [
  /^text\//i,
  /^application\/(?:[\w.+-]+\+)?json\b/i,
  /^application\/(?:[\w.+-]+\+)?xml\b/i,
];

function pickHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function isAllowedContentType(ct: string | undefined): boolean {
  return !!ct && ALLOWED_CONTENT_TYPES.some((re) => re.test(ct));
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  truncated: boolean;
}

/**
 * Ein einzelner GET gegen die GEPRÜFTE IP. IP-Pinning via custom `lookup` →
 * Connect auf `pinnedIp`, aber Host/SNI = url.hostname. Bei 3xx wird der Body
 * verworfen (Caller liest Location + re-validiert). Bei Nicht-3xx greift das
 * Content-Type-Gate VOR dem Lesen, dann Streaming mit Byte-Cap (Abbruch, kein
 * Voll-Download).
 */
function getPinned(
  url: URL,
  pinnedIp: string,
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const family = isIP(pinnedIp) || 4;

    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          "User-Agent": NOLMI_UA,
          Accept: "text/*, application/json, application/xml;q=0.9, */*;q=0.1",
          Host: url.host,
        },
        // 🔴 DNS-Rebinding-Schutz: NUR auf die geprüfte IP verbinden. net.Socket
        // ruft lookup mit options.all=true → Callback erwartet ein Array
        // [{address, family}]; ohne all die Einzelform (err, address, family).
        lookup: (
          _hostname: string,
          options: { all?: boolean },
          cb: (
            err: NodeJS.ErrnoException | null,
            address: string | { address: string; family: number }[],
            family?: number,
          ) => void,
        ) => {
          if (options && options.all) {
            cb(null, [{ address: pinnedIp, family }]);
          } else {
            cb(null, pinnedIp, family);
          }
        },
        signal,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          res.resume(); // drain, Body irrelevant
          resolve({ status, headers: res.headers, body: "", truncated: false });
          return;
        }

        if (!isAllowedContentType(pickHeader(res.headers["content-type"]))) {
          res.destroy();
          reject(
            new SsrfError(
              `Nicht unterstützter Content-Type: ${pickHeader(res.headers["content-type"]) ?? "(keiner)"} — nur text/json/xml`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        };

        res.on("data", (c: Buffer) => {
          if (settled) return;
          const remaining = MAX_BYTES - total;
          if (c.length >= remaining) {
            chunks.push(c.subarray(0, Math.max(0, remaining)));
            total = MAX_BYTES;
            truncated = true;
            res.destroy(); // 🔴 Stream abbrechen statt voll downloaden
            done();
            return;
          }
          chunks.push(c);
          total += c.length;
        });
        res.on("end", done);
        res.on("close", () => {
          if (truncated) done();
        });
        res.on("error", (err) => {
          if (!settled) reject(err);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function errResult(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Ergebnis von executeWebFetch — Erfolg mit Body oder sauberer Fehler-String. */
export type WebFetchResult =
  | {
      ok: true;
      status: number;
      contentType: string | null;
      finalUrl: string;
      truncated: boolean;
      body: string;
    }
  | { ok: false; error: string };

/**
 * Kern-Logik (exportiert für Tests). assertUrlSafe vor jedem Connect; Pinning
 * auf die geprüfte IP; manuelle Redirect-Kette mit Re-Validierung pro Hop.
 * Wirft NIE — jeder Fehler wird als { ok:false, error } zurückgegeben.
 */
export async function executeWebFetch({
  url,
}: {
  url: string;
}): Promise<WebFetchResult> {
  {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      let current = await assertUrlSafe(url); // wirft bei unsicher
      let hops = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const ip = current.addresses[0];
        if (!ip) return errResult("Keine geprüfte IP");
        const res = await getPinned(current.url, ip, ac.signal);

        if (res.status >= 300 && res.status < 400) {
          const loc = pickHeader(res.headers["location"]);
          if (!loc) return errResult(`Redirect ${res.status} ohne Location`);
          if (hops >= MAX_REDIRECTS)
            return errResult(`Zu viele Redirects (>${MAX_REDIRECTS})`);
          hops++;
          // 🔴 Re-Validierung des (evtl. relativen) Redirect-Ziels.
          current = await assertRedirectTargetSafe(current.url.toString(), loc);
          continue;
        }

        return {
          ok: true as const,
          status: res.status,
          contentType: pickHeader(res.headers["content-type"]) ?? null,
          finalUrl: current.url.toString(),
          truncated: res.truncated,
          body: res.body,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError")
        return errResult(
          `Zeitüberschreitung: Die Seite hat nicht innerhalb von ${TIMEOUT_MS / 1000}s geantwortet — evtl. kurz überlastet, später erneut versuchen.`,
        );
      if (err instanceof SsrfError) return errResult(err.message);
      return errResult(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Audit-Record eines web_fetch-Calls — NUR Metadaten, NIE der Body. */
export interface WebFetchAuditRecord {
  url: string;
  ok: boolean;
  status?: number;
  contentType?: string | null;
  bytes?: number;
  truncated?: boolean;
  finalUrl?: string;
  error?: string;
}

const WEB_FETCH_DESCRIPTION =
  "Ruft eine ÖFFENTLICHE http(s)-Webseite per GET ab und gibt den Textinhalt zurück (Recherche, z.B. llms.txt oder JSON-APIs). Nur text/JSON/XML, max ~2 MB. Interne/private/Metadata-Adressen sind blockiert.";

/**
 * Baut das web_fetch-Tool. `onFetch` (optional) bekommt pro Call einen
 * Metadaten-Record (OHNE Body) — der Caller schreibt daraus den Audit-Eintrag.
 * needsApproval:false → auto; Sicherheit liegt im SSRF-Guard, Nachvollziehbarkeit
 * im onFetch-Audit (Pflicht bei „alle Pfade"). onFetch-Fehler brechen den Fetch nie.
 */
export function buildWebFetchTool(
  onFetch?: (record: WebFetchAuditRecord) => void | Promise<void>,
) {
  return tool({
    description: WEB_FETCH_DESCRIPTION,
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe("Vollständige http(s)-URL der öffentlichen Seite"),
    }),
    needsApproval: false,
    execute: async ({ url }: { url: string }): Promise<WebFetchResult> => {
      const result = await executeWebFetch({ url });
      if (onFetch) {
        const record: WebFetchAuditRecord = result.ok
          ? {
              url,
              ok: true,
              status: result.status,
              contentType: result.contentType,
              bytes: result.body.length,
              truncated: result.truncated,
              finalUrl: result.finalUrl,
            }
          : { url, ok: false, error: result.error };
        try {
          await onFetch(record);
        } catch {
          // Audit-Schreibfehler darf den Fetch/Turn nie brechen.
        }
      }
      return result;
    },
  });
}

/** Default-Tool ohne Audit-Recorder (Tests/Back-compat). */
export const webFetchTool = buildWebFetchTool();
