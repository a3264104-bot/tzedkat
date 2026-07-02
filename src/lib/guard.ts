import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function requireAdmin() {
  const session = await auth();
  // קריטי: לא מספיק לבדוק session?.user - חייבים לוודא role===ADMIN,
  // אחרת לקוח מחובר רגיל (עם session תקין משלו) היה עובר את הבדיקה הזו
  // ומקבל גישה ל-API-ים של הניהול.
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return { ok: false as const, res: NextResponse.json({ error: "לא מורשה" }, { status: 401 }) };
  }
  return { ok: true as const, session };
}

// guard מקביל לאזור הלקוח - כל role מחובר (CUSTOMER/AGENT/ADMIN) עובר
export async function requireCustomer() {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, res: NextResponse.json({ error: "יש להתחבר" }, { status: 401 }) };
  }
  return { ok: true as const, session };
}
