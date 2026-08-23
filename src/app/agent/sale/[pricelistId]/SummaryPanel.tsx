"use client";

// §20: פאנל סיכום וסגירת המכירה
// מציג: סה"כ ק"ג + עמלה + פירוט לפי נקודה + השוואה לתעודות משלוח + סגירה

import { useState } from "react";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDateTime } from "@/lib/date-lib";
import type { Order, Walkin } from "./AgentSaleClient";

type LiveSummary = {
  totalCartonWeight: number;
  totalSinglesWeight: number;
  totalWalkinCartonWeight: number;
  totalWalkinSinglesWeight: number;
  customersServed: number;
  walkinsCount: number;
  cartonCommission: number;
  singlesCommission: number;
  // §119: עמלה על מוצרים מועדפים שהנציג תמחר בעצמו.
  // אופציונלי כדי שגרסאות ישנות של הנתונים לא ישברו.
  customCommission?: number;
  totalCommission: number;
  walkinCash: number;
  walkinCard: number;
  walkinTransfer: number;
};

type Props = {
  pricelistId: string;
  summary: {
    id: string;
    status: string;
    remainderNote: string | null;
    confirmedAt: string | null;
  };
  liveSummary: LiveSummary;
  deliveryNotes: Array<{
    id: string;
    supplierName: string | null;
    noteNumber: string | null;
    items: Array<{
      productId: string | null;
      productName: string;
      quantity: number;
      weight: number;
    }>;
  }>;
  productWeightsFromNotes: Record<string, number>;
  orders: Order[];
  walkins: Walkin[];
  commissionRateCarton: number;
  commissionRateSingles: number;
  readOnly?: boolean;
  onChange: () => void;
  /** §81: כמה משקלים טרם מולאו - חוסם את סגירת המכירה */
  missingWeights?: number;
  /** §103: כמה לקוחות טרם סומנו כטופלו - חוסם גם הוא */
  unclosedOrders?: number;
};

export function SummaryPanel({
  pricelistId,
  summary,
  liveSummary,
  deliveryNotes,
  productWeightsFromNotes,
  orders,
  walkins,
  commissionRateCarton,
  commissionRateSingles,
  readOnly,
  onChange,
  missingWeights = 0,
  unclosedOrders = 0,
}: Props) {
  const [remainderNote, setRemainderNote] = useState(summary.remainderNote || "");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const totalNoteWeight = Object.values(productWeightsFromNotes).reduce(
    (s, w) => s + w,
    0
  );
  const totalDistributed =
    liveSummary.totalCartonWeight +
    liveSummary.totalSinglesWeight +
    liveSummary.totalWalkinCartonWeight +
    liveSummary.totalWalkinSinglesWeight;
  const diff = totalNoteWeight - totalDistributed;

  // חישוב לפי מוצר - כמה ק"ג לפי התעודה, כמה חולק, פער
  const productSummary = calculateProductSummary(
    productWeightsFromNotes,
    orders,
    walkins
  );

  async function saveNote() {
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/summary/${pricelistId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remainderNote }),
      });
      if (!res.ok) throw new Error("שגיאה");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmSale() {
    // §81: חסימה לפני האישור - אין טעם לשאול "לסגור?" אם התשובה
    // תידחה ממילא בשרת.
    if (missingWeights > 0) {
      alert(
        `לא ניתן לסגור את המכירה.\n\nחסרים ${missingWeights} משקלים.\n\n` +
          `משקל שלא מולא הוא כסף שלא נגבה. אם לקוח לא קיבל סחורה - יש להזין 0 במפורש בטבלה.`
      );
      return;
    }
    // §103: כל לקוח חייב סימון "טופל" מהנציג. המשקלים מלאים אינם
    // מספיקים - הם נתון של המערכת, והסימון הוא הצהרה של אדם
    // שעמד מול הלקוח.
    if (unclosedOrders > 0) {
      alert(
        `לא ניתן לסגור את המכירה.\n\n${unclosedOrders} לקוחות טרם סומנו כטופלו.\n\n` +
          `בטבלת המשקלים יש לסמן ✓ בסוף השורה של כל לקוח שסיימת לטפל בו.`
      );
      return;
    }
    if (
      !confirm(
        "לסגור את המכירה?\nלאחר סגירה לא ניתן יהיה לשנות משקלים או להוסיף מזדמנים."
      )
    )
      return;
    setConfirming(true);
    try {
      // שמור הערה ואישור בבת אחת
      const res = await fetch(`/api/agent/summary/${pricelistId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remainderNote, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // §81: השרת בודק שוב - הודעתו מדויקת יותר (הוא סופר בזמן אמת)
        throw new Error(data.error || "שגיאה בסגירה");
      }
      alert("המכירה נסגרה. המנהל קיבל התראה.");
      onChange();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* סיכום כללי */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-l from-brand-rust to-[#a83a15] text-white px-5 py-3">
          <h3 className="font-extrabold text-lg">סיכום המכירה</h3>
          <p className="text-white/80 text-xs mt-0.5">
            הנתונים מתעדכנים בזמן אמת
          </p>
        </div>
        <div className="p-5 space-y-4">
          {/* מספרים גדולים */}
          <div className="grid grid-cols-2 gap-3">
            <BigStat
              label='קרטונים ק"ג'
              value={liveSummary.totalCartonWeight + liveSummary.totalWalkinCartonWeight}
              suffix=' ק"ג'
              subValue={`מזה מזדמנים: ${liveSummary.totalWalkinCartonWeight.toFixed(2)}`}
              color="rust"
            />
            <BigStat
              label='בודדים ק"ג'
              value={liveSummary.totalSinglesWeight + liveSummary.totalWalkinSinglesWeight}
              suffix=' ק"ג'
              subValue={`מזה מזדמנים: ${liveSummary.totalWalkinSinglesWeight.toFixed(2)}`}
              color="amber"
            />
          </div>

          {/* פירוט עמלה */}
          <div className="border-t border-zinc-100 pt-3">
            <h4 className="text-xs font-bold text-zinc-500 mb-2 uppercase">
              פירוט עמלה
            </h4>
            <div className="space-y-1.5">
              <SummaryLine
                label={`קרטונים (${(liveSummary.totalCartonWeight + liveSummary.totalWalkinCartonWeight).toFixed(2)} × ₪${commissionRateCarton})`}
                value={`₪${liveSummary.cartonCommission.toFixed(2)}`}
              />
              <SummaryLine
                label={`בודדים (${(liveSummary.totalSinglesWeight + liveSummary.totalWalkinSinglesWeight).toFixed(2)} × ₪${commissionRateSingles})`}
                value={`₪${liveSummary.singlesCommission.toFixed(2)}`}
              />
              {/* §119: מוצרים מועדפים - שורה נפרדת, כי החישוב שונה
                  לגמרי (הפרש מחיר ולא תעריף לק"ג). מיזוג לשורות
                  הקיימות היה מציג "קרטונים × 1" על סכום שלא חושב כך. */}
              {!!liveSummary.customCommission && liveSummary.customCommission > 0 && (
                <SummaryLine
                  label="⭐ מוצרים מועדפים (הפרש מחיר)"
                  value={`₪${liveSummary.customCommission.toFixed(2)}`}
                />
              )}
              <div className="border-t border-zinc-200 pt-2 mt-2 flex justify-between items-center">
                <span className="font-bold text-brand-slatedark">
                  סה"כ עמלה שלי
                </span>
                <span className="text-2xl font-extrabold text-emerald-600">
                  ₪{liveSummary.totalCommission.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* פירוט תשלומים ממזדמנים */}
          {liveSummary.walkinsCount > 0 && (
            <div className="border-t border-zinc-100 pt-3">
              <h4 className="text-xs font-bold text-zinc-500 mb-2 uppercase">
                תשלומים ממזדמנים
              </h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-emerald-50 rounded-lg p-2">
                  <div className="text-[10px] text-emerald-700 font-bold">מזומן</div>
                  <div className="text-emerald-800 font-extrabold">
                    ₪{liveSummary.walkinCash.toFixed(0)}
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-2">
                  <div className="text-[10px] text-blue-700 font-bold">אשראי</div>
                  <div className="text-blue-800 font-extrabold">
                    ₪{liveSummary.walkinCard.toFixed(0)}
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-2">
                  <div className="text-[10px] text-purple-700 font-bold">העברה</div>
                  <div className="text-purple-800 font-extrabold">
                    ₪{liveSummary.walkinTransfer.toFixed(0)}
                  </div>
                </div>
              </div>
              {liveSummary.walkinCash > 0 && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  💰 <strong>שים לב:</strong> אספת ₪{liveSummary.walkinCash.toFixed(2)} במזומן. יש להעביר למנהל.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* §43: פירוט לפי נקודת חלוקה */}
      <PointBreakdown
        orders={orders}
        walkins={walkins}
        rateCarton={commissionRateCarton}
        rateSingles={commissionRateSingles}
      />

      {/* השוואה לתעודות משלוח */}
      {deliveryNotes.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-100">
            <h3 className="font-extrabold text-brand-slatedark">
              בקרה מול תעודות משלוח
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {deliveryNotes.length} תעודות מאושרות · סה"כ ק"ג לחלוקה: {totalNoteWeight.toFixed(2)}
            </p>
          </div>

          <div className="p-4">
            {/* סיכום פער כללי */}
            <div
              className={`rounded-xl p-4 mb-4 border-2 ${
                Math.abs(diff) < 1
                  ? "bg-emerald-50 border-emerald-300"
                  : diff > 0
                  ? "bg-amber-50 border-amber-300"
                  : "bg-red-50 border-red-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-brand-slatedark">
                  פער כללי
                </span>
                <span
                  className={`text-lg font-extrabold ${
                    Math.abs(diff) < 1
                      ? "text-emerald-700"
                      : diff > 0
                      ? "text-amber-700"
                      : "text-red-700"
                  }`}
                >
                  {diff > 0 ? "+" : ""}
                  {diff.toFixed(2)} ק"ג
                </span>
              </div>
              <div className="text-xs text-brand-slate">
                {Math.abs(diff) < 1
                  ? "מצוין! הכל מאוזן"
                  : diff > 0
                  ? `יש ${diff.toFixed(2)} ק"ג שנשארו מהתעודה. הסבר בהערה למטה.`
                  : `חילקת ${Math.abs(diff).toFixed(2)} ק"ג מעל התעודה! שגיאה בהזנה?`}
              </div>
            </div>

            {/* פירוט לפי מוצר */}
            <div className="space-y-1.5">
              {productSummary.map((row) => (
                <div
                  key={row.productId}
                  className="flex items-center justify-between py-1.5 border-b border-zinc-100 text-sm"
                >
                  <span className="text-brand-slatedark truncate flex-1">
                    {row.productName}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-zinc-500 text-xs">
                      תעודה: {row.noteWeight.toFixed(2)}
                    </span>
                    <span className="text-zinc-500 text-xs">
                      חילק: {row.distributedWeight.toFixed(2)}
                    </span>
                    <span
                      className={`min-w-[50px] text-left text-xs font-bold ${
                        Math.abs(row.diff) < 0.5
                          ? "text-emerald-600"
                          : row.diff > 0
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {row.diff > 0 ? "+" : ""}
                      {row.diff.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* הערת "נשאר/זרוק" */}
      {!readOnly && (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-100">
            <h3 className="font-extrabold text-brand-slatedark">
              הסבר על פערים
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              הסבר איפה נשארו הפערים - זרוק, נשאר, נלקח וכו'
            </p>
          </div>
          <div className="p-4">
            <textarea
              value={remainderNote}
              onChange={(e) => setRemainderNote(e.target.value)}
              onBlur={saveNote}
              disabled={saving}
              rows={3}
              placeholder='דוגמה: "נשארו 3 ק"ג חזה עוף שהוחזרו לספק, 2 ק"ג צלעות שהיו קלוקלים ונזרקו"'
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
            {saving && (
              <p className="text-xs text-zinc-500 mt-1">שומר...</p>
            )}
          </div>
        </div>
      )}

      {/* כפתור סגירה */}
      {!readOnly && (
        <div className="sticky bottom-4">
          {/* §81: כשחסרים משקלים - הכפתור אדום ומושבת, והסיבה כתובה
              מעליו. כפתור ירוק שנכשל בלחיצה מבלבל יותר מכפתור
              שאומר מראש מה חסר. */}
          {missingWeights === 0 && unclosedOrders > 0 && (
            <div className="mb-2 bg-amber-50 border-2 border-amber-300 rounded-xl p-3 text-center">
              <div className="font-extrabold text-amber-800 text-sm">
                ⚠️ {unclosedOrders} לקוחות טרם סומנו כטופלו
              </div>
              <div className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                המשקלים מלאים, אך יש לאשר כל לקוח. בטבלת המשקלים — סמן ✓
                בסוף השורה של כל מי שסיימת לטפל בו.
              </div>
            </div>
          )}
          {missingWeights > 0 && (
            <div className="mb-2 bg-red-50 border-2 border-red-300 rounded-xl p-3 text-center">
              <div className="font-extrabold text-red-800 text-sm">
                ⚠️ חסרים {missingWeights} משקלים
              </div>
              <div className="text-[11px] text-red-700 mt-0.5 leading-relaxed">
                משקל שלא מולא הוא כסף שלא נגבה. עבור לטבלת המשקלים והשלם
                את התאים האדומים. לקוח שלא קיבל סחורה — הזן 0.
              </div>
            </div>
          )}
          <button
            onClick={confirmSale}
            disabled={confirming || missingWeights > 0 || unclosedOrders > 0}
            className={`w-full text-white py-4 rounded-xl font-bold text-lg shadow-lg disabled:cursor-not-allowed transition-all ${
              missingWeights > 0 || unclosedOrders > 0
                ? "bg-zinc-400 opacity-70"
                : "bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            }`}
          >
            {confirming
              ? "סוגר..."
              : missingWeights > 0
                ? `🔒 חסרים ${missingWeights} משקלים`
                : unclosedOrders > 0
                  ? `🔒 ${unclosedOrders} לקוחות לא סומנו`
                  : "✓ סגור את המכירה"}
          </button>
          <p className="text-center text-xs text-zinc-500 mt-2">
            לאחר סגירה לא ניתן יהיה לשנות משקלים
          </p>
        </div>
      )}

      {/* אם כבר נסגר */}
      {summary.status === "CONFIRMED" && summary.confirmedAt && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-emerald-700 font-bold text-sm">
            ✓ נסגר ב-{fmtDateTime(summary.confirmedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// §43: פירוט לפי נקודת חלוקה
// ═══════════════════════════════════════════════════════════════════
// נציג המשויך לכמה נקודות צריך לראות כמה כל נקודה הניבה - גם כדי
// לבדוק את עצמו, וגם כדי להתחשבן מול המנהל לפי נקודה.
//
// §44: מזדמנים משויכים לנקודה מרגע שנוסף WalkinOrder.pointId, ולכן
// נכללים בפירוט. מזדמן ישן בלי שיוך מקובץ תחת "ללא נקודה" - עדיף
// מלנחש שיוך שגוי שייצור התחשבנות שגויה.

type PointRow = {
  pointId: string;
  pointName: string;
  cartonWeight: number;
  singlesWeight: number;
  customers: number;
  delivered: number;
  totalOrders: number;
  walkinsCount: number;
  commission: number;
};

function calculatePointBreakdown(
  orders: Order[],
  walkins: Walkin[],
  rateCarton: number,
  rateSingles: number
): PointRow[] {
  const m = new Map<string, PointRow>();

  const blank = (id: string, name: string): PointRow => ({
    pointId: id,
    pointName: name,
    cartonWeight: 0,
    singlesWeight: 0,
    customers: 0,
    delivered: 0,
    totalOrders: 0,
    walkinsCount: 0,
    commission: 0,
  });

  for (const o of orders) {
    const id = o.point?.id ?? "__none__";
    const name = o.point?.name ?? "ללא נקודה";
    let row = m.get(id);
    if (!row) {
      row = blank(id, name);
      m.set(id, row);
    }
    row.totalOrders++;
    if (o.deliveredAt) row.delivered++;

    let hasData = false;
    for (const it of o.items) {
      if (it.isCancelled) continue;
      // agentEnteredWeight ולא actualWeight: העמלה על מה שהנציג שקל,
      // לא על תיקוני מנהל. זהה לחישוב ב-liveSummary.
      const w = it.agentEnteredWeight || 0;
      if (w > 0) {
        hasData = true;
        if (it.isSingle) row.singlesWeight += w;
        else row.cartonWeight += w;
      }
    }
    if (hasData) row.customers++;
  }

  for (const w of walkins) {
    const id = (w as any).pointId ?? "__none__";
    const name = (w as any).pointName ?? "ללא נקודה";
    let row = m.get(id);
    if (!row) {
      row = blank(id, name);
      m.set(id, row);
    }
    row.walkinsCount++;
    for (const it of w.items) {
      if (it.isSingle) row.singlesWeight += it.weight;
      else row.cartonWeight += it.weight;
    }
  }

  for (const row of m.values()) {
    row.commission = row.cartonWeight * rateCarton + row.singlesWeight * rateSingles;
  }

  return Array.from(m.values()).sort((a, b) =>
    a.pointName.localeCompare(b.pointName, "he")
  );
}

function PointBreakdown({
  orders,
  walkins,
  rateCarton,
  rateSingles,
}: {
  orders: Order[];
  walkins: Walkin[];
  rateCarton: number;
  rateSingles: number;
}) {
  const rows = calculatePointBreakdown(orders, walkins, rateCarton, rateSingles);
  // מוצג רק כשיש יותר מנקודה אחת - אחרת זו כפילות של הסיכום הכללי
  if (rows.length <= 1) return null;

  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-100">
        <h3 className="font-extrabold text-brand-slatedark">פירוט לפי נקודת חלוקה</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          {rows.length} נקודות · העמלה מחושבת על המשקלים שהזנת
        </p>
      </div>

      <div className="p-4 space-y-3">
        {rows.map((r) => (
          <div key={r.pointId} className="border border-zinc-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-brand-slatedark">📍 {r.pointName}</span>
              <span className="text-lg font-extrabold text-emerald-600">
                ₪{r.commission.toFixed(2)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-orange-50 rounded-lg p-2">
                <div className="text-[10px] text-brand-rust font-bold">קרטונים</div>
                <div className="font-extrabold text-brand-rust">
                  {r.cartonWeight.toFixed(2)} ק״ג
                </div>
                <div className="text-[10px] text-zinc-500">
                  × ₪{rateCarton} = ₪{(r.cartonWeight * rateCarton).toFixed(2)}
                </div>
              </div>
              <div className="bg-amber-50 rounded-lg p-2">
                <div className="text-[10px] text-amber-800 font-bold">בודדים</div>
                <div className="font-extrabold text-amber-800">
                  {r.singlesWeight.toFixed(2)} ק״ג
                </div>
                <div className="text-[10px] text-zinc-500">
                  × ₪{rateSingles} = ₪{(r.singlesWeight * rateSingles).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600 flex-wrap">
              <span>
                <bdi>{r.customers}</bdi> לקוחות שוקלו
              </span>
              <span>
                נמסרו <bdi>{r.delivered}</bdi> מתוך <bdi>{r.totalOrders}</bdi>
              </span>
              {r.walkinsCount > 0 && (
                <span>
                  <bdi>{r.walkinsCount}</bdi> מזדמנים
                </span>
              )}
            </div>
          </div>
        ))}

        <div className="border-t-2 border-zinc-200 pt-3 flex items-center justify-between">
          <span className="font-bold text-brand-slatedark">סה״כ עמלה</span>
          <span className="text-2xl font-extrabold text-emerald-600">
            ₪{totalCommission.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

// חישוב סיכום לפי מוצר
function calculateProductSummary(
  productWeightsFromNotes: Record<string, number>,
  orders: Order[],
  walkins: Walkin[]
) {
  // צבירת ק"ג שחולקו לפי מוצר
  const distributed: Record<string, { name: string; weight: number }> = {};

  for (const order of orders) {
    for (const item of order.items) {
      if (item.isCancelled) continue;
      const w = item.agentEnteredWeight || 0;
      if (w <= 0) continue;
      if (!distributed[item.productId]) {
        distributed[item.productId] = { name: item.productName, weight: 0 };
      }
      distributed[item.productId].weight += w;
    }
  }
  for (const walkin of walkins) {
    for (const item of walkin.items) {
      if (!distributed[item.productId]) {
        distributed[item.productId] = { name: item.productName, weight: 0 };
      }
      distributed[item.productId].weight += item.weight;
    }
  }

  // שילוב עם תעודות
  const allProductIds = new Set([
    ...Object.keys(productWeightsFromNotes),
    ...Object.keys(distributed),
  ]);

  return Array.from(allProductIds)
    .map((productId) => {
      const noteWeight = productWeightsFromNotes[productId] || 0;
      const distributedWeight = distributed[productId]?.weight || 0;
      return {
        productId,
        productName: distributed[productId]?.name || `מוצר #${productId.slice(0, 6)}`,
        noteWeight,
        distributedWeight,
        diff: noteWeight - distributedWeight,
      };
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

function BigStat({
  label,
  value,
  suffix,
  subValue,
  color,
}: {
  label: string;
  value: number;
  suffix?: string;
  subValue?: string;
  color: "rust" | "amber";
}) {
  const colorMap = {
    rust: "bg-orange-50 text-brand-rust",
    amber: "bg-amber-50 text-amber-800",
  }[color];
  return (
    <div className={`rounded-xl p-3 ${colorMap}`}>
      <div className="text-xs font-bold opacity-70 mb-1">{label}</div>
      <div className="text-3xl font-extrabold">
        {value.toFixed(2)}
        {suffix && <span className="text-sm font-bold opacity-70">{suffix}</span>}
      </div>
      {subValue && <div className="text-[10px] opacity-60 mt-1">{subValue}</div>}
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-zinc-600">{label}</span>
      <span className="font-bold text-brand-slatedark">{value}</span>
    </div>
  );
}
