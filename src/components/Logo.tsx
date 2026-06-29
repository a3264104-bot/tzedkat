export function Logo({ size = 120 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center select-none">
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden>
        {/* circle */}
        <path
          d="M100 22a78 78 0 1 0 0 156"
          stroke="#C0461E"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M100 178a78 78 0 0 0 0-156"
          stroke="#3F3F46"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
        />
        {/* upper hand (rust) */}
        <path
          d="M58 86c14-16 34-26 52-22 9 2 18 8 24 16-6 2-14 1-22-2-6-2-11-3-14 0 8 2 16 6 22 12-9 4-20 3-31-2-9-4-18-9-31-2z"
          fill="#C0461E"
        />
        {/* lower hand (slate) */}
        <path
          d="M142 114c-14 16-34 26-52 22-9-2-18-8-24-16 6-2 14-1 22 2 6 2 11 3 14 0-8-2-16-6-22-12 9-4 20-3 31 2 9 4 18 9 31 2z"
          fill="#3F3F46"
        />
      </svg>
      <div className="text-center mt-1">
        <div className="font-extrabold text-brand-rust leading-none" style={{ fontSize: size * 0.26 }}>
          צדקת רבותינו
        </div>
        <div className="font-bold text-brand-slate mt-1" style={{ fontSize: size * 0.1 }}>
          עופות בשר ודגים — לכבוד שבת ויום טוב
        </div>
      </div>
    </div>
  );
}
