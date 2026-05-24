// ─── MessageChannelBadge (#130 Phase 3 v2) ───────────────────────────────────
//
// Icon-only Marker im Bubble-Header (oben rechts, neben TWIN/DU-Label) wenn
// die Nachricht nicht aus dem Web-Channel kam. Inline-SVG (Lucide-`Send`-
// Paper-Plane), keine Library-Dependency. Web-Channel-Default → null,
// Bubble bleibt visuell unverändert.
//
// Tooltip via SVG-`<title>` als erstes Child statt HTML `title=`-Attribut.
// SVG-Tooltip hat kürzere Browser-Hover-Latenz (~100-200ms vs ~500ms) und
// ist robuster gegen Discoverability-Probleme (v1-Subline-Text wurde wegen
// Read-Flow-Distanz oft nicht entdeckt).
//
// Accessibility: `role="img"` + `aria-label` machen das Icon Screen-Reader-
// lesbar — sonst wäre der Icon-Only-Marker für SR-Nutzer unsichtbar.

type Channel = "web" | "telegram" | "discord" | "whatsapp";

interface Props {
  channel?: Channel;
}

const TOOLTIP_TEXT: Record<Exclude<Channel, "web">, string> = {
  telegram:
    "Diese Nachricht kam via Telegram. Web-Nachrichten erscheinen nicht in Telegram, aber dein Twin erinnert sich kanal-übergreifend.",
  discord:
    "Diese Nachricht kam via Discord. Web-Nachrichten erscheinen nicht in Discord, aber dein Twin erinnert sich kanal-übergreifend.",
  whatsapp:
    "Diese Nachricht kam via WhatsApp. Web-Nachrichten erscheinen nicht in WhatsApp, aber dein Twin erinnert sich kanal-übergreifend.",
};

export function MessageChannelBadge({ channel }: Props) {
  if (!channel || channel === "web") return null;
  const tooltipText = TOOLTIP_TEXT[channel];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted cursor-help shrink-0"
      role="img"
      aria-label={tooltipText}
    >
      <title>{tooltipText}</title>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
