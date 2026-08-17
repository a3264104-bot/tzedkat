// §51: תכנון ההזמנה לספק.
//
// GET   /api/admin/supplier-plan?pricelistId=X
//       מחזיר את הטבלה המלאה: כמויות שהוזמנו + ההחלטות השמורות.
// PATCH /api/admin/supplier-plan
//       שומר החלטה בודדת { pricelistId, productId, pointId?, extraCartons?, unitsPerCarton? }
//
// המבנה זהה לקובץ האקסל בכוונה - המסך והקובץ מציגים את אותם מספרים,
// כדי שהמנהל לא ימלא פעמיים ולא יתבלבל בין שתי גרסאות.
//
// §63: collectPlan הועברה ל-src/lib/supplier-plan.ts. קובץ route.ts
// אינו רשאי לייצא שום דבר מלבד פונקציות HTTP, וה-build נכשל על כך.
// הלוגיקה עצמה לא השתנתה - רק מיקומה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { collectPlan } from "@/lib/supplier-plan";

// ייצוא-מחדש של הטיפוס בלבד, לתאימות עם קוד שמייבא אותו מכאן.
// ייצוא טיפוס נמחק בקומפילציה ולכן אינו מפר את מגבלת ה-route.
export type { PlanRow } from "@/lib/supplier-plan";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistId = searchParams.get("pricelistId");
  const pointId = searchParams.get("pointId") || null;
  if (!pricelistId) {
    return NextResponse.json({ error: "חסרה מכירה" }, { status: 400 });
  }

  const data = await collectPlan(pricelistId, pointId);
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b.pricelistId || "");
  const productId = String(b.productId || "");
  const pointId = b.pointId ? String(b.pointId) : null;

  if (!pricelistId || !productId) {
    return NextResponse.json({ error: "חסרים נתונים" }, { status: 400 });
  }

  const data: any = { updatedBy: g.session?.user?.email ?? null };
  if ("extraCartons" in b) {
    const n = Number(b.extraCartons);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "כמות לא תקינה" }, { status: 400 });
    }
    data.extraCartons = n;
  }
  if ("unitsPerCarton" in b) {
    const raw = b.unitsPerCarton;
    if (raw === null || raw === "") {
      data.unitsPerCarton = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "כמות בקרטון לא תקינה" }, { status: 400 });
      }
      data.unitsPerCarton = n;
    }
  }

  // scope הוא מזהה הנקודה או "ALL" לתכנון הכולל. ראה הסבר בסכמה -
  // שדה NULL אינו נאכף ב-@@unique של Postgres, ולכן תכנון כולל היה
  // יוצר שורה חדשה בכל שמירה.
  const scope = pointId ?? "ALL";

  await prisma.supplierOrderPlan.upsert({
    where: {
      pricelistId_productId_scope: { pricelistId, productId, scope },
    },
    create: {
      pricelistId,
      productId,
      scope,
      pointId,
      extraCartons: data.extraCartons ?? 0,
      unitsPerCarton: data.unitsPerCarton ?? null,
      updatedBy: data.updatedBy,
    },
    update: data,
  });

  return NextResponse.json({ ok: true });
}
