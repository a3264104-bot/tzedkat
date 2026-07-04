"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { effectiveUnitPrice, lineEstimate, fmt } from "@/lib/pricing";

type Point = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  deliveryHours: string | null;
  notes: string | null;
};

type Product = {
  id: string;
  name: string;
  category: string;
  categorySort: number;
  price: number;
  allowSingles: boolean;
  unit: string;
  saleType: string;
  priceType: string;
  packageWeight: string | null;
  isFrozen: boolean;
  limitedQty: boolean;
  sortOrder: number;
};

type Pricelist = {
  id: string;
  name: string;
  deliveryDateText: string | null;
  notes: string | null;
  singleSurcharge: number;
};

// פרטי הלקוח המחובר - מגיעים מה-session, לא מוקלדים מחדש בכל הזמנה
type LoggedInCustomer = {
  name: string;
  phone: string | null;
  email: string | null;
  defaultPointId: string | null;
};

type CartLine = { isSingle: boolean; qty: number };

// "details" נשאר רק כדי להשלים טלפון אם חסר בחשבון, ולקלוט פרטים פר-הזמנה (טלפון נוסף/הערות)
type Step = "point" | "date" | "products" | "cart" | "details" | "summary" | "done";

export function OrderFlow({
  pricelist,
  points,
  products,
  customer,
  onBehalfOfCustomerId,
}: {
  pricelist: Pricelist;
  points: Point[];
  products: Product[];
  customer: LoggedInCustomer;
  // אם נציג מזמין בשם לקוח - מזהה הלקוח. undefined = הזמנה רגילה
  onBehalfOfCustomerId?: string;
}) {
  const [step, setStep] = useState<Step>("point");
  // אם ללקוח יש נקודה שמורה, בוחרים אותה כברירת מחדל - אבל הוא עדיין יכול לשנות
  const [pointId, setPointId] = useState<string>(customer.defaultPointId ?? "");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  // טלפון נוסף והערות הם פר-הזמנה ונשארים כשדות חופשיים. הטלפון הראשי מגיע מהחשבון,
  // ואם הוא חסר שם (לקוח שנרשם עם מייל בלבד) - משלימים אותו כאן פעם אחת.
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [phone2, setPhone2] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [error, setError] = useState("");

  const point = points.find((p) => p.id === pointId) || null;
  const needsPhoneInput = !customer.phone;

  // קיבוץ נקודות חלוקה לפי עיר - אם יש כמה ערים, קודם בוחרים עיר ואז נקודה בתוכה.
  // אם יש עיר אחת בלבד (או שלנקודות אין עיר מוגדרת כלל), מציגים ישר רשימת נקודות בלי שלב עיר.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) if (p.city) set.add(p.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [points]);
  const pointsWithoutCity = useMemo(() => points.filter((p) => !p.city), [points]);
  const showCityStep = cities.length > 1;
  const pointsInSelectedCity = useMemo(
    () => (selectedCity ? points.filter((p) => p.city === selectedCity) : []),
    [points, selectedCity]
  );

  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return Array.from(map.entries());
  }, [products]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, l]) => l.qty > 0)
      .map(([id, l]) => {
        const p = products.find((x) => x.id === id)!;
        const unitPrice = effectiveUnitPrice(p.price, l.isSingle, pricelist.singleSurcharge);
        return { product: p, ...l, unitPrice, lineTotal: lineEstimate(unitPrice, l.qty) };
      });
  }, [cart, products, pricelist.singleSurcharge]);

  const estimatedTotal = cartLines.reduce((s, l) => s + l.lineTotal, 0);
  const itemCount = cartLines.length;

  function setQty(id: string, qty: number) {
    setCart((c) => {
      const prev = c[id] ?? { isSingle: false, qty: 0 };
      return { ...c, [id]: { ...prev, qty: Math.max(0, qty) } };
    });
  }
  function setSingle(id: string, isSingle: boolean) {
    setCart((c) => {
      const prev = c[id] ?? { isSingle: false, qty: 0 };
      return { ...c, [id]: { ...prev, isSingle } };
    });
  }

  function stepFromQty(p: Product) {
    return p.saleType === "WEIGHT" ? 0.5 : 1;
  }

  async function submit() {
    setError("");
    if (needsPhoneInput && !phone.trim()) {
      setError("נא להזין מספר טלפון");
      return;
    }
    if (!paymentConfirmed) {
      setError("נא לאשר את תנאי ההזמנה");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricelistId: pricelist.id,
          pointId,
          // השם תמיד מגיע מהחשבון המחובר - לא ניתן לעריכה כאן
          customerName: customer.name,
          phone: (phone || customer.phone || "").trim(),
          phone2: phone2.trim() || null,
          notes: notes.trim() || null,
          onBehalfOfCustomerId: onBehalfOfCustomerId || null,
          items: cartLines.map((l) => ({
            productId: l.product.id,
            isSingle: l.isSingle,
            quantity: l.qty,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בשליחת ההזמנה");
      setOrderNumber(data.orderNumber);
      setStep("done");
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#faf6ec] pb-28">
      {/* header */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-20">
        <div className="mx-auto max-w-md px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-brand-slate text-sm font-medium">
            דף הבית
          </Link>
          <span className="font-extrabold text-brand-rust">צדקת רבותינו</span>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 pt-5">
        <StepBar step={step} />

        {/* STEP: choose point - מקובץ לפי עיר אם יש יותר מעיר אחת */}
        {step === "point" && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-3">
              {showCityStep && !selectedCity ? "בחירת עיר" : "בחירת נקודת חלוקה"}
            </h2>

            {/* שלב עיר - רק אם יש כמה ערים ועדיין לא נבחרה אחת */}
            {showCityStep && !selectedCity && (
              <div className="space-y-2.5">
                {cities.map((city) => (
                  <button
                    key={city}
                    onClick={() => setSelectedCity(city)}
                    className="w-full text-right card p-4 flex justify-between items-center"
                  >
                    <span className="font-bold text-brand-slatedark">{city}</span>
                    <span className="text-zinc-400 text-sm">
                      {points.filter((p) => p.city === city).length > 1
                        ? `${points.filter((p) => p.city === city).length} נקודות`
                        : ""}
                    </span>
                  </button>
                ))}
                {pointsWithoutCity.length > 0 && (
                  <>
                    <div className="text-sm text-zinc-400 pt-2">נקודות נוספות</div>
                    {pointsWithoutCity.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPointId(p.id);
                          setStep("date");
                        }}
                        className="w-full text-right card p-4"
                      >
                        <div className="font-bold text-brand-slatedark">{p.name}</div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* שלב נקודה בתוך עיר שנבחרה (או רשימה שטוחה אם עיר אחת בלבד) */}
            {(!showCityStep || selectedCity) && (
              <div className="space-y-2.5">
                {showCityStep && (
                  <button
                    onClick={() => setSelectedCity(null)}
                    className="text-sm text-brand-rust font-medium mb-1"
                  >
                    ← חזרה לבחירת עיר
                  </button>
                )}
                {(showCityStep ? pointsInSelectedCity : points).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPointId(p.id)}
                    className={`w-full text-right card p-4 transition ${
                      pointId === p.id ? "ring-2 ring-brand-rust border-brand-rust" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-brand-slatedark">{p.name}</div>
                        {p.contactName && (
                          <div className="text-sm text-zinc-500 mt-0.5">{p.contactName}</div>
                        )}
                      </div>
                      {customer.defaultPointId === p.id && (
                        <span className="badge bg-amber-100 text-amber-700">נקודה שמורה</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <BottomBar>
              <button
                disabled={!pointId}
                onClick={() => setStep("date")}
                className="btn-primary w-full"
              >
                המשך ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: confirm date */}
        {step === "date" && point && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-3">פרטי החלוקה</h2>
            <div className="card p-5 space-y-3">
              <Row label="נקודת חלוקה" value={point.name} />
              {point.city && <Row label="עיר / אזור" value={point.city} />}
              {point.address && <Row label="כתובת" value={point.address} />}
              <Row
                label="תאריך ושעת חלוקה"
                value={pricelist.deliveryDateText || "יימסר ע\"י הנציג"}
                highlight
              />
              {point.deliveryHours && <Row label="שעות חלוקה" value={point.deliveryHours} />}
              {point.contactName && <Row label="נציג / איש קשר" value={point.contactName} />}
              {point.phone && <Row label="טלפון" value={point.phone} />}
              {point.email && <Row label="מייל" value={point.email} />}
              {point.notes && <Row label="הערות" value={point.notes} />}
            </div>

            <label className="flex items-start gap-3 mt-4 card p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={dateConfirmed}
                onChange={(e) => setDateConfirmed(e.target.checked)}
                className="mt-1 h-5 w-5 accent-brand-rust"
              />
              <span className="text-sm font-medium text-zinc-700">
                אני מאשר/ת שראיתי את תאריך ושעת החלוקה
              </span>
            </label>

            <BottomBar>
              <button onClick={() => setStep("point")} className="btn-ghost flex-1">
                חזרה
              </button>
              <button
                disabled={!dateConfirmed}
                onClick={() => setStep("products")}
                className="btn-primary flex-1"
              >
                המשך ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: products */}
        {step === "products" && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-1">בחירת מוצרים</h2>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
              המחיר באתר הוא מחיר משוער. המחיר הסופי ייקבע לפי המשקל והאריזה בפועל.
            </p>
            <div className="space-y-6">
              {categories.map(([cat, items]) => (
                <div key={cat}>
                  <h3 className="font-extrabold text-brand-rust mb-2 border-b-2 border-brand-rust/20 pb-1">
                    {cat}
                  </h3>
                  <div className="space-y-2">
                    {items.map((p) => {
                      const line = cart[p.id] ?? { isSingle: false, qty: 0 };
                      const unitPrice = effectiveUnitPrice(
                        p.price,
                        line.isSingle,
                        pricelist.singleSurcharge
                      );
                      return (
                        <div key={p.id} className="card p-3">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1">
                              <div className="font-semibold text-brand-slatedark text-[15px] leading-tight">
                                {p.name}
                              </div>
                              <div className="text-sm text-zinc-500 mt-0.5">
                                {p.saleType === "WEIGHT" && p.priceType === "CARTON" ? (
                                  <>
                                    <span className="font-medium text-brand-slatedark">
                                      מחיר קרטון: {fmt(p.price)} לק"ג
                                    </span>
                                    {p.allowSingles && (
                                      <span className="block text-xs text-zinc-400">
                                        בודדים: {fmt(effectiveUnitPrice(p.price, true, pricelist.singleSurcharge))} לק"ג
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>{fmt(unitPrice)} / {p.unit}</>
                                )}
                                {p.limitedQty && (
                                  <span className="badge bg-amber-100 text-amber-700 mr-2">
                                    כמות מוגבלת
                                  </span>
                                )}
                              </div>
                            </div>
                            <QtyControl
                              value={line.qty}
                              step={stepFromQty(p)}
                              onChange={(v) => setQty(p.id, v)}
                            />
                          </div>
                          {p.allowSingles && line.qty > 0 && (
                            <label className="flex items-center gap-2 mt-2 text-sm text-zinc-600">
                              <input
                                type="checkbox"
                                checked={line.isSingle}
                                onChange={(e) => setSingle(p.id, e.target.checked)}
                                className="h-4 w-4 accent-brand-rust"
                              />
                              בבודדים (תוספת {fmt(pricelist.singleSurcharge)} לק"ג)
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <BottomBar>
              <button onClick={() => setStep("date")} className="btn-ghost flex-1">
                חזרה
              </button>
              <button
                disabled={itemCount === 0}
                onClick={() => setStep("cart")}
                className="btn-primary flex-1"
              >
                לסל ({itemCount}) ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: cart */}
        {step === "cart" && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-3">סל ההזמנה</h2>
            <div className="space-y-2">
              {cartLines.map((l) => (
                <div key={l.product.id} className="card p-3 flex justify-between items-center">
                  <div className="flex-1">
                    <div className="font-semibold text-brand-slatedark">
                      {l.product.name}
                      {l.isSingle && (
                        <span className="badge bg-amber-100 text-amber-700 mr-2">בודדים</span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-500">
                      {l.qty} {l.product.unit} × {fmt(l.unitPrice)}
                    </div>
                  </div>
                  <div className="font-bold text-brand-rust">{fmt(l.lineTotal)}</div>
                </div>
              ))}
            </div>
            <div className="card p-4 mt-4 flex justify-between items-center">
              <span className="font-bold">סה"כ משוער</span>
              <span className="text-xl font-extrabold text-brand-rust">{fmt(estimatedTotal)}</span>
            </div>
            <BottomBar>
              <button onClick={() => setStep("products")} className="btn-ghost flex-1">
                הוסף עוד
              </button>
              <button onClick={() => setStep("details")} className="btn-primary flex-1">
                המשך ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: details - מוצג רק כדי להשלים טלפון אם חסר בחשבון, ולקלוט פרטים פר-הזמנה (טלפון נוסף/הערות) */}
        {step === "details" && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-1">פרטי ההזמנה</h2>
            <p className="text-sm text-zinc-500 mb-4">
              מזמין/ה בתור <span className="font-semibold text-brand-slatedark">{customer.name}</span>
            </p>
            <div className="space-y-3">
              {needsPhoneInput && (
                <div>
                  <label className="label">טלפון *</label>
                  <input
                    className="input"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="label">טלפון נוסף</label>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  value={phone2}
                  onChange={(e) => setPhone2(e.target.value)}
                />
              </div>
              <div>
                <label className="label">הערות להזמנה</label>
                <textarea
                  className="input min-h-[80px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <BottomBar>
              <button onClick={() => setStep("cart")} className="btn-ghost flex-1">
                חזרה
              </button>
              <button
                disabled={needsPhoneInput && !phone.trim()}
                onClick={() => setStep("summary")}
                className="btn-primary flex-1"
              >
                לסיכום ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: summary */}
        {step === "summary" && point && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-3">סיכום הזמנה</h2>

            <div className="card p-4 space-y-2 text-sm">
              <Row label="נקודת חלוקה" value={point.name} />
              <Row label="תאריך חלוקה" value={pricelist.deliveryDateText || "—"} />
              <Row label="שם" value={customer.name} />
              <Row label="טלפון" value={phone || customer.phone || "—"} />
              {phone2 && <Row label="טלפון נוסף" value={phone2} />}
              {notes && <Row label="הערות" value={notes} />}
            </div>

            <div className="card p-4 mt-3 space-y-2">
              {cartLines.map((l) => (
                <div key={l.product.id} className="flex justify-between text-sm">
                  <span>
                    {l.product.name} — {l.qty} {l.product.unit}
                    {l.isSingle ? " (בודדים)" : ""}
                  </span>
                  <span className="font-semibold">{fmt(l.lineTotal)}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>סה"כ משוער</span>
                <span className="text-brand-rust">{fmt(estimatedTotal)}</span>
              </div>
            </div>

            {/* הודעת התשלום עודכנה: התשלום מתבצע באתר, ורק לאחר קביעת מחיר סופי לפי שקילה */}
            <div className="card p-4 mt-3 bg-amber-50 border-amber-200">
              <p className="text-sm font-semibold text-amber-900">
                המחיר המוצג הוא מחיר משוער בלבד. המחיר הסופי ייקבע לאחר שקילה בפועל על ידי הנציג.
              </p>
              <p className="text-sm font-bold text-amber-900 mt-2">
                לאחר עדכון המחיר הסופי תקבל/י הודעה עם קישור לתשלום באתר.
              </p>
            </div>

            <label className="flex items-start gap-3 mt-3 card p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={paymentConfirmed}
                onChange={(e) => setPaymentConfirmed(e.target.checked)}
                className="mt-1 h-5 w-5 accent-brand-rust"
              />
              <span className="text-sm font-medium text-zinc-700">
                אני מאשר/ת שראיתי שהמחיר משוער, ושהתשלום הסופי יתבצע באתר לאחר קביעת מחיר סופי.
              </span>
            </label>

            {error && <p className="text-red-600 text-sm mt-3 font-medium">{error}</p>}

            <BottomBar>
              <button onClick={() => setStep("details")} className="btn-ghost flex-1">
                חזרה
              </button>
              <button
                disabled={!paymentConfirmed || submitting}
                onClick={submit}
                className="btn-primary flex-1"
              >
                {submitting ? "שולח..." : "שליחת הזמנה"}
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: done */}
        {step === "done" && (
          <section className="text-center pt-10">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">
              ✓
            </div>
            <h2 className="text-2xl font-extrabold text-brand-slatedark mt-4">ההזמנה התקבלה!</h2>
            <p className="text-zinc-600 mt-2">
              מספר הזמנה: <span className="font-bold">#{orderNumber}</span>
            </p>
            <div className="card p-4 mt-6 text-sm text-right space-y-2">
              <Row label="נקודת חלוקה" value={point?.name || ""} />
              <Row label="סה״כ משוער" value={fmt(estimatedTotal)} />
            </div>
            <p className="text-xs text-zinc-500 mt-4">
              ההזמנה ממתינה לשקילה. לאחר קביעת מחיר סופי תקבל/י הודעה עם קישור לתשלום.
            </p>
            <Link href="/" className="btn-primary mt-6 inline-flex">
              חזרה לדף הבית
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: Step[] = ["point", "date", "products", "cart", "details", "summary"];
  const idx = steps.indexOf(step);
  if (step === "done") return null;
  return (
    <div className="flex gap-1.5 mb-5">
      {steps.map((s, i) => (
        <div
          key={s}
          className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-brand-rust" : "bg-zinc-200"}`}
        />
      ))}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500 text-sm">{label}</span>
      <span className={`text-sm font-semibold text-left ${highlight ? "text-brand-rust" : "text-brand-slatedark"}`}>
        {value}
      </span>
    </div>
  );
}

function QtyControl({
  value,
  step,
  onChange,
}: {
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(round(Math.max(0, value - step)))}
        className="w-8 h-8 rounded-lg bg-zinc-100 text-brand-slate font-bold text-lg leading-none active:scale-95"
        aria-label="הפחת"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={value || ""}
        onChange={(e) => onChange(round(parseFloat(e.target.value) || 0))}
        className="w-12 text-center rounded-lg border border-zinc-200 py-1.5 font-semibold"
        placeholder="0"
      />
      <button
        onClick={() => onChange(round(value + step))}
        className="w-8 h-8 rounded-lg bg-brand-rust text-white font-bold text-lg leading-none active:scale-95"
        aria-label="הוסף"
      >
        +
      </button>
    </div>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 no-print">
      <div className="mx-auto max-w-md px-4 py-3 flex gap-2">{children}</div>
    </div>
  );
}
