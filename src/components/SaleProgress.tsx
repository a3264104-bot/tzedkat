"use client";

// ═══════════════════════════════════════════════════════════════
// מסלול המכירה + "לפני סגירת המכירה"
// ═══════════════════════════════════════════════════════════════
// המנהל צריך לראות במבט אחד: באיזה שלב המכירה, כמה נשאר בכל שלב,
// ומה עוד חוסם את הסגירה.
//
// ⚠️ אין כאן חישוב חדש. כל מספר מגיע ממקור שכבר קיים:
//   - חוסמי הסגירה — /api/admin/sale-close (אותו שער שמסך הסגירה בודק, §385)
//   - מזומן, העברות, נציגים, תעודות — /api/admin/sale-control (§325)
//   - שקילה וחלוקה — /api/admin/reports + pending-weights (הדשבורד)

import Link from "next/link";
import { useEffect, useRef } from "react";

export type CloseHole = {
  id: string;
  orderNumber: number;
  remaining: number;
  kind: "UNPAID" | "PARTIAL" | "CARD_FAILED" | "MISSING_WEIGHTS";
};

export type CloseInfo = {
  pricelist: { id: string; name: string; status: string };
  total: number;
  paid: number;
  holes: CloseHole[];
  holesSum: number;
  canClose: boolean;
};

function shekels(n: number) {
  return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ─── מסלול המכירה ────────────────────────────────────────────────

type StepState = "done" | "current" | "todo";
type Step = {
  key: string;
  label: string;
  metric: string;
  sub: string;
  href: string;
  done: boolean;
  /** שלב שיש בו בעיה (למשל חוסמי סגירה) — הנקודה בכתום */
  attention?: boolean;
};

export function SaleTrack({
  pricelistId,
  status,
  closeDate,
  activeTotal,
  pricedCount,
  deliveredCount,
  awaitingPickup,
  close,
}: {
  pricelistId: string;
  status: string;
  closeDate: string | null;
  activeTotal: number;
  pricedCount: number;
  deliveredCount: number;
  awaitingPickup: number;
  close: CloseInfo | null;
}) {
  const orderingOpen = status === "ACTIVE" || status === "DRAFT";
  const closeLabel = closeDate
    ? new Date(closeDate).toLocaleDateString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "numeric",
        month: "numeric",
      })
    : null;

  // חיוב "הושלם" = אין חורים כספיים בשער הסגירה (שולם או הועבר לחוב)
  const moneyHoles = close ? close.holes.filter((h) => h.kind !== "MISSING_WEIGHTS").length : 0;
  const blockers = close?.holes.length ?? 0;

  const steps: Step[] = [
    {
      key: "prep",
      label: "הכנה",
      metric: status === "DRAFT" ? "טיוטה" : "✓",
      sub: status === "DRAFT" ? "המכירה עוד לא נפתחה" : "מחירון ונקודות",
      href: "/admin/pricelists",
      done: status !== "DRAFT",
    },
    {
      key: "ordering",
      label: "הזמנות",
      metric: `${activeTotal}`,
      sub: orderingOpen
        ? closeLabel
          ? `פתוחה · נסגרת ${closeLabel}`
          : "פתוחה להזמנות"
        : "ההזמנות נסגרו",
      href: "/admin/orders",
      done: !orderingOpen,
    },
    {
      key: "weigh",
      label: "שקילה",
      metric: activeTotal > 0 ? `${pricedCount}/${activeTotal}` : "—",
      sub: activeTotal > 0 && pricedCount >= activeTotal ? "הכל תומחר" : "הזמנות שתומחרו",
      href: "/admin/pending-weights",
      done: activeTotal > 0 && pricedCount >= activeTotal,
    },
    {
      key: "charge",
      label: "חיוב",
      // ⚠️ paid מהשער ולא total−holes: הזמנה בלי סכום סופי אינה "חור",
      // אבל גם לא שולמה — ספירה הפוכה הציגה אותה כסגורה כספית.
      metric: close && close.total > 0 ? `${close.paid}/${close.total}` : "—",
      sub: moneyHoles > 0 ? `שולמו · ${moneyHoles} פתוחות` : "שולמו",
      href: "/admin/payments",
      done: !!close && close.total > 0 && close.holes.length === 0,
    },
    {
      key: "deliver",
      label: "חלוקה",
      metric: activeTotal > 0 ? `${deliveredCount}/${activeTotal}` : "—",
      sub: awaitingPickup > 0 ? `${awaitingPickup} מוכנות וממתינות` : "נמסרו ללקוח",
      href: "/admin/orders",
      done: activeTotal > 0 && deliveredCount >= activeTotal,
    },
    {
      key: "close",
      label: "סגירה",
      metric: status === "DONE" ? "✓" : blockers > 0 ? `${blockers}` : "מוכנה",
      sub: status === "DONE" ? "נסגרה סופית" : blockers > 0 ? "חוסמים את הסגירה" : "אפשר לסגור",
      href: `/admin/sale-close/${pricelistId}`,
      done: status === "DONE",
      attention: status !== "DONE" && !orderingOpen && blockers > 0,
    },
  ];

  const currentIdx = steps.findIndex((s) => !s.done);
  const stateOf = (i: number): StepState =>
    steps[i].done ? "done" : i === currentIdx ? "current" : "todo";

  // בנייד הפס נגלל לרוחב — מביאים את השלב הנוכחי למרכז.
  // ⚠️ scrollBy על הקונטיינר ולא scrollIntoView: האחרון גם גולל את הדף אנכית.
  const scroller = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const cur = currentRef.current;
    if (!box || !cur || box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect();
    const c = cur.getBoundingClientRect();
    box.scrollBy({ left: c.left + c.width / 2 - (b.left + b.width / 2) });
  }, [currentIdx]);

  return (
    <nav aria-label="מסלול המכירה" className="card p-3 md:p-4">
      <div ref={scroller} className="-mx-3 px-3 md:mx-0 md:px-0 overflow-x-auto [scrollbar-width:none]">
        <ol className="flex md:grid md:grid-cols-6 gap-1 w-max md:w-auto">
          {steps.map((s, i) => {
            const st = stateOf(i);
            return (
              <li
                key={s.key}
                ref={i === currentIdx ? currentRef : undefined}
                className="relative min-w-[128px] md:min-w-0"
              >
                {/* קו מחבר לשלב הבא */}
                {i < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    // RTL: מהמרכז של השלב הזה שמאלה, עד מרכז השלב הבא
                    className={`absolute top-[22px] right-1/2 w-full h-0.5 ${
                      s.done ? "bg-emerald-300" : "bg-zinc-200"
                    }`}
                  />
                )}
                <Link
                  href={s.href}
                  aria-current={st === "current" ? "step" : undefined}
                  className={`relative flex flex-col items-center text-center gap-1 rounded-xl px-2 py-2 transition-colors ${
                    st === "current" ? "bg-brand-rust/5" : "hover:bg-zinc-50"
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full grid place-items-center text-xs font-extrabold ${
                      st === "done"
                        ? "bg-emerald-500 text-white"
                        : st === "current"
                          ? "bg-brand-rust text-white ring-4 ring-brand-rust/15"
                          : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {st === "done" ? "✓" : i + 1}
                  </span>
                  <span
                    className={`text-sm font-extrabold ${
                      st === "todo" ? "text-zinc-500" : "text-brand-slatedark"
                    }`}
                  >
                    {s.label}
                  </span>
                  <span
                    className={`text-base font-extrabold tabular-nums leading-none ${
                      s.attention ? "text-amber-700" : st === "done" ? "text-emerald-700" : "text-brand-slatedark"
                    }`}
                  >
                    <bdi>{s.metric}</bdi>
                  </span>
                  <span className="text-xs text-zinc-500 leading-snug">{s.sub}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

// ─── לפני סגירת המכירה ───────────────────────────────────────────

const HOLE_ROWS: {
  kind: CloseHole["kind"];
  label: string;
  href: (id: string) => string;
  cta: string;
}[] = [
  { kind: "CARD_FAILED", label: "כרטיס נכשל", href: () => "/admin/payments", cta: "לחיוב" },
  { kind: "UNPAID", label: "לא חויבו", href: () => "/admin/payments", cta: "לחיוב" },
  { kind: "PARTIAL", label: "תשלום חלקי", href: () => "/admin/payments", cta: "לחיוב" },
  { kind: "MISSING_WEIGHTS", label: "משקלים חסרים", href: () => "/admin/pending-weights", cta: "לשקילה" },
];

type CheckRow = { ok: boolean; label: string; detail?: string; href: string; tone?: "danger" | "warn" };

export function CloseChecklist({
  pricelistId,
  close,
  ctl,
}: {
  pricelistId: string;
  close: CloseInfo;
  /** התגובה של /api/admin/sale-control */
  ctl: any;
}) {
  const f = ctl?.financialSummary ?? {};

  // 🔴 חוסם — בדיוק מה ששער הסגירה בודק
  const byKind = HOLE_ROWS.map((r) => {
    const hs = close.holes.filter((h) => h.kind === r.kind);
    return { ...r, count: hs.length, sum: hs.reduce((s, h) => s + h.remaining, 0) };
  }).filter((r) => r.count > 0);
  const debtable = close.holes.some((h) => h.kind !== "MISSING_WEIGHTS");

  // 🟡 כדאי לבדוק — לא חוסם בשרת, אבל סגירה איתם משאירה כסף או סחורה לא מוסברים
  const cashWithAgents = Number(f.cashWithAgents ?? 0);
  const transfersPending = Number(f.walkinTransferPending ?? 0);
  const openAgents = Array.isArray(ctl?.agents)
    ? ctl.agents.filter((a: any) => a.status !== "CONFIRMED").length
    : 0;
  const missingNotes: string[] = Array.isArray(f.missingNoteProducts) ? f.missingNoteProducts : [];
  const missingCosts: string[] = Array.isArray(f.missingCostProducts) ? f.missingCostProducts : [];
  const dangerAlerts: string[] = Array.isArray(ctl?.alerts)
    ? ctl.alerts.filter((a: any) => a.type === "danger").map((a: any) => String(a.message))
    : [];

  const checks: CheckRow[] = [
    {
      ok: cashWithAgents <= 0.5,
      label: cashWithAgents > 0.5 ? "מזומן שעדיין אצל נציגים" : "כל המזומן הועבר מהנציגים",
      detail: cashWithAgents > 0.5 ? shekels(cashWithAgents) : undefined,
      href: "/admin/agent-debts",
    },
    {
      ok: transfersPending <= 0.5,
      label: transfersPending > 0.5 ? "העברות בנקאיות שטרם אושרו" : "אין העברות ממתינות",
      detail: transfersPending > 0.5 ? shekels(transfersPending) : undefined,
      href: "/admin/walkins",
    },
    {
      ok: openAgents === 0,
      label: openAgents > 0 ? "נציגים שטרם אישרו סיכום מכירה" : "כל הנציגים אישרו סיכום",
      detail: openAgents > 0 ? String(openAgents) : undefined,
      href: `/admin/sale-control/${pricelistId}`,
    },
    {
      ok: missingNotes.length === 0,
      label: missingNotes.length > 0 ? "מוצרים בלי תעודת משלוח" : "לכל המוצרים יש תעודה",
      detail: missingNotes.length > 0 ? String(missingNotes.length) : undefined,
      href: "/admin/delivery-notes",
    },
    {
      ok: missingCosts.length === 0,
      label: missingCosts.length > 0 ? "מוצרים בלי עלות ספק" : "עלויות הספק מלאות",
      detail: missingCosts.length > 0 ? String(missingCosts.length) : undefined,
      href: `/admin/sale-control/${pricelistId}`,
    },
  ];
  const warnings = checks.filter((c) => !c.ok);
  const passed = checks.filter((c) => c.ok);
  const blockerCount = close.holes.length;
  const allClear = blockerCount === 0 && warnings.length === 0 && dangerAlerts.length === 0;

  return (
    <section className="card overflow-hidden" aria-labelledby="close-check">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 md:px-5 pt-4 pb-3">
        <div>
          <h2 id="close-check" className="font-extrabold text-brand-slatedark">
            לפני סגירת המכירה
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {blockerCount > 0
              ? `${blockerCount} הזמנות חוסמות סגירה · ${shekels(close.holesSum)}`
              : warnings.length + dangerAlerts.length > 0
                ? "אין חוסמים — אבל יש מה לבדוק"
                : "הכל מוכן לסגירה"}
          </p>
        </div>
        <Link
          href={`/admin/sale-close/${pricelistId}`}
          className={
            allClear || blockerCount === 0
              ? "btn-primary btn-sm"
              : "text-xs font-bold text-brand-rust hover:underline"
          }
        >
          למסך הסגירה ←
        </Link>
      </div>

      {/* 🔴 חוסם סגירה */}
      <div className="border-t border-zinc-100">
        <p className="px-4 md:px-5 pt-3 pb-1 text-xs font-bold text-zinc-500">חוסם סגירה</p>
        {byKind.length === 0 ? (
          <Row ok label="אין הזמנות פתוחות — כולן שולמו או הועברו לחוב" href={`/admin/sale-close/${pricelistId}`} />
        ) : (
          <ul>
            {byKind.map((r) => (
              <li key={r.kind}>
                <Row
                  ok={false}
                  tone="danger"
                  label={`${r.count} הזמנות · ${r.label}`}
                  detail={r.kind === "MISSING_WEIGHTS" ? undefined : shekels(r.sum)}
                  href={r.href(pricelistId)}
                  cta={r.cta}
                />
              </li>
            ))}
          </ul>
        )}
        {debtable && (
          <p className="px-4 md:px-5 pb-3 text-xs text-zinc-500">
            יתרה שלא תיגבה עכשיו אפשר{" "}
            <Link href={`/admin/sale-close/${pricelistId}`} className="font-bold text-brand-rust hover:underline">
              להעביר לחוב
            </Link>{" "}
            — היא תיגבה בהזמנה הבאה של הלקוח.
          </p>
        )}
      </div>

      {/* 🟡 כדאי לבדוק */}
      <div className="border-t border-zinc-100 pb-2">
        <p className="px-4 md:px-5 pt-3 pb-1 text-xs font-bold text-zinc-500">כדאי לבדוק לפני סגירה</p>
        <ul>
          {dangerAlerts.map((m, i) => (
            <li key={`a${i}`}>
              <Row ok={false} tone="danger" label={m} href={`/admin/sale-control/${pricelistId}`} clamp />
            </li>
          ))}
          {warnings.map((c) => (
            <li key={c.label}>
              <Row ok={false} tone="warn" label={c.label} detail={c.detail} href={c.href} />
            </li>
          ))}
        </ul>
        {passed.length > 0 && (
          <p className="px-4 md:px-5 pt-1.5 pb-1 text-xs text-emerald-700 leading-relaxed">
            <span className="font-bold">✓ תקין:</span> {passed.map((c) => c.label).join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}

function Row({
  ok,
  label,
  detail,
  href,
  cta,
  tone = "warn",
  clamp,
}: {
  ok: boolean;
  label: string;
  detail?: string;
  href: string;
  cta?: string;
  tone?: "danger" | "warn";
  clamp?: boolean;
}) {
  const icon = ok
    ? "bg-emerald-100 text-emerald-700"
    : tone === "danger"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-800";
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-4 md:px-5 py-2.5 min-h-[48px] hover:bg-zinc-50 transition-colors"
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className={`w-6 h-6 shrink-0 rounded-full grid place-items-center text-xs font-extrabold ${icon}`} aria-hidden="true">
          {ok ? "✓" : "!"}
        </span>
        <span className={`text-sm text-brand-slatedark min-w-0 ${clamp ? "line-clamp-2" : ""}`}>{label}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {detail && <span className="text-sm font-bold tabular-nums text-brand-slatedark">{detail}</span>}
        <span className="text-xs font-bold text-brand-rust">
          {cta && <span className="hidden sm:inline">{cta} </span>}←
        </span>
      </span>
    </Link>
  );
}

// ─── מכירה שנסגרה סופית ───────────────────────────────────────────

export function SaleClosedNote({ carriedToDebt }: { carriedToDebt: number }) {
  return (
    <section className="card p-4 md:p-5 flex items-start gap-3 border-emerald-200 bg-emerald-50/60">
      <span className="w-9 h-9 shrink-0 rounded-full bg-emerald-500 text-white grid place-items-center font-extrabold" aria-hidden="true">
        ✓
      </span>
      <div className="min-w-0">
        <h2 className="font-extrabold text-emerald-900">המכירה נסגרה סופית</h2>
        <p className="text-sm text-emerald-900/80 mt-0.5">
          {carriedToDebt > 0.5 ? (
            <>
              <bdi className="font-bold tabular-nums">{shekels(carriedToDebt)}</bdi> הועברו לחוב הלקוחות
              וייגבו אוטומטית בהזמנה הבאה של כל לקוח.{" "}
              <Link href="/admin/debt-ledger" className="font-bold underline">
                לפנקס החובות
              </Link>
            </>
          ) : (
            "כל ההזמנות שולמו — לא עבר חוב למכירה הבאה."
          )}
        </p>
      </div>
    </section>
  );
}
