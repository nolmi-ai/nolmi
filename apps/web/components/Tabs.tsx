"use client";

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ─── Tabs (#130 Phase 4.2) ──────────────────────────────────────────────────
//
// Reusable Compound-Component für Tab-Navigation. Erstmals genutzt in
// Settings-Page-Restructuring (Phase 4.3) + Channels-Sub-Tab (Phase 4.4).
//
// API:
//
//   <Tabs defaultTab="profil" persistInUrl paramName="tab">
//     <TabList>
//       <Tab id="profil">Profil</Tab>
//       <Tab id="reife">Reife</Tab>
//       <Tab id="channels">Channels</Tab>
//     </TabList>
//     <TabPanel id="profil">…</TabPanel>
//     <TabPanel id="reife">…</TabPanel>
//     <TabPanel id="channels">
//       {/* Sub-Tabs: verschachtelte Tabs mit anderem paramName */}
//       <Tabs defaultTab="telegram" persistInUrl paramName="channel">
//         <TabList>
//           <Tab id="telegram">Telegram</Tab>
//           <Tab id="whatsapp" disabled>WhatsApp (folgt)</Tab>
//         </TabList>
//         <TabPanel id="telegram">…</TabPanel>
//         <TabPanel id="whatsapp">…</TabPanel>
//       </Tabs>
//     </TabPanel>
//   </Tabs>
//
// URL-Persistence: optional via `persistInUrl + paramName`. `router.replace`
// (kein neuer History-Entry pro Tab-Klick — Back-Button bleibt sinnvoll).
// Sub-Tabs MÜSSEN einen anderen `paramName` haben, sonst überschreiben sie
// sich gegenseitig.
//
// Accessibility:
//   - role=tablist / tab / tabpanel
//   - aria-selected, aria-controls, aria-labelledby
//   - Keyboard: ArrowLeft/Right/Home/End wandern durch enabled Tabs
//   - Disabled Tabs: tabIndex=-1, von Keyboard-Nav übersprungen

interface TabsContextValue {
  activeId: string;
  setActiveId: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Tabs>`);
  }
  return ctx;
}

// ─── Tabs (Root) ────────────────────────────────────────────────────────────
//
// Discriminated Union: `persistInUrl: true` erzwingt `paramName: string` zur
// Compile-Time. Ohne Discriminator wäre `paramName` nur optional und Bugs
// wie „persistInUrl=true vergessen paramName zu setzen" würden silent
// scheitern (URL bleibt unverändert).

type TabsProps = {
  defaultTab: string;
  children: ReactNode;
} & (
  | { persistInUrl?: false; paramName?: never }
  | { persistInUrl: true; paramName: string }
);

export function Tabs(props: TabsProps) {
  const { defaultTab, children, persistInUrl, paramName } = props;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Internal-State läuft IMMER (Hooks dürfen nicht conditional sein); wird
  // nur genutzt wenn !persistInUrl.
  const [internalActive, setInternalActive] = useState(defaultTab);

  const urlActive =
    persistInUrl && paramName ? searchParams.get(paramName) : null;
  const activeId = urlActive ?? (persistInUrl ? defaultTab : internalActive);

  const setActiveId = useCallback(
    (id: string) => {
      if (persistInUrl && paramName) {
        const params = new URLSearchParams(searchParams.toString());
        params.set(paramName, id);
        router.replace(`${pathname}?${params.toString()}`);
      } else {
        setInternalActive(id);
      }
    },
    [persistInUrl, paramName, pathname, router, searchParams],
  );

  return (
    <TabsContext.Provider value={{ activeId, setActiveId }}>
      {children}
    </TabsContext.Provider>
  );
}

// ─── TabList ────────────────────────────────────────────────────────────────

export function TabList({ children }: { children: ReactNode }) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="flex border-b border-border"
    >
      {children}
    </div>
  );
}

// ─── Tab ────────────────────────────────────────────────────────────────────
//
// Keyboard-Navigation läuft pro Tab-Element: bei ArrowLeft/Right/Home/End
// scannen wir das umschließende `role="tablist"`-Element (via
// `closest('[role=tablist]')`) nach `[role=tab]:not([disabled])`-Buttons,
// wählen den nächsten/vorherigen, fokussieren ihn und setzen ihn aktiv.
// Vorteil ggü useRef-Map: skaliert mit dynamischen Tab-Listen ohne explicit
// Tab-Registry, scoped automatisch auf das aktuelle TabList (kein Bleed in
// Sub-Tabs).

function moveFocus(
  current: HTMLButtonElement,
  direction: "prev" | "next" | "first" | "last",
): HTMLButtonElement | null {
  const list = current.closest('[role="tablist"]');
  if (!list) return null;
  const tabs = Array.from(
    list.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]:not([disabled])',
    ),
  );
  if (tabs.length === 0) return null;
  if (direction === "first") return tabs[0] ?? null;
  if (direction === "last") return tabs[tabs.length - 1] ?? null;
  const idx = tabs.indexOf(current);
  if (idx === -1) return tabs[0] ?? null;
  const nextIdx =
    direction === "next"
      ? (idx + 1) % tabs.length
      : (idx - 1 + tabs.length) % tabs.length;
  return tabs[nextIdx] ?? null;
}

export function Tab({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { activeId, setActiveId } = useTabsContext("Tab");
  const isActive = activeId === id;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextEl: HTMLButtonElement | null = null;
    if (event.key === "ArrowRight") {
      nextEl = moveFocus(event.currentTarget, "next");
    } else if (event.key === "ArrowLeft") {
      nextEl = moveFocus(event.currentTarget, "prev");
    } else if (event.key === "Home") {
      nextEl = moveFocus(event.currentTarget, "first");
    } else if (event.key === "End") {
      nextEl = moveFocus(event.currentTarget, "last");
    }
    if (nextEl) {
      event.preventDefault();
      const nextId = nextEl.dataset.tabId;
      if (nextId) setActiveId(nextId);
      nextEl.focus();
    }
  };

  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      data-tab-id={id}
      aria-selected={isActive}
      aria-controls={`tabpanel-${id}`}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => {
        if (!disabled) setActiveId(id);
      }}
      onKeyDown={handleKeyDown}
      className={[
        "px-3 py-2 text-sm border-b-2 transition-colors -mb-px",
        disabled
          ? "text-muted opacity-50 cursor-not-allowed border-transparent"
          : isActive
            ? "text-text border-accent"
            : "text-muted hover:text-text border-transparent",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ─── TabPanel ───────────────────────────────────────────────────────────────
//
// `hidden`-Attribut statt `display:none` matched ARIA-Pattern und ist
// gleichzeitig ein CSS-Builtin für „visually + a11y-tree hidden". Vorteil:
// `tabIndex={0}` macht das Panel fokussierbar wenn aktiv, was Screen-Reader
// die richtige Reihenfolge gibt.

export function TabPanel({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { activeId } = useTabsContext("TabPanel");
  const isActive = activeId === id;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={!isActive}
      tabIndex={isActive ? 0 : -1}
      className="pt-4 focus:outline-none"
    >
      {children}
    </div>
  );
}

// ─── Helper: tab-Id-Extraction für externe Caller ───────────────────────────
//
// Wenn ein Caller die existing-Tab-Ids im Voraus kennen muss (z.B. für ein
// programmatisches `setActiveTab` von außen), kann diese Util-Function aus
// einer Children-Liste die Tab-IDs ziehen. Heute nicht in Phase 4.3/4.4
// genutzt, aber nicht-aufwändig zu exportieren.

export function getTabIds(children: ReactNode): string[] {
  const ids: string[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Tab) {
      const props = child.props as { id?: string };
      if (typeof props.id === "string") ids.push(props.id);
    } else {
      const props = child.props as { children?: ReactNode };
      if (props.children) ids.push(...getTabIds(props.children));
    }
  });
  return ids;
}

export type { TabsProps };
