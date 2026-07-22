"use client";

// §20: פאנל סיכום וסגירת המכירה
// מציג: סה"כ ק"ג + עמלה + השוואה לתעודות משלוח + סימון פערים + סגירה

import { useState } from "react";
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
      if (!res.ok) throw new Error("שגיאה בסגירה");
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
          <button
            onClick={confirmSale}
            disabled={confirming}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg disabled:opacity-50 transition-all"
          >
            {confirming ? "סוגר..." : "✓ סגור את המכירה"}
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
            ✓ נסגר ב-{new Date(summary.confirmedAt).toLocaleString("he-IL")}
          </div>
        </div>
      )}
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
