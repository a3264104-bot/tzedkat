"use client";

// ═══════════════════════════════════════════════════════════════
// §359: סיכום חיוב ללקוח — שליחה, הורדה, או העתקה
// ═══════════════════════════════════════════════════════════════
// הצורך מהשטח: לקוח מזומן שואל "כמה להביא?". הנציג בחלוקה צריך
// לענות מיד — במייל, בוואטסאפ, או להראות במסך.
//
// ⚠️ שלוש דרכים, תוכן אחד: הפירוט מגיע מה-API (§308), ומוצג
// בדיוק כמו במייל ובאתר. אין כאן חישוב "משלנו".
//
// ⚠️ רק אחרי V (agentClosedAt): לפני כן הסכום אינו סופי, ושליחה
// הייתה חוזרת על באג 616 — הלקוח מקבל מספר שמשתנה אחריו.
//
// ⚠️ ולא PDF: ספריית PDF שוקלת 500KB ומאטה את הטבלה. תמונה
// (canvas → PNG) קלה, נפתחת בוואטסאפ, ומספיקה לסיכום של 10
// שורות.

import { useEffect, useRef, useState } from "react";

type Line = { label: string; qty: string; price: number };
type Extra = { label: string; amount: number; negative: boolean };

export default function OrderSummaryModal({
  orderId,
  orderNumber,
  customerName,
  total,
  onClose,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  total: number;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [finalTotal, setFinalTotal] = useState(total);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<"mail" | "download" | "copy" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ─── טעינת הפירוט ───
  useEffect(() => {
    fetch(`/api/agent/orders/${orderId}/summary`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) {
          setLines([]);
          return;
        }
        setLines(d.lines ?? []);
        setExtras(d.extras ?? []);
        setFinalTotal(d.total ?? total);
        setEmail(d.email ?? null);
      })
      .catch(() => setLines([]));
  }, [orderId, total]);

  const fmt = (n: number) =>
    "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ─── הטקסט — להעתקה ולוואטסאפ ───
  function buildText(): string {
    const rows = (lines ?? []).map((l) => `${l.label} · ${l.qty} · ${fmt(l.price)}`);
    const ex = extras.map((e) => `${e.label} ${e.negative ? "−" : "+"}${fmt(e.amount)}`);
    return [
      `סיכום חיוב — הזמנה #${orderNumber}`,
      customerName,
      "",
      ...rows,
      ...(ex.length ? ["", ...ex] : []),
      "",
      `לתשלום: ${fmt(finalTotal)}`,
      "",
      "צדקת רבותינו",
    ].join("\n");
  }

  // ─── התמונה — canvas ───
  //
  // ⚠️ canvas ולא html2canvas: הספרייה שוקלת 200KB ומתמודדת רע עם
  // RTL. ציור ידני של 15 שורות הוא 40 שורות קוד ושליטה מלאה.
  function drawImage(): string | null {
    const c = canvasRef.current;
    if (!c || !lines) return null;

    const W = 600;
    const pad = 32;
    const lineH = 30;
    const rows = lines.length + extras.length;
    const H = pad * 2 + 80 + rows * lineH + 100;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.direction = "rtl";
    ctx.textAlign = "right";

    let y = pad;
    ctx.fillStyle = "#C0461E";
    ctx.font = "bold 22px Arial";
    ctx.fillText(`סיכום חיוב — הזמנה #${orderNumber}`, W - pad, y + 22);
    y += 34;
    ctx.fillStyle = "#333";
    ctx.font = "16px Arial";
    ctx.fillText(customerName, W - pad, y + 16);
    y += 40;

    ctx.strokeStyle = "#e5e5e5";
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    y += 16;

    ctx.font = "15px Arial";
    for (const l of lines) {
      ctx.fillStyle = "#333";
      ctx.textAlign = "right";
      ctx.fillText(l.label, W - pad, y + 15);
      ctx.fillStyle = "#888";
      ctx.font = "13px Arial";
      ctx.fillText(l.qty, W - pad - 260, y + 15);
      ctx.font = "15px Arial";
      ctx.fillStyle = "#333";
      ctx.textAlign = "left";
      ctx.fillText(fmt(l.price), pad, y + 15);
      y += lineH;
    }

    if (extras.length) {
      y += 6;
      for (const e of extras) {
        ctx.fillStyle = e.negative ? "#15803d" : "#555";
        ctx.textAlign = "right";
        ctx.fillText(e.label, W - pad, y + 15);
        ctx.textAlign = "left";
        ctx.fillText((e.negative ? "−" : "+") + fmt(e.amount), pad, y + 15);
        y += lineH;
      }
    }

    y += 10;
    ctx.strokeStyle = "#C0461E";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    y += 20;

    ctx.fillStyle = "#C0461E";
    ctx.font = "bold 22px Arial";
    ctx.textAlign = "right";
    ctx.fillText("לתשלום", W - pad, y + 22);
    ctx.textAlign = "left";
    ctx.fillText(fmt(finalTotal), pad, y + 22);
    y += 44;

    ctx.fillStyle = "#999";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("צדקת רבותינו — עופות, בשר ודגים", W / 2, y + 12);

    return c.toDataURL("image/png");
  }

  // ─── שלוש הפעולות ───
  async function sendMail() {
    setBusy("mail");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/notify`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setMsg("✓ המייל נשלח");
    } catch (e: any) {
      setMsg(e?.message || "שגיאה");
    } finally {
      setBusy(null);
    }
  }

  function download() {
    setBusy("download");
    const url = drawImage();
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `סיכום-${orderNumber}-${customerName}.png`;
      a.click();
      setMsg("✓ הקובץ ירד");
    } else {
      setMsg("שגיאה ביצירת התמונה");
    }
    setBusy(null);
  }

  async function copy() {
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(buildText());
      setMsg("✓ הועתק — הדבק בוואטסאפ");
    } catch {
      setMsg("ההעתקה נכשלה");
    }
    setBusy(null);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-brand-slatedark">
            📄 סיכום חיוב — #{orderNumber}
          </h3>
          <button onClick={onClose} className="text-zinc-400 text-2xl leading-none px-1">
            ×
          </button>
        </div>
        <p className="text-sm text-zinc-600">{customerName}</p>

        {/* התצוגה המקדימה */}
        {lines === null ? (
          <div className="text-center text-zinc-400 py-6">טוען...</div>
        ) : (
          <div className="rounded-xl border border-zinc-200 p-3 text-sm space-y-1">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {l.label}
                  <span className="text-zinc-400 text-xs"> · {l.qty}</span>
                </span>
                <span className="shrink-0 tabular-nums">{fmt(l.price)}</span>
              </div>
            ))}
            {extras.length > 0 && <div className="border-t border-zinc-100 my-1" />}
            {extras.map((e, i) => (
              <div
                key={i}
                className={`flex justify-between gap-2 ${e.negative ? "text-emerald-700" : "text-zinc-600"}`}
              >
                <span>{e.label}</span>
                <span className="tabular-nums">
                  {e.negative ? "−" : "+"}
                  {fmt(e.amount)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t-2 border-brand-rust pt-2 mt-2 font-extrabold text-brand-rust">
              <span>לתשלום</span>
              <span className="tabular-nums">{fmt(finalTotal)}</span>
            </div>
          </div>
        )}

        {/* שלוש הפעולות */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={sendMail}
            disabled={busy !== null || !email}
            title={email ? `ישלח ל-${email}` : "ללקוח אין מייל"}
            className="py-2.5 rounded-xl bg-brand-slatedark text-white text-xs font-bold disabled:opacity-40"
          >
            {busy === "mail" ? "..." : "📧 מייל"}
          </button>
          <button
            onClick={download}
            disabled={busy !== null || !lines}
            className="py-2.5 rounded-xl bg-brand-rust text-white text-xs font-bold disabled:opacity-40"
          >
            {busy === "download" ? "..." : "⬇️ תמונה"}
          </button>
          <button
            onClick={copy}
            disabled={busy !== null || !lines}
            className="py-2.5 rounded-xl border-2 border-zinc-300 text-zinc-700 text-xs font-bold disabled:opacity-40"
          >
            {busy === "copy" ? "..." : "📋 העתק"}
          </button>
        </div>

        {!email && (
          <p className="text-[11px] text-amber-800">
            ⚠️ ללקוח אין כתובת מייל — הורד תמונה או העתק לוואטסאפ.
          </p>
        )}

        {msg && (
          <p className={`text-sm font-bold text-center ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`}>
            {msg}
          </p>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
