"use client";

import { signOut } from "next-auth/react";

export function LogoutButton({ className }: { className?: string }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className={className || "text-sm text-brand-slate/70 underline hover:text-brand-rust"}
    >
      התנתק
    </button>
  );
}
