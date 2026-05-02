"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── ONBOARDING WIZARD ──────────────────────────────────────────────────────
//
// 8-Step-Flow für neue Twins. State liegt im Memory dieser Page (kein URL-
// Anchor pro Step) — bewusst flach gehalten, weil Browser-Back den Wizard
// sonst kaputt-springen würde.
//
// Steps:
//   0  Pfad-Wahl                  → 'hosted' | 'self-hosted'
//   1  Persona — Wer bist du?
//   2  Persona — Wie redest du?
//   3  Persona — Worüber sprichst du gern?
//   4  Mandate-Template
//   5  LLM + API-Key (mit Validation-Button)
//   6  Bridge — nur Info
//   7  Review + Submit
//
// Bei Step-0-Wahl 'self-hosted' wird Goodbye gezeigt statt weiter; das ist
// kein Schritt 1.

// ─── TYPES ──────────────────────────────────────────────────────────────────

type Tone = "direct" | "polite" | "casual" | "formal";
type Pronoun = "du" | "sie" | "context-dependent";
type Preference = "no-emojis" | "no-platitudes" | "short-answers";
type MandateTemplateId = "cautious" | "trusting" | "business";
type LlmProvider = "anthropic" | "openai";

interface Relationship {
  name: string;
  description: string;
}

interface PersonaState {
  fullName: string;
  handle: string;
  role: string;
  tone: Tone[];
  pronoun: Pronoun;
  preferences: Preference[];
  topics: string[];
  relationships: Relationship[];
}

const STEP_LABELS: string[] = [
  "Pfad",
  "Wer bist du?",
  "Wie redest du?",
  "Worüber sprichst du?",
  "Mandate",
  "LLM + API-Key",
  "Bridge",
  "Review",
];

const TOTAL_STEPS = STEP_LABELS.length; // 8

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();

  // Gate: bevor der Wizard rendert, muss ein Account existieren UND
  // der User muss eingeloggt sein.
  const [accountReady, setAccountReady] = useState(false);

  if (!accountReady) {
    return <AccountBlock onReady={() => setAccountReady(true)} />;
  }

  return <WizardInner router={router} />;
}

// Sub-Page für den eigentlichen Wizard-State, nachdem Account bestätigt ist.
function WizardInner({ router }: { router: ReturnType<typeof useRouter> }) {
  const [step, setStep] = useState(0);
  const [pathChoice, setPathChoice] = useState<"hosted" | "self-hosted" | null>(null);

  const [persona, setPersona] = useState<PersonaState>({
    fullName: "",
    handle: "",
    role: "",
    tone: [],
    pronoun: "du",
    preferences: [],
    topics: [],
    relationships: [],
  });
  const [mandateTemplate, setMandateTemplate] = useState<MandateTemplateId>("cautious");
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("anthropic");
  const [llmModel, setLlmModel] = useState("claude-opus-4-7");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyValidated, setApiKeyValidated] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const [handleStatus, setHandleStatus] = useState<HandleStatus>({ kind: "idle" });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Self-Hosted-Pfad: vollständig anderer Screen.
  if (pathChoice === "self-hosted") {
    return <GoodbyeScreen />;
  }

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const canAdvance = stepIsComplete(step, {
    pathChoice,
    persona,
    handleStatus,
    apiKeyValidated,
  });

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/onboarding/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          mandateTemplate,
          llmConfig: { provider: llmProvider, model: llmModel, apiKey },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.replace(`/chat/${persona.handle}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-text">Twin anlegen</h1>
        <div className="text-xs text-muted">
          Schritt {step + 1} von {TOTAL_STEPS}
          {" — "}
          <span className="text-text">{STEP_LABELS[step]}</span>
        </div>
      </header>

      <main className="space-y-6">
        {step === 0 && (
          <PathChoiceBlock
            value={pathChoice}
            onChoose={(v) => {
              setPathChoice(v);
              if (v === "hosted") goNext();
            }}
          />
        )}
        {step === 1 && (
          <PersonaWhoBlock
            persona={persona}
            setPersona={setPersona}
            handleStatus={handleStatus}
            setHandleStatus={setHandleStatus}
          />
        )}
        {step === 2 && (
          <PersonaToneBlock persona={persona} setPersona={setPersona} />
        )}
        {step === 3 && (
          <PersonaTopicsBlock persona={persona} setPersona={setPersona} />
        )}
        {step === 4 && (
          <MandateTemplateBlock value={mandateTemplate} onChange={setMandateTemplate} />
        )}
        {step === 5 && (
          <LlmConfigBlock
            provider={llmProvider}
            setProvider={(p) => {
              setLlmProvider(p);
              setLlmModel(p === "anthropic" ? "claude-opus-4-7" : "gpt-5.5");
              setApiKeyValidated(false);
              setApiKeyError(null);
            }}
            model={llmModel}
            setModel={setLlmModel}
            apiKey={apiKey}
            setApiKey={(k) => {
              setApiKey(k);
              setApiKeyValidated(false);
              setApiKeyError(null);
            }}
            apiKeyValidated={apiKeyValidated}
            apiKeyError={apiKeyError}
            validating={validating}
            onTest={async () => {
              setValidating(true);
              setApiKeyError(null);
              try {
                const res = await fetch(`${RUNTIME_URL}/onboarding/validate-api-key`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ provider: llmProvider, model: llmModel, apiKey }),
                });
                const body = (await res.json()) as
                  | { valid: true }
                  | { valid: false; reason: string };
                if (!res.ok) {
                  throw new Error("error" in body ? (body as { error: string }).error : `HTTP ${res.status}`);
                }
                if (body.valid) {
                  setApiKeyValidated(true);
                  goNext();
                } else {
                  setApiKeyError(body.reason);
                }
              } catch (err) {
                setApiKeyError(err instanceof Error ? err.message : "Validation failed");
              } finally {
                setValidating(false);
              }
            }}
          />
        )}
        {step === 6 && <BridgeBlock handle={persona.handle} />}
        {step === 7 && (
          <ReviewBlock
            persona={persona}
            mandateTemplate={mandateTemplate}
            llmProvider={llmProvider}
            llmModel={llmModel}
            apiKey={apiKey}
            submitting={submitting}
            submitError={submitError}
            onSubmit={submit}
          />
        )}
      </main>

      {/* Step-Nav: Block 0 hat schon Auto-Advance, Block 5 hat eigenen "Testen"-Button */}
      {step > 0 && step !== 5 && step !== 7 && (
        <footer className="flex justify-between border-t border-border pt-4">
          <button
            onClick={goBack}
            className="text-sm text-muted hover:text-text transition-colors"
          >
            ← Zurück
          </button>
          <button
            onClick={goNext}
            disabled={!canAdvance}
            className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
          >
            Weiter →
          </button>
        </footer>
      )}
      {step === 5 && (
        <footer className="flex justify-between border-t border-border pt-4">
          <button
            onClick={goBack}
            className="text-sm text-muted hover:text-text transition-colors"
          >
            ← Zurück
          </button>
          <span className="text-xs text-muted">
            Klick "Testen" — bei Erfolg geht's automatisch weiter.
          </span>
        </footer>
      )}
      {step === 7 && (
        <footer className="flex justify-between border-t border-border pt-4">
          <button
            onClick={goBack}
            disabled={submitting}
            className="text-sm text-muted hover:text-text transition-colors disabled:opacity-30"
          >
            ← Zurück
          </button>
        </footer>
      )}
    </div>
  );
}

// ─── STEP-COMPLETION ────────────────────────────────────────────────────────

interface StepGate {
  pathChoice: "hosted" | "self-hosted" | null;
  persona: PersonaState;
  handleStatus: HandleStatus;
  apiKeyValidated: boolean;
}

function stepIsComplete(step: number, g: StepGate): boolean {
  switch (step) {
    case 0:
      return g.pathChoice === "hosted";
    case 1:
      return (
        g.persona.fullName.trim().length > 0 &&
        g.persona.role.trim().length > 0 &&
        g.handleStatus.kind === "available"
      );
    case 2:
      return g.persona.tone.length >= 1;
    case 3:
      return g.persona.topics.length >= 1;
    case 4:
      return true; // immer ein Default gesetzt
    case 5:
      return g.apiKeyValidated;
    case 6:
      return true;
    case 7:
      return true;
    default:
      return false;
  }
}

// ─── BLOCK 0: PFAD-WAHL ─────────────────────────────────────────────────────

function PathChoiceBlock({
  value,
  onChoose,
}: {
  value: "hosted" | "self-hosted" | null;
  onChoose: (v: "hosted" | "self-hosted") => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Wie willst du den Twin betreiben? Du kannst die Wahl später nicht
        einfach ändern — beim Self-Hosted bist du selbst für Setup und Wartung
        verantwortlich.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <button
          onClick={() => onChoose("hosted")}
          className={`text-left p-5 rounded border transition-colors ${
            value === "hosted"
              ? "border-accent bg-surface"
              : "border-border bg-surface hover:border-accent"
          }`}
        >
          <div className="text-xs uppercase tracking-wider text-accent mb-2">
            Empfohlen
          </div>
          <div className="text-base text-text font-semibold mb-1">Hosted</div>
          <div className="text-xs text-muted">
            Wir hosten den Twin. Du bringst nur deinen API-Key mit.
          </div>
        </button>
        <button
          onClick={() => onChoose("self-hosted")}
          className={`text-left p-5 rounded border transition-colors ${
            value === "self-hosted"
              ? "border-accent bg-surface"
              : "border-border bg-surface hover:border-accent"
          }`}
        >
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Für Entwickler
          </div>
          <div className="text-base text-text font-semibold mb-1">Self-Hosted</div>
          <div className="text-xs text-muted">
            Klone das Repo, baue selbst. Volle Kontrolle, keine Garantien.
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── BLOCK A.1: WER BIST DU? ────────────────────────────────────────────────

type HandleStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; suggestions: string[] }
  | { kind: "error"; reason: string };

function PersonaWhoBlock({
  persona,
  setPersona,
  handleStatus,
  setHandleStatus,
}: {
  persona: PersonaState;
  setPersona: React.Dispatch<React.SetStateAction<PersonaState>>;
  handleStatus: HandleStatus;
  setHandleStatus: (s: HandleStatus) => void;
}) {
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const onHandleChange = (raw: string) => {
    // Auto-Prefix @, lowercase, special chars raus
    let cleaned = raw.toLowerCase().replace(/[^a-z0-9_@-]/g, "");
    if (cleaned && !cleaned.startsWith("@")) cleaned = "@" + cleaned;
    setPersona((p) => ({ ...p, handle: cleaned }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!cleaned || cleaned === "@") {
      setHandleStatus({ kind: "idle" });
      return;
    }
    setHandleStatus({ kind: "checking" });
    debounceRef.current = setTimeout(() => checkHandle(cleaned, setHandleStatus), 500);
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Voller Name
        </label>
        <input
          type="text"
          value={persona.fullName}
          onChange={(e) => setPersona((p) => ({ ...p, fullName: e.target.value }))}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Heiko Gregor"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Handle
        </label>
        <input
          type="text"
          value={persona.handle}
          onChange={(e) => onHandleChange(e.target.value)}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
          placeholder="@heiko"
        />
        <HandleStatusLabel status={handleStatus} onPick={(h) => onHandleChange(h)} />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Rolle
        </label>
        <input
          type="text"
          value={persona.role}
          onChange={(e) => setPersona((p) => ({ ...p, role: e.target.value }))}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Co-Founder bei HARWAY Experience"
        />
      </div>
    </div>
  );
}

function HandleStatusLabel({
  status,
  onPick,
}: {
  status: HandleStatus;
  onPick: (handle: string) => void;
}) {
  if (status.kind === "idle") return null;
  if (status.kind === "checking") {
    return <div className="text-xs text-muted mt-1">Wird geprüft…</div>;
  }
  if (status.kind === "available") {
    return <div className="text-xs text-accent mt-1">✓ Verfügbar</div>;
  }
  if (status.kind === "taken") {
    return (
      <div className="text-xs text-warn mt-1">
        ✗ Vergeben
        {status.suggestions.length > 0 && (
          <span className="text-muted">
            {" — Vorschläge: "}
            {status.suggestions.map((s, i) => (
              <button
                key={s}
                onClick={() => onPick(s)}
                className="text-accent hover:underline mx-1"
              >
                {s}
              </button>
            )).reduce((acc, el, i) => (i === 0 ? [el] : [...acc, " ", el]), [] as React.ReactNode[])}
          </span>
        )}
      </div>
    );
  }
  return <div className="text-xs text-warn mt-1">✗ Fehler: {status.reason}</div>;
}

async function checkHandle(handle: string, setStatus: (s: HandleStatus) => void) {
  try {
    const res = await fetch(
      `${RUNTIME_URL}/onboarding/check-handle?handle=${encodeURIComponent(handle)}`,
      { credentials: "include" },
    );
    const body = (await res.json()) as
      | { available: true }
      | { available: false; suggestions: string[] }
      | { error: string };
    if (!res.ok) {
      setStatus({ kind: "error", reason: "error" in body ? body.error : `HTTP ${res.status}` });
      return;
    }
    if ("available" in body && body.available) {
      setStatus({ kind: "available" });
    } else if ("available" in body && !body.available) {
      setStatus({ kind: "taken", suggestions: body.suggestions });
    }
  } catch (err) {
    setStatus({ kind: "error", reason: err instanceof Error ? err.message : "Network" });
  }
}

// ─── BLOCK A.2: TONFALL/STIL/PRÄFERENZEN ────────────────────────────────────

const TONE_OPTIONS: { id: Tone; label: string }[] = [
  { id: "direct", label: "Direkt" },
  { id: "polite", label: "Höflich" },
  { id: "casual", label: "Locker" },
  { id: "formal", label: "Formell" },
];
const PREFERENCE_OPTIONS: { id: Preference; label: string }[] = [
  { id: "no-emojis", label: "Keine Emojis" },
  { id: "no-platitudes", label: "Keine Floskeln" },
  { id: "short-answers", label: "Knappe Antworten" },
];

function PersonaToneBlock({
  persona,
  setPersona,
}: {
  persona: PersonaState;
  setPersona: React.Dispatch<React.SetStateAction<PersonaState>>;
}) {
  const toggleTone = (t: Tone) =>
    setPersona((p) => ({
      ...p,
      tone: p.tone.includes(t) ? p.tone.filter((x) => x !== t) : [...p.tone, t],
    }));
  const togglePref = (pref: Preference) =>
    setPersona((p) => ({
      ...p,
      preferences: p.preferences.includes(pref)
        ? p.preferences.filter((x) => x !== pref)
        : [...p.preferences, pref],
    }));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">
          Tonfall (mind. 1)
        </div>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((opt) => (
            <Pill
              key={opt.id}
              label={opt.label}
              active={persona.tone.includes(opt.id)}
              onClick={() => toggleTone(opt.id)}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">Pronomen</div>
        <div className="flex flex-wrap gap-2">
          {(["du", "sie", "context-dependent"] as const).map((p) => (
            <Pill
              key={p}
              label={p === "du" ? "Du" : p === "sie" ? "Sie" : "Je nach Kontext"}
              active={persona.pronoun === p}
              onClick={() => setPersona((s) => ({ ...s, pronoun: p }))}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">
          Sonderwünsche (optional)
        </div>
        <div className="flex flex-wrap gap-2">
          {PREFERENCE_OPTIONS.map((opt) => (
            <Pill
              key={opt.id}
              label={opt.label}
              active={persona.preferences.includes(opt.id)}
              onClick={() => togglePref(opt.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs border rounded transition-colors ${
        active
          ? "border-accent text-accent bg-surface"
          : "border-border text-muted hover:border-accent hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

// ─── BLOCK A.3: THEMEN + BEZIEHUNGEN ────────────────────────────────────────

function PersonaTopicsBlock({
  persona,
  setPersona,
}: {
  persona: PersonaState;
  setPersona: React.Dispatch<React.SetStateAction<PersonaState>>;
}) {
  const [topicInput, setTopicInput] = useState("");
  const [relName, setRelName] = useState("");
  const [relDesc, setRelDesc] = useState("");
  const [existingTwins, setExistingTwins] = useState<{ handle: string; displayName: string }[]>([]);

  useEffect(() => {
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: { twins: { handle: string; displayName: string }[] }) =>
        setExistingTwins(data.twins),
      )
      .catch(() => {});
  }, []);

  const addTopic = () => {
    const t = topicInput.trim();
    if (!t) return;
    setPersona((p) => ({ ...p, topics: [...p.topics, t] }));
    setTopicInput("");
  };
  const rmTopic = (i: number) =>
    setPersona((p) => ({ ...p, topics: p.topics.filter((_, idx) => idx !== i) }));

  const addRel = () => {
    const n = relName.trim();
    const d = relDesc.trim();
    if (!n || !d) return;
    setPersona((p) => ({ ...p, relationships: [...p.relationships, { name: n, description: d }] }));
    setRelName("");
    setRelDesc("");
  };
  const rmRel = (i: number) =>
    setPersona((p) => ({
      ...p,
      relationships: p.relationships.filter((_, idx) => idx !== i),
    }));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">
          Themen (mind. 1)
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTopic())}
            className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            placeholder="z.B. Design Systems"
          />
          <button
            onClick={addTopic}
            className="px-3 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
          >
            +
          </button>
        </div>
        {persona.topics.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {persona.topics.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded text-text"
              >
                {t}
                <button
                  onClick={() => rmTopic(i)}
                  className="text-muted hover:text-warn"
                  aria-label="Entfernen"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">
          Beziehungen (optional)
        </div>
        {existingTwins.length > 0 && (
          <div className="text-xs text-muted mb-2">
            Vorschlag: bestehende Twins —{" "}
            {existingTwins.map((t) => `${t.displayName} (${t.handle})`).join(", ")}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={relName}
            onChange={(e) => setRelName(e.target.value)}
            className="w-1/3 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            placeholder="Markus Baier"
          />
          <input
            type="text"
            value={relDesc}
            onChange={(e) => setRelDesc(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            placeholder="Co-Founder bei HARWAY Experience"
          />
          <button
            onClick={addRel}
            className="px-3 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
          >
            +
          </button>
        </div>
        {persona.relationships.length > 0 && (
          <ul className="mt-3 space-y-1">
            {persona.relationships.map((r, i) => (
              <li
                key={i}
                className="flex items-start justify-between text-sm text-text border-b border-border py-1.5"
              >
                <span>
                  <span className="text-text">{r.name}</span>
                  <span className="text-muted"> — {r.description}</span>
                </span>
                <button
                  onClick={() => rmRel(i)}
                  className="text-muted hover:text-warn text-xs"
                >
                  entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── BLOCK B: MANDATE-TEMPLATE ──────────────────────────────────────────────

const MANDATE_TEMPLATES: {
  id: MandateTemplateId;
  name: string;
  description: string;
  bullets: string[];
}[] = [
  {
    id: "cautious",
    name: "Vorsichtig",
    description: "Default. Alles geht erst durch deine Approval.",
    bullets: [
      "Chat-Antworten: nur nach Freigabe",
      "Twin-Nachrichten: nur nach Freigabe",
      "Recherche, Termine: deaktiviert",
    ],
  },
  {
    id: "trusting",
    name: "Vertrauensvoll",
    description: "Alltägliches läuft autonom — sensible Themen brauchen Approval.",
    bullets: [
      "Chat-Antworten: ohne Freigabe",
      "Twin-Nachrichten: ohne Freigabe — außer bei Termin/Geld/Vertrag",
      "Recherche: autonom",
    ],
  },
  {
    id: "business",
    name: "Geschäftlich",
    description: "Business-Mode. Privates wird abgewiesen.",
    bullets: [
      "Chat: nur geschäftliche Themen, mit Freigabe",
      "Twin-Nachrichten: mit Freigabe",
      "Recherche: autonom; Termine: mit Freigabe",
    ],
  },
];

function MandateTemplateBlock({
  value,
  onChange,
}: {
  value: MandateTemplateId;
  onChange: (id: MandateTemplateId) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Was darf der Twin in deinem Namen tun? Du kannst diese Einstellung
        später jederzeit ändern.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {MANDATE_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => onChange(tpl.id)}
            className={`text-left p-4 rounded border transition-colors h-full ${
              value === tpl.id
                ? "border-accent bg-surface"
                : "border-border bg-surface hover:border-accent"
            }`}
          >
            <div className="text-base text-text font-semibold mb-1">{tpl.name}</div>
            <div className="text-xs text-muted mb-3">{tpl.description}</div>
            <ul className="text-xs text-muted space-y-1">
              {tpl.bullets.map((b, i) => (
                <li key={i}>- {b}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── BLOCK C: LLM + API-KEY ─────────────────────────────────────────────────

function LlmConfigBlock({
  provider,
  setProvider,
  model,
  setModel,
  apiKey,
  setApiKey,
  apiKeyValidated,
  apiKeyError,
  validating,
  onTest,
}: {
  provider: LlmProvider;
  setProvider: (p: LlmProvider) => void;
  model: string;
  setModel: (m: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  apiKeyValidated: boolean;
  apiKeyError: string | null;
  validating: boolean;
  onTest: () => void;
}) {
  const keyHelpUrl = useMemo(
    () =>
      provider === "anthropic"
        ? "https://console.anthropic.com/settings/keys"
        : "https://platform.openai.com/api-keys",
    [provider],
  );

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">Provider</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            onClick={() => setProvider("anthropic")}
            className={`text-left p-4 rounded border transition-colors ${
              provider === "anthropic"
                ? "border-accent bg-surface"
                : "border-border bg-surface hover:border-accent"
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-accent mb-1">
              Empfohlen
            </div>
            <div className="text-sm text-text font-mono">anthropic / claude-opus-4-7</div>
            <div className="text-xs text-muted mt-1">~$0,015 / Antwort</div>
          </button>
          <button
            onClick={() => setProvider("openai")}
            className={`text-left p-4 rounded border transition-colors ${
              provider === "openai"
                ? "border-accent bg-surface"
                : "border-border bg-surface hover:border-accent"
            }`}
          >
            <div className="text-sm text-text font-mono">openai / gpt-5.5</div>
            <div className="text-xs text-muted mt-1">~$0,008 / Antwort</div>
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Model
        </label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          API-Key{" "}
          <a
            href={keyHelpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline ml-1 normal-case tracking-normal"
          >
            (hier holen)
          </a>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
          placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
        />
        {apiKeyError && (
          <div className="text-xs text-warn mt-1">✗ {apiKeyError}</div>
        )}
        {apiKeyValidated && (
          <div className="text-xs text-accent mt-1">✓ Key funktioniert</div>
        )}
        <button
          onClick={onTest}
          disabled={validating || !apiKey.trim()}
          className="mt-3 px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
        >
          {validating ? "Teste…" : "Testen"}
        </button>
      </div>
    </div>
  );
}

// ─── BLOCK D: BRIDGE ────────────────────────────────────────────────────────

function BridgeBlock({ handle }: { handle: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Dein Twin braucht einen Eintrag an der Bridge — der Hub, über den Twins
        miteinander reden. Wird beim Submit automatisch angelegt, du musst nichts
        konfigurieren.
      </p>
      <dl className="text-sm space-y-2 bg-surface border border-border rounded p-4">
        <div className="flex gap-2">
          <dt className="text-xs uppercase tracking-wider text-muted w-24">Bridge</dt>
          <dd className="text-text font-mono text-xs">http://127.0.0.1:5100</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-xs uppercase tracking-wider text-muted w-24">Handle</dt>
          <dd className="text-text font-mono text-xs">{handle || "(noch leer)"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-xs uppercase tracking-wider text-muted w-24">Status</dt>
          <dd className="text-muted text-xs">Wird beim Submit angelegt</dd>
        </div>
      </dl>
    </div>
  );
}

// ─── BLOCK E: REVIEW + SUBMIT ───────────────────────────────────────────────

function ReviewBlock({
  persona,
  mandateTemplate,
  llmProvider,
  llmModel,
  apiKey,
  submitting,
  submitError,
  onSubmit,
}: {
  persona: PersonaState;
  mandateTemplate: MandateTemplateId;
  llmProvider: LlmProvider;
  llmModel: string;
  apiKey: string;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  const apiKeyMasked = apiKey.length >= 9 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : "…";
  return (
    <div className="space-y-5">
      <Section title="Persona">
        <ReviewRow label="Name" value={persona.fullName} />
        <ReviewRow label="Handle" value={persona.handle} mono />
        <ReviewRow label="Rolle" value={persona.role} />
        <ReviewRow label="Tonfall" value={persona.tone.join(", ") || "—"} />
        <ReviewRow
          label="Pronomen"
          value={persona.pronoun === "context-dependent" ? "kontextabhängig" : persona.pronoun}
        />
        {persona.preferences.length > 0 && (
          <ReviewRow label="Sonderwünsche" value={persona.preferences.join(", ")} />
        )}
        <ReviewRow label="Themen" value={persona.topics.join(", ")} />
        {persona.relationships.length > 0 && (
          <ReviewRow
            label="Beziehungen"
            value={persona.relationships.map((r) => `${r.name} (${r.description})`).join(", ")}
          />
        )}
      </Section>

      <Section title="Mandate">
        <ReviewRow label="Template" value={mandateTemplate} />
      </Section>

      <Section title="LLM">
        <ReviewRow label="Provider" value={llmProvider} />
        <ReviewRow label="Model" value={llmModel} mono />
        <ReviewRow label="API-Key" value={apiKeyMasked} mono />
      </Section>

      {submitError && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2">
          {submitError}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={submitting}
        className="w-full px-4 py-3 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
      >
        {submitting ? "Wird angelegt…" : "Twin anlegen"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded p-4 space-y-1.5">
      <div className="text-xs uppercase tracking-wider text-accent mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-xs uppercase tracking-wider text-muted w-28 flex-shrink-0 pt-0.5">
        {label}
      </dt>
      <dd className={`flex-1 text-text ${mono ? "font-mono text-xs pt-0.5" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

// ─── GOODBYE ────────────────────────────────────────────────────────────────

function GoodbyeScreen() {
  return (
    <div className="max-w-xl mx-auto space-y-6 mt-12">
      <h1 className="text-xl font-semibold text-text">Self-Hosted</h1>
      <p className="text-sm text-muted leading-relaxed">
        Für die selbst-gehostete Variante: hol dir den Code, leg deine eigene
        Bridge auf, betreib's auf deinem Gerät. Volle Kontrolle, keine Garantien.
      </p>
      <ul className="space-y-2 text-sm">
        <li>
          <a
            href="https://github.com/markusbaier/twin-lab"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            github.com/markusbaier/twin-lab
          </a>
          <span className="text-muted"> — Code & README</span>
        </li>
        <li>
          <span className="text-text font-mono text-xs">docs/SETUP.md</span>
          <span className="text-muted"> — Tag-1-Anleitung</span>
        </li>
      </ul>
      <Link
        href="/"
        className="inline-block px-4 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
      >
        Zur Hauptseite
      </Link>
    </div>
  );
}

// ─── BLOCK -1: ACCOUNT ──────────────────────────────────────────────────────
//
// Drei Modi, dynamisch je nach Session-State:
//   eingeloggt    → "Eingeloggt als <email>", Button "Weiter zum Onboarding"
//   nicht-login   → Toggle zwischen Login (default) und Register
//
// Wenn der Mount /auth/me erfolgreich aufruft, kennen wir die Email und
// gehen direkt in den eingeloggt-Modus. Sonst Login-Form.

interface MeData {
  userId: string;
  email: string;
  displayName: string | null;
}

function AccountBlock({ onReady }: { onReady: () => void }) {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");

  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<MeData>) : null))
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="max-w-sm mx-auto mt-12 text-sm text-muted">Lade…</div>;
  }

  // Mode B: bereits eingeloggt
  if (me) {
    return (
      <div className="max-w-sm mx-auto space-y-5 mt-12">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-text">Twin anlegen</h1>
          <div className="text-xs text-muted">
            Eingeloggt als <span className="text-text">{me.email}</span>
          </div>
        </header>
        <button
          onClick={onReady}
          className="w-full px-4 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
        >
          Weiter zum Onboarding →
        </button>
        <button
          onClick={async () => {
            try {
              await fetch(`${RUNTIME_URL}/auth/logout`, {
                method: "POST",
                credentials: "include",
              });
            } catch {
              // egal — Hard-Reload kommt sowieso
            }
            // Hard-Reload statt setMe/setMode — Top-Nav (TwinSwitcher,
            // FooterMeta) cached den /auth/me-Status. Voll-Mount triggert
            // Re-Init mit gelöschtem Cookie.
            window.location.href = window.location.pathname;
          }}
          className="w-full text-xs text-muted hover:text-warn transition-colors"
        >
          Anderer User? Logout
        </button>
      </div>
    );
  }

  // Modes A + C
  return (
    <div className="max-w-sm mx-auto space-y-5 mt-12">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">Twin anlegen</h1>
        <div className="text-xs text-muted">
          {mode === "register"
            ? "Lege deinen Account an, um Twins zu erstellen."
            : "Schon einen Account?"}
        </div>
      </header>

      {mode === "register" ? (
        <RegisterForm
          onSuccess={() => {
            // Hard-Reload statt setMe — Top-Nav muss /auth/me neu fetchen,
            // damit Email + Logout-Button nach Register sofort sichtbar.
            window.location.href = window.location.pathname;
          }}
          toggle={() => setMode("login")}
        />
      ) : (
        <LoginForm
          onSuccess={() => {
            window.location.href = window.location.pathname;
          }}
          toggle={() => setMode("register")}
        />
      )}
    </div>
  );
}

function RegisterForm({
  onSuccess,
  toggle,
}: {
  onSuccess: (u: MeData) => void;
  toggle: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = password.length >= 8 && password === password2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordOk) {
      setError("Passwort min. 8 Zeichen und beide Felder müssen identisch sein");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSuccess(body as MeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registrierung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Passwort (min. 8 Zeichen)
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Passwort wiederholen
        </label>
        <input
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          autoComplete="new-password"
          required
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Display-Name (optional)
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
        />
      </div>
      {error && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !passwordOk || !email}
        className="w-full px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
      >
        {busy ? "Lege an…" : "Account anlegen"}
      </button>
      <button
        type="button"
        onClick={toggle}
        className="w-full text-xs text-muted hover:text-text transition-colors"
      >
        Schon einen Account? Login
      </button>
    </form>
  );
}

function LoginForm({
  onSuccess,
  toggle,
}: {
  onSuccess: (u: MeData) => void;
  toggle: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSuccess(body as MeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted mb-1">
          Passwort
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
        />
      </div>
      {error && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !email || !password}
        className="w-full px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
      >
        {busy ? "Login…" : "Login"}
      </button>
      <button
        type="button"
        onClick={toggle}
        className="w-full text-xs text-muted hover:text-text transition-colors"
      >
        Noch keinen Account? Registrieren
      </button>
    </form>
  );
}
