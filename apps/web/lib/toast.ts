import { toast as sonnerToast } from "sonner";

// ─── Toast-Wrapper (UX.1.A.1 / Item #94) ────────────────────────────────────
//
// Eigener Wrapper um `sonner.toast` mit explizit typisierten Call-Sites.
// Zweck: Call-Sites in der App nutzen NUR `toast.success/error/info/promise`,
// keine sonner-spezifischen Optionen. Damit ist ein späterer Library-Wechsel
// (z.B. wenn sonner mal nicht mehr passt) eine zentrale Änderung in diesem
// File statt grep-and-replace über die ganze Codebase.
//
// `promise()` ist die wichtige Convenience für async Aktionen: ein Aufruf
// pro try/catch-Stelle, automatisch Loading/Success/Error-State.

interface ToastOpts {
  /** Override der Default-Anzeigedauer (4000ms). */
  duration?: number;
  /** Optionaler Beschreibungstext unter dem Haupt-Label. */
  description?: string;
}

interface PromiseMessages {
  loading: string;
  success: string;
  error: string;
}

export const toast = {
  success: (msg: string, opts?: ToastOpts) =>
    sonnerToast.success(msg, opts),
  error: (msg: string, opts?: ToastOpts) =>
    sonnerToast.error(msg, opts),
  info: (msg: string, opts?: ToastOpts) =>
    sonnerToast.info(msg, opts),
  promise: <T>(promise: Promise<T>, msgs: PromiseMessages) =>
    sonnerToast.promise(promise, msgs),
};
