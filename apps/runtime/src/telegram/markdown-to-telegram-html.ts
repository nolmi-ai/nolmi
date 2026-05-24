import { marked } from "marked";

// ─── MARKDOWN → TELEGRAM-HTML (#130 Phase 3) ────────────────────────────────
//
// LLM-Antworten kommen als Standard-Markdown. Web-UI rendert via
// react-markdown + remark-gfm. Telegram braucht ein eigenes, sehr enges
// HTML-Subset (Bot-API):
//
//   Erlaubt:  <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>,
//             <a href="">, <code>, <pre>, <blockquote>,
//             <pre><code class="language-X">
//   Verboten: <p>, <h1>–<h6>, <ul>, <ol>, <li>, <br>, <hr>, <table>, <div>,
//             alles andere
//
// Plain-Text-`<` / `>` / `&` müssen escaped werden — marked macht das im
// HTML-Output automatisch. Wir nehmen marked-Output und reduzieren ihn auf
// Telegram-kompatibles HTML: Headings → `<b>`, Listen → `• …`, etc.
//
// Daten-Pfad nach Bau:
//
//   LLM-Output (Markdown)
//       ↓ (twinService.chat → audit.output.reply)
//   Audit-Stream
//       ├─ Frontend (Bubble assistant-branch)
//       │     ↓ ReactMarkdown + remarkGfm → HTML im Browser-DOM
//       │
//       └─ MessageRouter (Telegram-Pfad)
//             ↓ splitMessage (Markdown-Level)
//             ↓ markdownToTelegramHtml (marked + sanitize)
//             ↓ ctx.reply(html, { parse_mode: "HTML" })
//             ↓ Telegram zeigt formatiertes Bot-Message
//
// Persistierter Text in `telegram_messages.text`: Markdown-Original.
// Kein Channel-spezifisches Re-Rendering bei Replay — Audit-Trail bleibt
// channel-agnostisch.

/**
 * Wandelt Markdown in das eng begrenzte HTML-Subset um, das Telegram als
 * `parse_mode: "HTML"` akzeptiert. Reine Pure-Function ohne Side-Effects.
 *
 * Aufrufer (MessageRouter) ist verantwortlich für:
 *   - Splitting des Markdown-Inputs auf Telegram-Length-Limits (<=4096 Zeichen)
 *   - Try/Catch um `ctx.reply(html, { parse_mode: "HTML" })`, weil Telegram
 *     im Edge-Case auch dieses Subset ablehnen kann (z.B. unbalancierter
 *     Tag aus marker-Parse-Glitch) — Fallback ist `ctx.reply(markdown)`
 *     ohne parse_mode.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, {
    async: false,
    // gfm bleibt default-true (Tabellen, Strikethrough, Task-Lists); für
    // Telegram strippen wir die nicht-unterstützten Konstrukte unten.
  }) as string;

  return telegramHtmlSanitize(rawHtml);
}

/**
 * Reduziert marked-HTML auf Telegrams Subset. Behaltene Tags
 * (b/strong/i/em/u/s/del/code/pre/blockquote/a) reisen mit; alles andere
 * wird entweder zu Text geflattet (Headings, Listen, Tabellen) oder
 * geströpt (br/hr/p-Wrapper).
 *
 * Reihenfolge ist relevant: erst Block-Strukturen (h/ul/ol/table) auflösen,
 * dann inline-Aufräumen.
 */
function telegramHtmlSanitize(html: string): string {
  let result = html;

  // Headings → <b>...</b>\n (Telegram hat keine Headers)
  result = result.replace(
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g,
    "<b>$1</b>\n",
  );

  // Bullet-Listen: <ul>...</ul> → die <li>-Inhalte als „• …\n"-Lines
  result = result.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/g, (_, content: string) =>
    content.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, "• $1\n"),
  );

  // Nummerierte Listen: <ol>...</ol> → fortlaufend nummerieren
  result = result.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/g, (_, content: string) => {
    let counter = 1;
    return content.replace(
      /<li[^>]*>([\s\S]*?)<\/li>/g,
      // String.replace ersetzt `$1` NUR wenn das Replacement ein String ist;
      // bei Callback-Returns wird der Rückgabewert wörtlich eingesetzt. Daher
      // das captured Group via Callback-Argument verwenden.
      (_match, item: string) => `${counter++}. ${item}\n`,
    );
  });

  // Tabellen (aus gfm) — zu komplex für Telegram. Strip auf Plain-Text:
  // <thead>/<tbody>/<tr> raus, <th>/<td>-Inhalte mit „ | " trennen.
  result = result.replace(
    /<table[^>]*>([\s\S]*?)<\/table>/g,
    (_, content: string) => {
      const rows = content
        .replace(/<\/?(thead|tbody|tfoot)[^>]*>/g, "")
        .split(/<\/?tr[^>]*>/g)
        .map((row) => {
          const cells = row.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/g);
          if (!cells || cells.length === 0) return "";
          return cells
            .map((c) => c.replace(/<\/?[^>]+>/g, "").trim())
            .filter(Boolean)
            .join(" | ");
        })
        .filter((line) => line.length > 0);
      return rows.join("\n") + "\n";
    },
  );

  // Paragraph-Wrapper raus — Telegram nutzt Doppel-Newline statt <p>.
  // Vorsicht: `<p[^>]*>` würde auch `<pre>` matchen (Prefix-Treffer); deshalb
  // mit Wort-Grenze nach dem `p` arbeiten (nur Whitespace oder schließendes
  // `>` darf folgen).
  result = result.replace(/<p(?=\s|>)[^>]*>/g, "");
  result = result.replace(/<\/p>/g, "\n\n");

  // Soft-Breaks → \n
  result = result.replace(/<br\s*\/?>/g, "\n");
  // Horizontal-Rules → Text-Trenner
  result = result.replace(/<hr\s*\/?>/g, "\n---\n");

  // Verbleibende nicht-erlaubte Tags strippen (Tag-Wrap entfernen, Inhalt
  // behalten). Whitelist: b/strong/i/em/u/ins/s/strike/del/a/code/pre/
  // blockquote. Alles andere fliegt raus.
  result = result.replace(
    /<(?!\/?(?:b|strong|i|em|u|ins|s|strike|del|a|code|pre|blockquote)\b)[^>]+>/g,
    "",
  );

  // Aufräumen: mehrfache Leerzeilen kollabieren, trim
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}
