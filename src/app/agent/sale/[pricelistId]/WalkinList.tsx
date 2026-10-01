"use client";

// §20: רשימת מזדמנים
//
// §398: 🚶➜👤 אין יותר הוספת מזדמן — כל קונה נרשם כלקוח ("לקוח חדש").
// כאן נשארו רק מזדמנים ישנים, עם כפתור "הפוך ללקוח": נוצר (או נמצא
// לפי טלפון) לקוח רשום, וההזמנה עוברת אליו כהזמנה רגילה — עם אותם
// משקלים (העמלה נשמרת) ואותו תשלום (המזומן נשאר בחשבון שלך).
import { useState } from "react";
import type { Walkin } from "./AgentSaleClient";

type Props = {
  walkins: Walkin[];
  readOnly?: boolean;
  onChange: () => void;
};

type PointOpt = { id: string; name: string; city: string | null };

/**
 * §398: המרה אחת. מחזיר true כשהומר.
 * חסר טלפון → שואל; חסרה נקודה → מחזיר את הרשימה לבחירה.
 */
async function convertOne(
  walkin: Walkin,
  extra: { phone?: string; pointId?: string; allowNoPhone?: boolean }
): Promise<
  | { ok: true; orderNumber: number; customerExisted: boolean }
  | { ok: false; error: string; needsPhone?: boolean; points?: PointOpt[] }
> {
  const res = await fetch(`/api/agent/walkin/${walkin.id}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(extra),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: json.error || "שגיאה",
      needsPhone: json.needsPhone === true,
      points: json.needsPoint ? json.points : undefined,
    };
  }
  return { ok: true, orderNumber: json.orderNumber, customerExisted: json.customerExisted };
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "מזומן",
  CARD_TERMINAL: "אשראי במסוף",
  TRANSFER: "העברה בנקאית",
  ONLINE: "אשראי אונליין",
};

const PAYMENT_ICONS: Record<string, string> = {
  CASH: "💵",
  CARD_TERMINAL: "💳",
  TRANSFER: "🏦",
  ONLINE: "🌐",
};

// המרת מספר טלפון ישראלי לפורמט של WhatsApp: 972546766022
function toWhatsAppPhone(phone: string): string | null {
  if (!phone) return null;
  // הסרת רווחים, מקפים וסוגריים
  const clean = phone.replace(/[\s\-()]/g, "");
  // אם מתחיל ב-+972, מסירים ה-+
  if (clean.startsWith("+972")) return clean.substring(1);
  // אם מתחיל ב-972, מחזירים כמו שהוא
  if (clean.startsWith("972")) return clean;
  // אם מתחיל ב-0 (מספר ישראלי מקומי), מחליפים את ה-0 ב-972
  if (clean.startsWith("0")) return "972" + clean.substring(1);
  // אם 9-10 ספרות בלי 0 בהתחלה, מוסיפים 972
  if (/^\d{9,10}$/.test(clean)) return "972" + clean;
  return null;
}

// בונה הודעת סיכום למזדמן
function buildWhatsAppMessage(walkin: Walkin): string {
  const lines: string[] = [];
  lines.push(`שלום ${walkin.customerName}! 🐔`);
  lines.push("");
  lines.push("תודה שרכשת אצלנו היום בחלוקה של צדקת רבותינו.");
  lines.push("");
  lines.push("*פירוט הרכישה:*");
  for (const it of walkin.items) {
    const label = it.isSingle ? "בודדים" : "";
    lines.push(
      `• ${it.productName}${label ? ` (${label})` : ""} — ${it.weight.toFixed(2)} ק"ג × ₪${it.unitPrice.toFixed(2)} = ₪${it.totalPrice.toFixed(2)}`
    );
  }
  lines.push("");
  lines.push(`*סה"כ: ₪${walkin.totalAmount.toFixed(2)}*`);
  lines.push(`אמצעי תשלום: ${PAYMENT_LABELS[walkin.paymentMethod]}`);
  lines.push("");
  lines.push("בפעם הבאה מוזמן להזמין מראש דרך האתר:");
  lines.push("https://tzidkat.com");
  lines.push("");
  lines.push("בברכה,");
  lines.push("צדקת רבותינו — עופות בשר ודגים");
  return lines.join("\n");
}

function openWhatsApp(walkin: Walkin) {
  if (!walkin.customerPhone) return;
  const phone = toWhatsAppPhone(walkin.customerPhone);
  if (!phone) {
    alert("מספר טלפון לא תקין");
    return;
  }
  const text = encodeURIComponent(buildWhatsAppMessage(walkin));
  const url = `https://wa.me/${phone}?text=${text}`;
  window.open(url, "_blank");
}

export function WalkinList({ walkins, readOnly, onChange }: Props) {
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  // §398: המרה בבת אחת — רק מי שיש לו טלפון/מייל (ונקודה ידועה).
  // השאר נשארים ברשימה, עם כפתור אישי שמבקש את מה שחסר.
  async function convertAll() {
    const ready = walkins.filter((w) => w.customerPhone || w.customerEmail);
    if (ready.length === 0) {
      alert("לאף מזדמן אין טלפון. לחץ \"הפוך ללקוח\" על כל אחד והזן טלפון.");
      return;
    }
    if (
      !confirm(
        `להפוך ${ready.length} מזדמנים ללקוחות רשומים?\n\n` +
          "לכל אחד תיווצר הזמנה רגילה עם אותם משקלים ואותו תשלום. העמלה והמזומן שאצלך לא משתנים."
      )
    )
      return;
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const w of ready) {
      const r = await convertOne(w, {});
      if (r.ok) ok++;
      else failed.push(`${w.customerName}: ${r.error}`);
    }
    setBulkBusy(false);
    setBulkMsg(
      `✓ ${ok} הומרו ללקוחות` + (failed.length ? `\n✗ ${failed.length} לא הומרו:\n${failed.join("\n")}` : "")
    );
    onChange();
  }

  return (
    <div className="space-y-3">
      {/* §398: הסבר + המרה בבת אחת */}
      {walkins.length > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
          <div className="text-sm text-violet-900 leading-relaxed">
            <b>🚶➜👤 מזדמנים הופכים ללקוחות.</b> לקוח רשום מזוהה בפעם הבאה לפי הטלפון, ואת
            ההזמנה שלו רואים בכל הדוחות. המשקלים, העמלה והמזומן שאצלך — לא משתנים.
            <br />
            <span className="text-xs">לקונה חדש בחלוקה: כפתור &quot;הזמנה ללקוח&quot; בראש המסך (או בדף הבית).</span>
          </div>
          {/* ⚠️ גם במצב צפייה (readOnly): המרה אינה הוספת מזדמן, היא
              הדרך לסיים איתם. */}
          <button
            onClick={convertAll}
            disabled={bulkBusy}
            className="w-full sm:w-auto text-sm px-4 py-2 bg-violet-600 text-white rounded-lg font-bold disabled:opacity-50"
          >
            {bulkBusy ? "ממיר…" : `👤 הפוך את כולם ללקוחות (${walkins.length})`}
          </button>
          {bulkMsg && (
            <pre className="text-xs whitespace-pre-wrap text-violet-900 bg-white rounded p-2 border border-violet-100">
              {bulkMsg}
            </pre>
          )}
        </div>
      )}

      {/* רשימת מזדמנים קיימים */}
      {walkins.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-zinc-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-brand-slatedark font-semibold">אין מזדמנים — כולם רשומים כלקוחות</p>
          <p className="text-sm text-zinc-500 mt-1">
            קונה שהגיע בלי הזמנה: כפתור &quot;הזמנה ללקוח&quot; בראש המסך
          </p>
        </div>
      ) : (
        <>
          {/* בנר: שליחה קבוצתית של סיכומים */}
          {(() => {
            const withPhones = walkins.filter((w) => w.customerPhone);
            const withEmails = walkins.filter((w) => w.customerEmail);
            const total = walkins.length;
            const anyContact = walkins.filter(
              (w) => w.customerPhone || w.customerEmail
            ).length;
            if (anyContact < 2 || readOnly) return null;
            return (
              <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-300 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="text-xs text-brand-slatedark flex-1">
                  <div className="font-bold">💬 שלח סיכומים ללקוחות</div>
                  <div className="opacity-70 mt-0.5">
                    {withPhones.length}/{total} עם טלפון · {withEmails.length}/
                    {total} עם מייל
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {withPhones.length >= 2 && (
                    <button
                      onClick={() => {
                        if (
                          !confirm(
                            `לפתוח וואטסאפ ל-${withPhones.length} מזדמנים? כל הודעה תיפתח בחלון נפרד.`
                          )
                        )
                          return;
                        for (const w of withPhones) openWhatsApp(w);
                      }}
                      className="text-xs px-3 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg font-bold shadow-sm whitespace-nowrap"
                    >
                      וואטסאפ ({withPhones.length})
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {walkins.map((w) => (
            <WalkinCard key={w.id} walkin={w} readOnly={readOnly} onChange={onChange} />
          ))}
        </>
      )}
    </div>
  );
}

function WalkinCard({
  walkin,
  readOnly,
  onChange,
}: {
  walkin: Walkin;
  readOnly?: boolean;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  // §398: המרה ללקוח
  const [converting, setConverting] = useState(false);
  const [pointOptions, setPointOptions] = useState<PointOpt[] | null>(null);
  const [pointId, setPointId] = useState("");
  const [phoneInput, setPhoneInput] = useState<string | null>(null);

  async function convert() {
    const extra: { phone?: string; pointId?: string; allowNoPhone?: boolean } = {};
    if (pointId) extra.pointId = pointId;
    const hasContact = !!(walkin.customerPhone || walkin.customerEmail);
    if (!hasContact) {
      const p = (phoneInput ?? "").trim();
      if (p) extra.phone = p;
      else {
        if (
          !confirm(
            `ל"${walkin.customerName}" אין טלפון. בלי טלפון הלקוח לא יזוהה בפעם הבאה.\n\nלהקים בכל זאת?`
          )
        )
          return;
        extra.allowNoPhone = true;
      }
    } else if (
      !pointOptions &&
      !confirm(
        `להפוך את "${walkin.customerName}" ללקוח רשום?\n\n` +
          "תיווצר הזמנה רגילה עם אותם משקלים ואותו תשלום. העמלה והמזומן שאצלך לא משתנים."
      )
    ) {
      return;
    }
    setConverting(true);
    try {
      const r = await convertOne(walkin, extra);
      if (!r.ok) {
        if (r.points && r.points.length > 0) {
          setPointOptions(r.points);
          setExpanded(true);
          alert("בחר לאיזו נקודה שייך הלקוח, ולחץ שוב \"הפוך ללקוח\"");
          return;
        }
        if (r.needsPhone) {
          setPhoneInput(phoneInput ?? "");
          setExpanded(true);
        }
        alert(r.error);
        return;
      }
      alert(
        `✓ ${walkin.customerName} נרשם כלקוח${r.customerExisted ? " (נמצא לפי הטלפון)" : ""} — הזמנה #${r.orderNumber}`
      );
      onChange();
    } finally {
      setConverting(false);
    }
  }

  async function togglePaymentReceived() {
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/walkin/${walkin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReceived: !walkin.paymentReceived }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onChange();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteWalkin() {
    if (!confirm(`למחוק את המזדמן "${walkin.customerName}"?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/walkin/${walkin.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("שגיאה");
      onChange();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendEmailSummary() {
    let email = walkin.customerEmail || "";
    if (!email) {
      const input = prompt(
        `הזן כתובת מייל של ${walkin.customerName} לשליחת סיכום:`,
        ""
      );
      if (!input || !input.trim()) return;
      email = input.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert("כתובת מייל לא תקינה");
        return;
      }
    }
    setSendingEmail(true);
    try {
      const res = await fetch(`/api/agent/walkin/${walkin.id}/send-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      alert(`נשלח בהצלחה ל-${json.sentTo}`);
      onChange();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setSendingEmail(false);
    }
  }

  const needsConfirmation =
    !walkin.paymentReceived &&
    (walkin.paymentMethod === "TRANSFER" || walkin.paymentMethod === "ONLINE");

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
        needsConfirmation ? "border-amber-300 ring-1 ring-amber-200" : "border-zinc-200"
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 text-right"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark">
              {walkin.customerName}
            </span>
            <span className="text-xs text-zinc-400">#{walkin.walkinNumber}</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                needsConfirmation
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {PAYMENT_ICONS[walkin.paymentMethod]} {PAYMENT_LABELS[walkin.paymentMethod]}
              {needsConfirmation && " — ממתין"}
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5" dir="ltr">
            {walkin.customerPhone && `${walkin.customerPhone} · `}
            {walkin.items.length} פריטים · ₪{walkin.totalAmount.toFixed(2)}
          </div>
          {/* §44: הנקודה שאליה שויך המזדמן. חשוב בפירוט העמלות - מזדמן
              בלי שיוך נספר תחת "ללא נקודה" ולא נזקף לאף נקודה. */}
          {walkin.pointName && (
            <div className="text-[10px] text-zinc-400 mt-0.5">
              📍 {walkin.pointName}
            </div>
          )}
          {walkin.customerEmail && (
            <div className="text-[10px] text-zinc-400 mt-0.5" dir="ltr">
              📧 {walkin.customerEmail}
            </div>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-zinc-400 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100">
          {/* פריטים */}
          <div className="divide-y divide-zinc-100">
            {walkin.items.map((it) => (
              <div key={it.id} className="p-3 flex justify-between items-center">
                <div className="flex-1">
                  <div className="text-sm font-medium text-brand-slatedark">
                    {it.productName}
                    {it.isSingle && (
                      <span className="mr-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                        בודדים
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {it.weight.toFixed(2)} ק"ג × ₪{it.unitPrice.toFixed(2)}
                  </div>
                </div>
                <div className="text-brand-rust font-bold">
                  ₪{it.totalPrice.toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* פרטי תשלום + הערות */}
          {walkin.paymentNote && (
            <div className="p-3 bg-zinc-50 text-xs text-brand-slate">
              <strong>פרטי תשלום:</strong> {walkin.paymentNote}
            </div>
          )}
          {walkin.notes && (
            <div className="p-3 bg-zinc-50 border-t border-zinc-100 text-xs text-brand-slate">
              <strong>הערות:</strong> {walkin.notes}
            </div>
          )}

          {/* §398: הפוך ללקוח — גם במצב צפייה */}
          <div className="p-3 bg-violet-50 border-t border-violet-100 space-y-2">
            {(!walkin.customerPhone && !walkin.customerEmail) && (
              <input
                type="tel"
                dir="ltr"
                value={phoneInput ?? ""}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="טלפון הלקוח (כדי שיזוהה בפעם הבאה)"
                className="w-full px-3 py-2 border border-violet-300 rounded-lg text-sm"
              />
            )}
            {pointOptions && pointOptions.length > 0 && (
              <select
                value={pointId}
                onChange={(e) => setPointId(e.target.value)}
                className="w-full px-3 py-2 border-2 border-amber-400 bg-amber-50 rounded-lg text-sm font-medium"
              >
                <option value="">בחר נקודת חלוקה</option>
                {pointOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.city ? ` — ${p.city}` : ""}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                convert();
              }}
              disabled={converting || (!!pointOptions && !pointId)}
              className="w-full text-sm px-3 py-2 bg-violet-600 text-white hover:bg-violet-700 rounded-lg font-bold disabled:opacity-50"
            >
              {converting ? "ממיר…" : "👤 הפוך ללקוח רשום"}
            </button>
          </div>

          {/* פעולות */}
          {!readOnly && (
            <div className="p-3 bg-zinc-50 border-t border-zinc-100 flex gap-2 flex-wrap">
              {walkin.customerPhone && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openWhatsApp(walkin);
                  }}
                  className="text-xs px-3 py-1.5 bg-emerald-500 text-white hover:bg-emerald-600 rounded-md font-bold flex items-center gap-1 shadow-sm"
                  title="שלח וואטסאפ עם סיכום"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  וואטסאפ
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sendEmailSummary();
                }}
                disabled={sendingEmail}
                className="text-xs px-3 py-1.5 bg-blue-500 text-white hover:bg-blue-600 rounded-md font-bold flex items-center gap-1 shadow-sm disabled:opacity-50"
                title={walkin.customerEmail ? `שלח מייל ל-${walkin.customerEmail}` : "שלח מייל (הזנת כתובת)"}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {sendingEmail ? "שולח..." : "מייל"}
              </button>
              {walkin.summarySentAt && (
                <span className="text-[10px] px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md flex items-center gap-1">
                  ✓ נשלח{" "}
                  {walkin.summarySentVia === "EMAIL" ? "במייל" : "בוואטסאפ"}
                </span>
              )}
              {needsConfirmation && (
                <button
                  onClick={togglePaymentReceived}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-md font-bold"
                >
                  ✓ סמן שהתקבל
                </button>
              )}
              {walkin.paymentReceived && (walkin.paymentMethod === "TRANSFER" || walkin.paymentMethod === "ONLINE") && (
                <button
                  onClick={togglePaymentReceived}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-md font-medium"
                >
                  החזר לממתין
                </button>
              )}
              <button
                onClick={deleteWalkin}
                disabled={saving}
                className="text-xs px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-md font-medium"
              >
                מחק
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
