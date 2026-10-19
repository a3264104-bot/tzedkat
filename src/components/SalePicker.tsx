"use client";
// בורר מכירה למסכי מנהל שעובדים על מכירה אחת — מחליף את ?pricelistId בכתובת
import { usePathname, useRouter } from "next/navigation";
import { PRICELIST_STATUS } from "@/lib/pricing";
import type { SaleOption } from "@/lib/admin-sales";

export function SalePicker({ options, value }: { options: SaleOption[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      className="input max-w-[280px]"
      value={value}
      onChange={(e) => router.push(`${pathname}?pricelistId=${encodeURIComponent(e.target.value)}`)}
      aria-label="בחירת מכירה"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} · {PRICELIST_STATUS[o.status] ?? o.status}
        </option>
      ))}
    </select>
  );
}
