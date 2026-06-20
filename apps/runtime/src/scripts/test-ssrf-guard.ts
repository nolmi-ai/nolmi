import {
  assertUrlSafe,
  assertRedirectTargetSafe,
  SsrfError,
} from "../web-fetch/ssrf-guard.js";

// ─── SSRF-GUARD UNIT-TESTS ───────────────────────────────────────────────────
// MUSS gegen echte Angriffs-URLs grün sein. Blocked-Fälle sind großteils
// literal/DNS-fehlschlag (kein Netz nötig); Allowed-Fälle brauchen echtes DNS.

const BLOCKED: { url: string; note?: string }[] = [
  { url: "http://localhost/" },
  { url: "http://127.0.0.1/" },
  { url: "http://127.0.0.1:4000/", note: "eigene Runtime" },
  { url: "http://[::1]/" },
  { url: "http://169.254.169.254/", note: "🔴 Cloud-Metadata" },
  { url: "http://169.254.169.254/latest/meta-data/", note: "🔴 Metadata-Pfad" },
  { url: "http://10.0.0.1/" },
  { url: "http://172.16.0.1/" },
  { url: "http://192.168.1.1/" },
  { url: "http://nolmi-bridge:5100/", note: "🔴 Docker-intern" },
  { url: "http://2130706433/", note: "🔴 dezimal = 127.0.0.1" },
  { url: "http://0x7f000001/", note: "🔴 hex = 127.0.0.1" },
  { url: "http://[::ffff:127.0.0.1]/", note: "🔴 IPv4-mapped IPv6" },
  { url: "http://0.0.0.0/" },
  { url: "http://100.64.0.1/", note: "CGNAT" },
  { url: "file:///etc/passwd", note: "non-http scheme" },
  { url: "gopher://evil/", note: "non-http scheme" },
  { url: "ftp://evil/", note: "non-http scheme" },
];

const ALLOWED: { url: string; note?: string }[] = [
  { url: "https://example.com/", note: "braucht DNS" },
  { url: "https://www.harwayexperience.com/llms.txt", note: "braucht DNS" },
  { url: "https://www.harwayexperience.com/api/agent/workshops", note: "braucht DNS" },
];

async function run(): Promise<void> {
  let blockedOk = 0;
  let allowedOk = 0;

  console.log("=== 🔴 BLOCKIERT (muss werfen) ===");
  for (const c of BLOCKED) {
    let verdict: string;
    let ok: boolean;
    try {
      await assertUrlSafe(c.url);
      verdict = "❌ DURCHGELASSEN";
      ok = false;
    } catch (err) {
      const reason = err instanceof SsrfError ? err.message : `(${String(err)})`;
      verdict = `✅ blockiert — ${reason}`;
      ok = true;
    }
    if (ok) blockedOk++;
    console.log(`  ${verdict}\n      ${c.url}${c.note ? "  [" + c.note + "]" : ""}`);
  }

  console.log("\n=== Redirect-auf-Metadata (302 → 169.254.169.254) ===");
  let redirectOk = false;
  try {
    await assertRedirectTargetSafe("https://example.com/start", "http://169.254.169.254/");
    console.log("  ❌ DURCHGELASSEN — Redirect-Ziel nicht geprüft!");
  } catch (err) {
    redirectOk = true;
    console.log(`  ✅ Redirect-Hop blockiert — ${err instanceof SsrfError ? err.message : err}`);
  }

  console.log("\n=== ✅ ERLAUBT (muss durchgehen; braucht Netz/DNS) ===");
  for (const c of ALLOWED) {
    try {
      const { addresses } = await assertUrlSafe(c.url);
      allowedOk++;
      console.log(`  ✅ erlaubt → ${addresses.join(", ")}\n      ${c.url}`);
    } catch (err) {
      console.log(
        `  ⚠ geworfen (DNS/Netz?) — ${err instanceof SsrfError ? err.message : err}\n      ${c.url}`,
      );
    }
  }

  console.log(
    `\n=== Ergebnis: BLOCKIERT ${blockedOk}/${BLOCKED.length}, Redirect ${redirectOk ? "✅" : "❌"}, ERLAUBT ${allowedOk}/${ALLOWED.length} ===`,
  );
  if (blockedOk !== BLOCKED.length || !redirectOk) {
    console.error("🔴 SICHERHEITS-LÜCKE: nicht alle Angriffs-Fälle blockiert!");
    process.exit(1);
  }
}

void run();
