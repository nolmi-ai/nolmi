import { connect } from "node:net";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Einzelner TCP-Connect-Versuch auf 127.0.0.1:port (kurzes Timeout). */
function tcpOpen(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/**
 * Wartet, bis der Runtime-Port auf 127.0.0.1 Connects annimmt. Das ist das
 * Signal, dass der Container gebootet UND die Migrationen durch sind (Container-
 * CMD ist `init-db.js && node index.js` → der Server lauscht erst NACH der
 * Migration). Erst dann ist `onboard` sinnvoll.
 *
 * Pollt lokal 127.0.0.1 unabhängig von NOLMI_HOST: der Wrapper läuft AUF dem
 * Server, der Host-Port ist immer lokal gemappt (NOLMI_HOST ist nur die
 * Browser-Adresse).
 *
 * @returns true wenn rechtzeitig erreichbar, false bei Timeout.
 */
export async function waitForPort(
  port: number,
  timeoutMs: number,
  onTick?: (secondsWaited: number) => void,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await tcpOpen(port, 2000)) return true;
    onTick?.(Math.round((Date.now() - start) / 1000));
    await sleep(2000);
  }
  return false;
}
