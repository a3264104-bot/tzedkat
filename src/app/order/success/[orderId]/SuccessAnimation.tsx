"use client";

// אנימציית check ירוק גדול - נסגר אחרי 2 שניות
// מוצג פעם אחת כשעמוד ההצלחה נטען, לא ב-refresh (SessionStorage)

import { useEffect, useState } from "react";

export default function SuccessAnimation() {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // בודקים אם כבר הצגנו את האנימציה בsession הנוכחי
    // אחרת ב-refresh האנימציה תחזור וזה מעצבן
    const url = window.location.pathname;
    const key = `success_anim_${url}`;
    const already = sessionStorage.getItem(key);
    if (already) {
      setDone(true);
      return;
    }
    sessionStorage.setItem(key, "1");
    setShow(true);
    const t = setTimeout(() => {
      setShow(false);
      setTimeout(() => setDone(true), 400);
    }, 1800);
    return () => clearTimeout(t);
  }, []);

  if (done) return null;

  return (
    <>
      <style jsx global>{`
        @keyframes success-fade {
          0% {
            opacity: 0;
            transform: scale(0.6);
          }
          15% {
            opacity: 1;
            transform: scale(1.05);
          }
          25% {
            transform: scale(1);
          }
          80% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: scale(0.9);
          }
        }
        @keyframes success-check {
          0% {
            stroke-dashoffset: 100;
          }
          100% {
            stroke-dashoffset: 0;
          }
        }
        .success-overlay {
          animation: success-fade 2.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .success-check-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          animation: success-check 0.6s cubic-bezier(0.65, 0, 0.45, 1) 0.4s
            forwards;
        }
      `}</style>

      <div
        className={`fixed inset-0 z-40 pointer-events-none flex items-center justify-center bg-emerald-50/95 backdrop-blur-sm ${
          show ? "success-overlay" : "opacity-0"
        }`}
      >
        <div className="w-32 h-32 rounded-full bg-emerald-500 shadow-2xl flex items-center justify-center">
          <svg
            className="w-16 h-16"
            fill="none"
            viewBox="0 0 24 24"
            stroke="white"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path className="success-check-path" d="M5 12l5 5 9-11" />
          </svg>
        </div>
      </div>
    </>
  );
}
