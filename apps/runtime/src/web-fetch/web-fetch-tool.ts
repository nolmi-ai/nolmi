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

const TIMEOUT_MS = 10_000;
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
        return errResult(`Timeout nach ${TIMEOUT_MS}ms`);
      if (err instanceof SsrfError) return errResult(err.message);
      return errResult(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** AI-SDK-Tool-Wrapper um executeWebFetch. needsApproval:false → auto. */
export const webFetchTool = tool({
  description:
    "Ruft eine ÖFFENTLICHE http(s)-Webseite per GET ab und gibt den Textinhalt zurück (Recherche, z.B. llms.txt oder JSON-APIs). Nur text/JSON/XML, max ~2 MB. Interne/private/Metadata-Adressen sind blockiert.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("Vollständige http(s)-URL der öffentlichen Seite"),
  }),
  needsApproval: false,
  execute: executeWebFetch,
});
