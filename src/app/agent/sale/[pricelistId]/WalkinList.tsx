"use client";

// §20: רשימת מזדמנים + טופס הוספה מהיר
import { useState } from "react";
import type { Walkin, AvailableProduct } from "./AgentSaleClient";

type Props = {
  pricelistId: string;
  walkins: Walkin[];
  availableProducts: AvailableProduct[];
  readOnly?: boolean;
  onChange: () => void;
};

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

export function WalkinList({
  pricelistId,
  walkins,
  availableProducts,
  readOnly,
  onChange,
}: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-3">
      {/* כפתור הוספה */}
      {!readOnly && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full bg-brand-rust text-white rounded-xl py-3 font-bold shadow-md hover:bg-[#a83a15] transition-all flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          הוסף לקוח מזדמן
        </button>
      )}

      {showForm && (
        <WalkinForm
          pricelistId={pricelistId}
          availableProducts={availableProducts}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            onChange();
          }}
        />
      )}

      {/* רשימת מזדמנים קיימים */}
      {walkins.length === 0 && !showForm ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-zinc-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-brand-slatedark font-semibold">אין מזדמנים עדיין</p>
          <p className="text-sm text-zinc-500 mt-1">
            הוסף לקוחות שהגיעו לחלוקה בלי הזמנה מראש
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

// טופס הוספת מזדמן
type FormItem = {
  productId: string;
  weight: string;
  isSingle: boolean;
};

function WalkinForm({
  pricelistId,
  availableProducts,
  onClose,
  onSuccess,
}: {
  pricelistId: string;
  availableProducts: AvailableProduct[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentReceived, setPaymentReceived] = useState(true);
  const [paymentNote, setPaymentNote] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<FormItem[]>([
    { productId: "", weight: "", isSingle: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});

  // חישוב סכום כולל
  const total = items.reduce((sum, it) => {
    const product = availableProducts.find((p) => p.productId === it.productId);
    if (!product) return sum;
    const weight = parseFloat(it.weight) || 0;
    let price = product.price;
    if (it.isSingle && product.product.singlesMode === "UNITS" && product.product.singleUnitPrice) {
      price = product.product.singleUnitPrice;
    } else if (it.isSingle && product.product.singleSurcharge) {
      price = product.price + product.product.singleSurcharge;
    }
    return sum + weight * price;
  }, 0);

  // ברירת מחדל של paymentReceived לפי אמצעי תשלום
  function updatePaymentMethod(method: string) {
    setPaymentMethod(method);
    // מזומן + אשראי במסוף = התקבל מיד. העברה + אונליין = ממתין לאישור
    setPaymentReceived(method === "CASH" || method === "CARD_TERMINAL");
  }

  async function submit() {
    if (!customerName.trim()) {
      alert("יש להזין שם לקוח");
      return;
    }
    const validItems = items
      .filter((it) => it.productId && parseFloat(it.weight) > 0)
      .map((it) => ({
        productId: it.productId,
        weight: parseFloat(it.weight),
        isSingle: it.isSingle,
      }));
    if (validItems.length === 0) {
      alert("יש להוסיף לפחות פריט אחד עם משקל");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/agent/walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricelistId,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          customerEmail: customerEmail.trim() || null,
          paymentMethod,
          paymentReceived,
          paymentNote: paymentNote.trim() || null,
          notes: notes.trim() || null,
          items: validItems,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      onSuccess();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-brand-rust shadow-lg overflow-hidden">
      <div className="bg-brand-rust text-white px-4 py-3 flex items-center justify-between">
        <h3 className="font-bold">לקוח מזדמן חדש</h3>
        <button onClick={onClose} className="text-white/80 hover:text-white text-xl">
          ×
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* פרטי לקוח */}
        <div className="grid grid-cols-2 gap-2">
          <label>
            <div className="text-xs font-bold text-zinc-500 mb-1">שם *</div>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="שם הלקוח"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </label>
          <label>
            <div className="text-xs font-bold text-zinc-500 mb-1">טלפון (רשות)</div>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="לפעם הבאה"
              dir="ltr"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </label>
        </div>

        {/* אימייל */}
        <label className="block">
          <div className="text-xs font-bold text-zinc-500 mb-1">
            אימייל (רשות){" "}
            <span className="font-normal text-zinc-400">— לשליחת סיכום</span>
          </div>
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="example@gmail.com"
            dir="ltr"
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
          />
        </label>

        {/* פריטים */}
        <div>
          <div className="text-xs font-bold text-zinc-500 mb-1">פריטים</div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <FormItemRow
                key={idx}
                item={item}
                availableProducts={availableProducts}
                search={productSearch[idx] || ""}
                onSearchChange={(s) =>
                  setProductSearch((p) => ({ ...p, [idx]: s }))
                }
                onChange={(updated) => {
                  setItems((prev) =>
                    prev.map((x, i) => (i === idx ? updated : x))
                  );
                }}
                onRemove={() => {
                  setItems((prev) => prev.filter((_, i) => i !== idx));
                }}
                canRemove={items.length > 1}
              />
            ))}
            <button
              onClick={() =>
                setItems([...items, { productId: "", weight: "", isSingle: false }])
              }
              className="w-full text-sm text-brand-rust font-medium py-2 border-2 border-dashed border-brand-rust/30 rounded-lg hover:bg-orange-50"
            >
              + הוסף פריט
            </button>
          </div>
        </div>

        {/* אמצעי תשלום */}
        <div>
          <div className="text-xs font-bold text-zinc-500 mb-1">אמצעי תשלום</div>
          <div className="grid grid-cols-2 gap-2">
            {["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"].map((method) => (
              <button
                key={method}
                onClick={() => updatePaymentMethod(method)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  paymentMethod === method
                    ? "bg-brand-rust text-white shadow-sm"
                    : "bg-white border border-zinc-300 text-brand-slatedark hover:border-brand-rust"
                }`}
              >
                {PAYMENT_ICONS[method]} {PAYMENT_LABELS[method]}
              </button>
            ))}
          </div>
        </div>

        {/* פרטי תשלום נוספים */}
        {(paymentMethod === "TRANSFER" || paymentMethod === "CARD_TERMINAL") && (
          <label>
            <div className="text-xs font-bold text-zinc-500 mb-1">
              {paymentMethod === "TRANSFER"
                ? "שם המעביר / זמן העברה"
                : "4 ספרות אחרונות / קוד אישור"}
            </div>
            <input
              type="text"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder={
                paymentMethod === "TRANSFER"
                  ? "למשל: שלמה כהן, 14:30"
                  : "למשל: 4523, אישור 123456"
              }
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </label>
        )}

        {(paymentMethod === "TRANSFER" || paymentMethod === "ONLINE") && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={paymentReceived}
              onChange={(e) => setPaymentReceived(e.target.checked)}
              className="w-4 h-4 accent-brand-rust"
            />
            <span>
              {paymentMethod === "TRANSFER"
                ? "ההעברה בוצעה ואומתה מול הבנק"
                : "התשלום התקבל דרך המערכת"}
            </span>
          </label>
        )}

        {/* הערות */}
        <label>
          <div className="text-xs font-bold text-zinc-500 mb-1">הערות (רשות)</div>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="למשל: השאיר עודף 5₪"
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
          />
        </label>

        {/* סה"כ */}
        <div className="bg-brand-yellow/30 border border-brand-yellow rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm font-bold text-brand-slatedark">סה״כ לקוח</span>
          <span className="text-xl font-extrabold text-brand-rust">
            ₪{total.toFixed(2)}
          </span>
        </div>

        {/* כפתורים */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-300 text-brand-slate rounded-lg font-medium"
          >
            ביטול
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 py-2.5 bg-brand-rust text-white rounded-lg font-bold disabled:opacity-50"
          >
            {saving ? "שומר..." : "שמור מזדמן"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormItemRow({
  item,
  availableProducts,
  search,
  onSearchChange,
  onChange,
  onRemove,
  canRemove,
}: {
  item: FormItem;
  availableProducts: AvailableProduct[];
  search: string;
  onSearchChange: (s: string) => void;
  onChange: (item: FormItem) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const selectedProduct = availableProducts.find((p) => p.productId === item.productId);
  const filtered = availableProducts.filter((p) =>
    p.product.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="border border-zinc-200 rounded-lg p-2 bg-zinc-50">
      {!selectedProduct ? (
        <div>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="חפש מוצר..."
            className="w-full px-2 py-1.5 border border-zinc-300 rounded text-sm mb-1"
          />
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {filtered.slice(0, 10).map((p) => (
              <button
                key={p.productId}
                onClick={() => {
                  onChange({ ...item, productId: p.productId });
                  onSearchChange("");
                }}
                className="w-full text-right px-2 py-1 hover:bg-blue-100 rounded text-xs text-brand-slatedark"
              >
                <div className="font-semibold">{p.product.name}</div>
                <div className="text-zinc-500">
                  ₪{p.price.toFixed(2)} · {p.product.category?.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-brand-slatedark">
                {selectedProduct.product.name}
              </div>
              <div className="text-xs text-zinc-500">
                ₪{selectedProduct.price.toFixed(2)}
              </div>
            </div>
            <button
              onClick={() => onChange({ ...item, productId: "" })}
              className="text-xs text-zinc-500 hover:text-red-600"
            >
              שנה
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={item.weight}
              onChange={(e) => onChange({ ...item, weight: e.target.value })}
              placeholder="ק״ג"
              className="flex-1 px-2 py-1 border border-zinc-300 rounded text-center font-bold"
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={item.isSingle}
                onChange={(e) => onChange({ ...item, isSingle: e.target.checked })}
                className="w-3.5 h-3.5 accent-brand-rust"
              />
              בודדים
            </label>
            {canRemove && (
              <button
                onClick={onRemove}
                className="text-xs text-red-600 px-1.5"
              >
                ×
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
