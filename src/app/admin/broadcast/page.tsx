"use client";

// מסך /admin/broadcast - שליחת הודעה למספר לקוחות בבת אחת
// 3 מצבים: כולם / לפי נקודת חלוקה / בחירה ידנית

import { useEffect, useState, useMemo } from "react";

type Point = { id: string; name: string; city: string | null };
type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  pointId: string | null;
  pointName: string | null;
  agreedToEmails: boolean;
};

export default function AdminBroadcastPage() {
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<Point[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // תוכן ההודעה
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // מצב הבחירה
  const [mode, setMode] = useState<"all" | "point" | "manual">("all");
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [customerSearch, setCustomerSearch] = useState("");

  // מצב שליחה
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/broadcast/recipients")
      .then((r) => r.json())
      .then((data) => {
        setPoints(data.points || []);
        setCustomers(data.customers || []);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  }, []);

  // חישוב מספר הנמענים לפי המצב הנוכחי - סופרים רק את מי שאישר!
  // (הסינון בפועל בשליחה בשרת יוודא זאת שוב, זו רק תצוגה מדויקת למנהל)
  const recipientCount = useMemo(() => {
    const consented = customers.filter((c) => c.agreedToEmails);
    if (mode === "all") return consented.length;
    if (mode === "point") {
      if (selectedPointIds.size === 0) return 0;
      return consented.filter(
        (c) => c.pointId && selectedPointIds.has(c.pointId)
      ).length;
    }
    // manual: המנהל בחר לקוחות ידנית - אנחנו סופרים רק את המאושרים מתוך הבחירה
    return consented.filter((c) => selectedCustomerIds.has(c.id)).length;
  }, [mode, customers, selectedPointIds, selectedCustomerIds]);

  // נתונים סטטיסטיים לתצוגה למנהל
  const stats = useMemo(() => {
    const total = customers.length;
    const consented = customers.filter((c) => c.agreedToEmails).length;
    return { total, consented, notConsented: total - consented };
  }, [customers]);

  // סינון לקוחות לחיפוש (במצב manual)
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.trim().toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.pointName && c.pointName.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);

  function togglePoint(id: string) {
    const next = new Set(selectedPointIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPointIds(next);
  }

  function toggleCustomer(id: string) {
    const next = new Set(selectedCustomerIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCustomerIds(next);
  }

  function selectAllFiltered() {
    const next = new Set(selectedCustomerIds);
    filteredCustomers.forEach((c) => next.add(c.id));
    setSelectedCustomerIds(next);
  }

  function deselectAll() {
    setSelectedCustomerIds(new Set());
  }

  async function handleSend() {
    if (!subject.trim()) {
      alert("יש להזין כותרת");
      return;
    }
    if (!message.trim()) {
      alert("יש להזין תוכן הודעה");
      return;
    }
    if (recipientCount === 0) {
      alert("לא נבחרו נמענים");
      return;
    }

    const confirmMsg =
      `לשלוח את ההודעה ל-${recipientCount} נמענים?\n\n` +
      `כותרת: ${subject}\n\n` +
      `המשלוח יתבצע ברקע ועשוי לקחת כמה דקות (בהתאם למספר הנמענים).`;
    if (!confirm(confirmMsg)) return;

    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          mode,
          pointIds: mode === "point" ? Array.from(selectedPointIds) : [],
          customerIds: mode === "manual" ? Array.from(selectedCustomerIds) : [],
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResult({
          ok: true,
          text: `נשלחו הוראות שליחה ל-${data.recipientCount} נמענים. המערכת שולחת ברקע.`,
        });
        // מנקה את הטופס
        setSubject("");
        setMessage("");
        setSelectedPointIds(new Set());
        setSelectedCustomerIds(new Set());
      } else {
        setResult({ ok: false, text: data.error || "שגיאה" });
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message || "שגיאת רשת" });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div dir="rtl" className="p-6 text-zinc-500">
        טוען נתונים...
      </div>
    );
  }

  return (
    <div dir="rtl" className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          📧 שליחת הודעה ללקוחות
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          שולח מייל לכל הלקוחות הרשומים עם כתובת מייל.
        </p>
      </div>

      {/* תוכן ההודעה */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 space-y-3">
        <div>
          <label className="text-xs font-bold text-zinc-500 block mb-1">
            כותרת *
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="עדכון מהמערכת"
            className="w-full px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust"
            maxLength={100}
          />
          <div className="text-[10px] text-zinc-400 mt-0.5 text-left">
            {subject.length}/100
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-zinc-500 block mb-1">
            תוכן ההודעה *
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={"שלום רב,\n\nהמכירה הבאה תיפתח ביום..."}
            rows={8}
            className="w-full px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust font-mono text-sm"
            maxLength={5000}
          />
          <div className="text-[10px] text-zinc-400 mt-0.5 text-left">
            {message.length}/5000 · שורות חדשות יישמרו במייל
          </div>
        </div>
      </div>

      {/* בחירת נמענים */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-bold text-brand-slatedark">🎯 בחירת נמענים</div>
          <div
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              recipientCount > 0
                ? "bg-emerald-100 text-emerald-800"
                : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {recipientCount} נמענים נבחרו
          </div>
        </div>

        {/* מצבי בחירה */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ModeButton
            active={mode === "all"}
            onClick={() => setMode("all")}
            icon="🌐"
            label="כל הלקוחות"
            hint={`${stats.consented} מאושרים / ${stats.total} רשומים`}
          />
          <ModeButton
            active={mode === "point"}
            onClick={() => setMode("point")}
            icon="📍"
            label="לפי נקודת חלוקה"
            hint="בחר נקודות"
          />
          <ModeButton
            active={mode === "manual"}
            onClick={() => setMode("manual")}
            icon="👤"
            label="בחירה ידנית"
            hint="לקוח אחר לקוח"
          />
        </div>

        {stats.notConsented > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
            ⚠️ יש {stats.notConsented} לקוחות שלא אישרו קבלת מיילים - הם מופיעים ברשימה אבל <strong>לא יקבלו את ההודעה</strong>.
            (מסומנים באדום בבחירה ידנית.)
          </div>
        )}

        {/* תת-בחירה לפי מצב */}
        {mode === "point" && (
          <div className="border-t border-zinc-200 pt-3">
            <div className="text-xs font-bold text-zinc-500 mb-2">
              בחר נקודות חלוקה:
            </div>
            {points.length === 0 ? (
              <p className="text-sm text-zinc-500">אין נקודות פעילות</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {points.map((p) => {
                  const count = customers.filter(
                    (c) => c.pointId === p.id
                  ).length;
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedPointIds.has(p.id)
                          ? "bg-emerald-50 border-emerald-300"
                          : "bg-white border-zinc-200 hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPointIds.has(p.id)}
                        onChange={() => togglePoint(p.id)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-brand-slatedark text-sm truncate">
                          {p.name}
                        </div>
                        {p.city && (
                          <div className="text-xs text-zinc-500">{p.city}</div>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400 shrink-0">
                        {count}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mode === "manual" && (
          <div className="border-t border-zinc-200 pt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="search"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="חיפוש לפי שם/מייל/טלפון/נקודה..."
                className="flex-1 min-w-[200px] px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust text-sm"
              />
              <button
                onClick={selectAllFiltered}
                className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg font-bold"
              >
                בחר את המסוננים ({filteredCustomers.length})
              </button>
              <button
                onClick={deselectAll}
                className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg font-bold"
              >
                נקה בחירה
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto border border-zinc-200 rounded-lg">
              {filteredCustomers.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 p-4">
                  לא נמצאו לקוחות
                </p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {filteredCustomers.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 p-2.5 cursor-pointer transition-colors ${
                        selectedCustomerIds.has(c.id)
                          ? c.agreedToEmails
                            ? "bg-emerald-50"
                            : "bg-red-50"
                          : "hover:bg-zinc-50"
                      } ${!c.agreedToEmails ? "opacity-70" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCustomerIds.has(c.id)}
                        onChange={() => toggleCustomer(c.id)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-brand-slatedark text-sm truncate flex items-center gap-1.5">
                          {c.name}
                          {!c.agreedToEmails && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold shrink-0">
                              לא אישר
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 truncate">
                          {c.email}
                          {c.pointName && ` · 📍 ${c.pointName}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* כפתור שליחה + הודעת תוצאה */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 space-y-3">
        <button
          onClick={handleSend}
          disabled={sending || recipientCount === 0 || !subject.trim() || !message.trim()}
          className="w-full py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "שולח..." : `📧 שלח ל-${recipientCount} נמענים`}
        </button>

        {result && (
          <div
            className={`rounded-lg p-3 text-sm font-medium ${
              result.ok
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}
          >
            {result.ok ? "✅ " : "⚠️ "}
            {result.text}
          </div>
        )}

        <p className="text-[11px] text-zinc-500 leading-relaxed">
          💡 השליחה מתבצעת בקצב מבוקר (8 מיילים כל שנייה) כדי לעמוד במגבלות של
          Resend. משלוח של 100 לקוחות ייקח כ-15 שניות; 1000 לקוחות ייקח כ-2.5 דקות.
        </p>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl border-2 text-right transition-colors ${
        active
          ? "bg-brand-rust text-white border-brand-rust"
          : "bg-white text-brand-slatedark border-zinc-200 hover:bg-zinc-50"
      }`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="font-bold text-sm">{label}</div>
      <div
        className={`text-xs mt-0.5 ${
          active ? "text-white/80" : "text-zinc-500"
        }`}
      >
        {hint}
      </div>
    </button>
  );
}
