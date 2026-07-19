"use client";

import { useEffect, useRef, useState } from "react";

// §9: קומפוננט צ'אט משותף לבקשות אישיות
// משמש גם את הלקוח וגם את המנהל (differentiate לפי currentUserType)

type Message = {
  id: string;
  senderType: "CUSTOMER" | "ADMIN";
  senderName: string;
  message: string;
  createdAt: string;
};

type Props = {
  requestId: string;
  currentUserType: "CUSTOMER" | "ADMIN"; // כדי לצבוע נכון
  readOnly?: boolean; // אם true - רק תצוגה, בלי שליחה
};

export function PersonalRequestMessages({ requestId, currentUserType, readOnly }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // טעינה
  useEffect(() => {
    load();
    // רענון אוטומטי כל 15 שניות (למקרה של תגובות)
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  // גלילה לתחתית בכל הוספת הודעה
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function load() {
    try {
      const res = await fetch(`/api/personal-request/${requestId}/messages`);
      const data = await res.json();
      if (res.ok) {
        setMessages(data.messages || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/personal-request/${requestId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בשליחה");
      } else {
        setDraft("");
        await load();
      }
    } catch (e: any) {
      setError(e.message || "שגיאת רשת");
    } finally {
      setSending(false);
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="card p-0 overflow-hidden bg-white">
      {/* Header */}
      <div className="bg-brand-slatedark text-white px-4 py-2.5 font-bold text-sm">
        💬 שיחה
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="max-h-96 overflow-y-auto p-4 space-y-3 bg-zinc-50"
        style={{ minHeight: "200px" }}
      >
        {loading ? (
          <div className="text-center text-zinc-400 text-sm py-6">טוען הודעות...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm py-6">
            אין הודעות עדיין. {readOnly ? "" : "התחל שיחה!"}
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderType === currentUserType;
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                    isMe
                      ? "bg-brand-rust text-white rounded-bl-md"
                      : "bg-white border border-zinc-200 text-brand-slatedark rounded-br-md shadow-sm"
                  }`}
                >
                  <div
                    className={`text-xs font-medium mb-0.5 ${
                      isMe ? "text-white/80" : "text-zinc-500"
                    }`}
                  >
                    {isMe ? "אני" : msg.senderName}
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">{msg.message}</div>
                  <div
                    className={`text-[10px] mt-1 ${
                      isMe ? "text-white/70" : "text-zinc-400"
                    }`}
                  >
                    {formatTime(msg.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input area */}
      {!readOnly && (
        <div className="border-t border-zinc-200 p-3 bg-white">
          {error && (
            <div className="text-xs text-red-600 mb-2 text-center">{error}</div>
          )}
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="הקלד הודעה... (Enter לשליחה)"
              disabled={sending}
              rows={2}
              maxLength={2000}
              className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
            <button
              onClick={send}
              disabled={sending || !draft.trim()}
              className="px-4 py-2 bg-brand-rust text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 self-end"
            >
              {sending ? "..." : "שלח"}
            </button>
          </div>
          <div className="text-xs text-zinc-400 mt-1 text-left">
            {draft.length}/2000
          </div>
        </div>
      )}
    </div>
  );
}
