// ─── CLI-PROMPT-HELPERS ──────────────────────────────────────────────────────
//
// Geteilte Stdin-Prompts für interaktive CLI-Skripte (twin:set-api-key,
// twin:onboard, …). Extrahiert beim zweiten Aufruf — `readSecret` lebte vorher
// privat in `set-api-key.ts`; `twin:onboard` braucht denselben Baustein plus
// eine sichtbare Zeilen-Eingabe für die E-Mail.

/**
 * Liest eine sichtbare Zeile von Stdin (mit Echo). Für nicht-geheime Eingaben
 * wie E-Mail oder Twin-Name. TTY und Pipe werden gleich behandelt: bis zum
 * ersten Newline lesen. Carriage-Return wird mit abgeschnitten (Windows-Pipes).
 */
export async function readLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      buf += chunk;
      const i = buf.indexOf("\n");
      if (i >= 0) {
        stdin.pause();
        stdin.removeListener("data", onData);
        stdin.removeListener("error", onErr);
        resolve(buf.slice(0, i).replace(/\r$/, ""));
      }
    };
    const onErr = (err: Error) => {
      stdin.removeListener("data", onData);
      reject(err);
    };
    stdin.on("data", onData);
    stdin.on("error", onErr);
    stdin.resume();
  });
}

// Liest eine Zeile von Stdin OHNE die Eingabe ins Terminal zu echo'en.
// TTY-Fall: setRawMode + manuelles Char-Handling. Non-TTY (z.B. Pipe): nimm
// die erste Zeile wie sie kommt.
//
// Backspace und Ctrl-C werden behandelt; sonstige Steuerzeichen werden als
// Teil des Inputs angenommen, was bei Copy-Paste mit Carriage-Return-fremden
// Quellen mal zu Problemen führen kann — `.trim()` im Caller fängt das.
export async function readSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    return new Promise<string>((resolve, reject) => {
      let buf = "";
      stdin.setEncoding("utf8");
      const onData = (chunk: string) => {
        buf += chunk;
        const i = buf.indexOf("\n");
        if (i >= 0) {
          stdin.pause();
          stdin.removeListener("data", onData);
          stdin.removeListener("error", onErr);
          resolve(buf.slice(0, i));
        }
      };
      const onErr = (err: Error) => {
        stdin.removeListener("data", onData);
        reject(err);
      };
      stdin.on("data", onData);
      stdin.on("error", onErr);
      stdin.resume();
    });
  }

  return new Promise<string>((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let buf = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", handler);
    };
    const handler = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          // Ctrl-C
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Abbruch (Ctrl-C)"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", handler);
    stdin.resume();
  });
}
