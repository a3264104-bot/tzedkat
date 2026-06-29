"use client";

export async function api(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "שגיאה");
  }
  return res.json();
}

export function download(url: string) {
  window.open(url, "_blank");
}
