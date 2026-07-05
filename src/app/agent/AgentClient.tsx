"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/Logo";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  defaultPointName: string | null;
  orderCount: number;
};

export function AgentClient({
  agentName,
  canSetFinalPrice,
  canSendPaymentLink,
  restrictedPointName,
}: {
  agentName: string;
  canSetFinalPrice: boolean;
  canSendPaymentLink: boolean;
  restrictedPointName: string | null;
}) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);

  // חיפוש עם השהיה קלה (debounce) כדי לא להעמיס בקשות
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/agent/customers?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setCustomers(Array.isArray(data) ? data : []);
      } catch {
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <main dir="rtl" className="min-h-screen bg-[#faf6ec] pb-16">
      <header className="bg-brand-slatedark text-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-extrabold text-brand-yellow">אזור הנציג</div>
            <div className="text-xs text-zinc-400">{agentName}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-zinc-300"
          >
            יציאה
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 pt-5 space-y-4">
        {/* הרשאות */}
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-blue-100 text-blue-700">
            {restrictedPointName ? `נקודה: ${restrictedPointName}` : "כל הלקוחות"}
          </span>
          {canSetFinalPrice && (
            <span className="badge bg-green-100 text-green-700">קובע מחיר סופי</span>
          )}
          {canSendPaymentLink && (
            <span className="badge bg-violet-100 text-violet-700">שולח לינק תשלום</span>
          )}
        </div>

        {/* חיפוש */}
        <div className="card p-4">
          <label className="label">חיפוש לקוח</label>
          <input
            className="input"
            placeholder="שם, טלפון או מייל..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* תוצאות */}
        {loading ? (
          <p className="text-zinc-500 text-center">מחפש...</p>
        ) : customers.length === 0 ? (
          <p className="text-zinc-400 text-center py-4">
            {query ? "לא נמצאו לקוחות" : "התחל להקליד כדי לחפש לקוח"}
          </p>
        ) : (
          <div className="space-y-2">
            {customers.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-brand-slatedark">{c.name}</div>
                    {c.phone && <div className="text-sm text-zinc-500">{c.phone}</div>}
                    {c.defaultPointName && (
                      <div className="text-xs text-zinc-400 mt-0.5">
                        נקודה: {c.defaultPointName}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400">{c.orderCount} הזמנות</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Link
                    href={`/agent/order/${c.id}`}
                    className="btn-primary btn-sm flex-1 text-center"
                  >
                    הזמנה חדשה בשמו
                  </Link>
                  <Link
                    href={`/agent/customer/${c.id}`}
                    className="btn-ghost btn-sm flex-1 text-center"
                  >
                    הזמנות
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
