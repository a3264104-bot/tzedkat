"use client";

import { useEffect, useState } from "react";

// Countdown Timer מעודן - מציג זמן שנשאר עד תאריך יעד
// עיצוב מקצועי - 4 ריבועים עם ימים/שעות/דקות/שניות

type TimeLeft = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
};

function calculate(targetDate: string): TimeLeft {
  const now = Date.now();
  const target = new Date(targetDate).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return { days, hours, minutes, seconds, expired: false };
}

export function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calculate(targetDate));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(calculate(targetDate));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (timeLeft.expired) return null;

  // אם נשארו יותר מיום — לא מציגים שניות (רגוע יותר)
  const showSeconds = timeLeft.days === 0;
  // דחיפות: פחות מ-24 שעות = אדום, אחרת = ניטרלי
  const urgent = timeLeft.days === 0;

  return (
    <div className={`px-6 py-4 border-b border-zinc-100 ${urgent ? "bg-red-50/50" : "bg-amber-50/50"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-600">
          {urgent ? "נסגר בקרוב!" : "נותרו להזמנה"}
        </div>
        <div className="flex items-center gap-1.5" dir="ltr">
          {timeLeft.days > 0 && (
            <TimeBlock value={timeLeft.days} label="ימים" urgent={urgent} />
          )}
          <TimeBlock value={timeLeft.hours} label="שעות" urgent={urgent} />
          <TimeBlock value={timeLeft.minutes} label="דקות" urgent={urgent} />
          {showSeconds && (
            <TimeBlock value={timeLeft.seconds} label="שניות" urgent={urgent} />
          )}
        </div>
      </div>
    </div>
  );
}

function TimeBlock({
  value,
  label,
  urgent,
}: {
  value: number;
  label: string;
  urgent: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`min-w-[36px] px-1.5 py-0.5 rounded-md text-center font-bold text-sm tabular-nums ${
          urgent
            ? "bg-brand-rust text-white"
            : "bg-white border border-zinc-200 text-brand-slatedark"
        }`}
      >
        {String(value).padStart(2, "0")}
      </div>
      <span className="text-[10px] text-zinc-500 mt-0.5" dir="rtl">
        {label}
      </span>
    </div>
  );
}
