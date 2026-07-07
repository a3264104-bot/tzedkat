"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  description: string | null;
  maxQuantity: number | null;
  stock: number | null;
};

export function PersonalOrderClient({ customerName }: { customerName: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [doneNumber, setDoneNumber] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/personal-request");
        const data = await res.json();
        setEnabled(data.enabled);
        setProducts(data.products || []);
      } catch {
        setEnabled(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setQuantity(id: string, val: number, max: number | null) {
    let v = Math.max(0, val);
    if (max != null) v = Math.min(v, max);
    setQty((prev) => ({ ...prev, [id]: v }));
  }

  async function submit() {
    setError("");
    const items = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (items.length === 0) {
      setError("יש לבחור לפחות מוצר אחד עם כמות");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/personal-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בשליחת הבקשה");
      setDoneNumber(data.requestNumber);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#faf6ec] pb-16">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-20">
        <div className="mx-auto max-w-md px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-brand-slate font-medium">דף הבית</Link>
            <Link href="/account" className="text-brand-slate font-medium">האזור האישי</Link>
          </div>
          <span className="font-extrabold text-brand-rust">הזמנה אישית</span>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 pt-6 space-y-4">
        {loading ? (
          <p className="text-zinc-500">טוען...</p>
        ) : doneNumber ? (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">✓</div>
            <h2 className="text-lg font-extrabold text-brand-slatedark">בקשתכם התקבלה בהצלחה!</h2>
            <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
              מספר בקשה #{doneNumber}. ניצור עמכם קשר בהקדם לתיאום הכמות, המחיר, מקום האיסוף
              ואופן התשלום.
            </p>
            <Link href="/" className="btn-primary mt-6 inline-flex">חזרה לדף הבית</Link>
          </div>
        ) : !enabled ? (
          <div className="card p-8 text-center">
            <div className="text-3xl mb-2">🕐</div>
            <p className="font-bold text-brand-slatedark">השירות אינו פעיל כרגע</p>
            <p className="text-sm text-zinc-500 mt-1">
              הזמנות אישיות אינן זמינות כעת. נסו שוב מאוחר יותר.
            </p>
            <Link href="/" className="btn-ghost btn-sm mt-4 inline-flex">חזרה לדף הבית</Link>
          </div>
        ) : products.length === 0 ? (
          <div className="card p-8 text-center text-zinc-500">
            אין כרגע מוצרים זמינים להזמנה אישית.
          </div>
        ) : (
          <>
            <div className="card p-4 bg-amber-50 border-amber-200">
              <p className="text-sm text-amber-800">
                זו בקשת הזמנה אישית — לא מכירה רגילה. בחרו מוצרים וכמויות, ונציג ייצור עמכם
                קשר לתיאום המחיר, האיסוף והתשלום.
              </p>
            </div>

            {products.map((p) => (
              <div key={p.id} className="card p-3">
                <div className="flex gap-3">
                  {p.imageUrl && (
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="w-16 h-16 rounded-xl object-cover border border-zinc-200 shrink-0"
                      loading="lazy"
                    />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold text-brand-slatedark">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-zinc-500 mt-0.5">{p.description}</div>
                    )}
                    {p.stock != null && (
                      <div className="text-xs text-zinc-400 mt-0.5">מלאי: {p.stock}</div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => setQuantity(p.id, (qty[p.id] ?? 0) - 1, p.maxQuantity)}
                        className="w-8 h-8 rounded-lg bg-zinc-100 font-bold active:scale-95"
                        aria-label="הפחת"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-bold">{qty[p.id] ?? 0}</span>
                      <button
                        onClick={() => setQuantity(p.id, (qty[p.id] ?? 0) + 1, p.maxQuantity)}
                        className="w-8 h-8 rounded-lg bg-brand-rust text-white font-bold active:scale-95"
                        aria-label="הוסף"
                      >
                        +
                      </button>
                      {p.maxQuantity != null && (
                        <span className="text-xs text-zinc-400">מקס' {p.maxQuantity}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className="card p-4">
              <label className="label">הערות (אופציונלי)</label>
              <textarea
                className="input"
                rows={3}
                placeholder="כל בקשה מיוחדת..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg p-2">
                {error}
              </p>
            )}

            <button
              onClick={submit}
              disabled={submitting}
              className="btn-primary w-full text-lg"
            >
              {submitting ? "שולח..." : "שלח בקשה"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
