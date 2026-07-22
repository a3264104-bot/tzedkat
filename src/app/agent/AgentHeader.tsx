"use client";

// §20: כפתור יציאה של הנציג - חייב להיות client component
import { signOut } from "next-auth/react";

export function signOutBtn() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="text-xs text-brand-slate hover:text-brand-rust flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white/60 backdrop-blur-sm"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
      יציאה
    </button>
  );
}
