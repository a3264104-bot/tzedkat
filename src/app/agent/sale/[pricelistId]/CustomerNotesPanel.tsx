"use client";

// ═══════════════════════════════════════════════════════════════
// §181: הערות לקוחות שממתינות למענה
// ═══════════════════════════════════════════════════════════════
// 🐛 הפער: §133 בנה ללקוח אפשרות לכתוב הערה לנציג ("בלי עצם
// בבקשה", "אני מגיע אחרי 8"). ההערה נשמרה, הנציג יכול היה לענות -
// **אבל רק אם נכנס להזמנה הספציפית.**
//
// ואין סיבה להיכנס להזמנה שנראית רגילה. התוצאה: הערות נשארו בלי
// מענה, והלקוח קיבל סחורה שלא התאימה למה שביקש.
//
// עכשיו: תיבה אחת בראש מסך המכירה, עם מונה. הנציג רואה מיד כמה
// ממתינות, ולוחץ ישירות להזמנה.

import { useMemo, useState } from "react";
import type { Order } from "./AgentSaleClient";

export function CustomerNotesPanel({ orders }: { orders: Order[] }) {
  const [open, setOpen] = useState(false);

  // ⚠️ "ממתינה" = יש הערה **ואין** תשובה. הערה שנענתה כבר טופלה
  // ואינה צריכה להופיע במונה - אחרת הוא לא יורד לעולם והנציג
  // לומד להתעלם ממנו.
  const pending = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.customerNote &&
          o.customerNote.trim() &&
          !o.agentReply &&
          o.status !== "CANCELLED"
      ),
    [orders]
  );

  // ⚠️ הערות שנענו - מוצגות רק כשפותחים, לא במונה.
  const answered = useMemo(
    () =>
      orders.filter(
        (o) => o.customerNote && o.customerNote.trim() && o.agentReply
      ),
    [orders]
  );

  if (pending.length === 0 && answered.length === 0) return null;

  return (
    <div
      className={`rounded-xl border-2 overflow-hidden mb-3 ${
        pending.length > 0
          ? "border-amber-400 bg-amber-50"
          : "border-zinc-200 bg-white"
      }`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-right"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xl shrink-0">💬</span>
          <div className="min-w-0">
            <div className="font-extrabold text-brand-slatedark text-sm">
              הערות מלקוחות
              {/* §181: המונה **מחוץ** לתיבה בפועל - הוא בכותרת
                  שנראית גם כשהיא סגורה, וזה מה שהמנהל ביקש. */}
              {pending.length > 0 && (
                <span className="mr-1.5 bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {pending.length} ממתינות
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-600 mt-0.5">
              {pending.length > 0
                ? "לקוחות שכתבו בקשה וטרם קיבלו מענה"
                : `${answered.length} הערות — כולן נענו`}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-amber-200 divide-y divide-amber-100">
          {/* ⚠️ הממתינות ראשונות - הן הסיבה שהתיבה קיימת */}
          {pending.map((o) => (
            <NoteRow key={o.id} order={o} pending />
          ))}
          {answered.map((o) => (
            <NoteRow key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRow({ order, pending }: { order: Order; pending?: boolean }) {
  return (
    <a
      href={`/agent/orders/${order.id}`}
      className={`block px-4 py-2.5 hover:bg-white/60 transition-colors ${
        pending ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark text-sm">
              {order.customerName}
            </span>
            <span className="text-[10px] text-zinc-400">#{order.orderNumber}</span>
            {order.point && (
              <span className="text-[10px] text-zinc-500">📍 {order.point.name}</span>
            )}
          </div>
          {/* ⚠️ ההערה במלואה ולא חתוכה: "בלי עצם, ואם אפשר חתיכות
              קטנות" - חיתוך באמצע היה מסתיר בדיוק את מה שחשוב. */}
          <p className="text-[13px] text-brand-slatedark bg-white/70 rounded p-2 mt-1 leading-relaxed">
            {order.customerNote}
          </p>
          {order.agentReply && (
            <p className="text-[11px] text-emerald-800 mt-1">
              ✓ נענה: {order.agentReply}
            </p>
          )}
        </div>
        <span className="text-brand-rust text-lg shrink-0">←</span>
      </div>
    </a>
  );
}
