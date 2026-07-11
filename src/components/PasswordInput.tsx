"use client";

import { useState } from "react";

// שדה סיסמה עם כפתור עין להצגה/הסתרה (סעיף 4)
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = "current-password",
  className = "input",
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`${className} pl-11`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-sm px-1.5 py-1"
        aria-label={show ? "הסתר סיסמה" : "הצג סיסמה"}
        tabIndex={-1}
      >
        {show ? "🙈" : "👁️"}
      </button>
    </div>
  );
}
