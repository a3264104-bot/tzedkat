// §51: תכנון ההזמנה לספק.
//
// GET   /api/admin/supplier-plan?pricelistId=X
//       מחזיר את הטבלה המלאה: כמויות שהוזמנו + ההחלטות השמורות.
// PATCH /api/admin/supplier-plan
//       שומר החלטה בודדת { pricelistId, productId, pointId?, extraCartons?, unitsPerCarton? }
//
// המבנה זהה לקובץ האקסל בכוונה - המסך והקובץ מציגים את אותם מספרים,
// כדי שהמנהל לא ימלא פעמיים ולא יתבלבל בין שתי גרסאות.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export type PlanRow = {
  productId: string;
  productName: string;
  categoryName: string;
  sortKey: number;
  /** B - קרטונים שהוזמנו */
  cartons: number;
  /** C - יחידות שהוזמנו */
  units: number;
  /** D - בודדים בק"ג */
  singlesKg: number;
  /** E - קרטונים להשלמה (החלטת המנהל) */
  extraCartons: number;
  /** G - כמות בקרטון */
  unitsPerCarton: number | null;
  /** האם unitsPerCarton נגזר אוטומטית או הוזן ידנית */
  perCartonIsAuto: boolean;
};

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

// ─────────────────────────────────────────────────────────────
// איסוף הנתונים. משותף ל-API ולייצוא האקסל, כדי ששניהם יציגו
// בדיוק את אותם מספרים.
// ─────────────────────────────────────────────────────────────
export async function collectPlan(pricelistId: string, pointId: string | null) {
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true, name: true, deliveryDateText: true },
  });
  if (!pricelist) return { error: "מכירה לא נמצאה", points: [], rows: [] } as any;

  const productSelect = {
    id: true,
    name: true,
    unit: true,
    singlesMode: true,
    avgWeightPerUnit: true,
    packageWeight: true,
    sortOrder: true,
    category: { select: { name: true, sortOrder: true } },
  };

  const orders = await prisma.order.findMany({
    where: {
      pricelistId,
      status: { notIn: ["CANCELLED"] },
      ...(pointId ? { pointId } : {}),
    },
    include: {
      point: { select: { id: true, name: true, city: true } },
      items: { where: { isCancelled: false }, include: { product: { select: productSelect } } },
    },
  });

  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId, ...(pointId ? { pointId } : {}) },
    include: {
      point: { select: { id: true, name: true, city: true } },
      items: { include: { product: { select: productSelect } } },
    },
  });

  const plans = await prisma.supplierOrderPlan.findMany({
    where: { pricelistId, scope: pointId ?? "ALL" },
  });
  const planMap = new Map(plans.map((p) => [p.productId, p]));

  // רשימת הנקודות שיש בהן הזמנות - לבורר במסך
  const pointsMap = new Map<string, { id: string; name: string; city: string | null }>();
  for (const o of orders) if (o.point) pointsMap.set(o.point.id, o.point);
  for (const w of walkins) if (w.point) pointsMap.set(w.point.id, w.point);

  const rows = new Map<string, PlanRow>();

  // כמה נכנס בקרטון. לבודדים בק"ג זה משקל הקרטון. ליחידות מנסים
  // לגזור ממשקל הקרטון חלקי משקל האריזה - ואם לא ניתן, המנהל ימלא.
  function derivePerCarton(pr: any): number | null {
    const avgW = pr.avgWeightPerUnit != null ? Number(pr.avgWeightPerUnit) : null;
    if (pr.singlesMode === "UNITS") {
      const pkg = parseFloat(String(pr.packageWeight ?? "").replace(/[^\d.]/g, ""));
      if (avgW && pkg > 0) {
        // packageWeight לרוב בגרמים ("500 ג'"), avgWeightPerUnit בק"ג
        const pkgKg = pkg > 20 ? pkg / 1000 : pkg;
        return Math.round(avgW / pkgKg);
      }
      return null;
    }
    return avgW;
  }

  function rowFor(pr: any): PlanRow {
    let r = rows.get(pr.id);
    if (!r) {
      const auto = derivePerCarton(pr);
      const saved = planMap.get(pr.id);
      r = {
        productId: pr.id,
        productName: pr.name,
        categoryName: pr.category?.name ?? "",
        sortKey: (pr.category?.sortOrder ?? 999) * 1000 + (pr.sortOrder ?? 0),
        cartons: 0,
        units: 0,
        singlesKg: 0,
        extraCartons: saved ? Number(saved.extraCartons) : 0,
        unitsPerCarton:
          saved?.unitsPerCarton != null ? Number(saved.unitsPerCarton) : auto,
        perCartonIsAuto: saved?.unitsPerCarton == null,
      };
      rows.set(pr.id, r);
    }
    return r;
  }

  // סיווג הפריט. מוצר ארוז שנמכר ביחידות נספר כיחידות גם כשאינו
  // מסומן isSingle - אחרת הוא נספר כקרטון ומעוות את ההזמנה לספק.
  function classify(pr: any, unit: string | null, isSingle: boolean) {
    const u = (unit || pr.unit || "").trim();
    if (isSingle) return pr.singlesMode === "UNITS" ? "units" : "singlesKg";
    if (u && u !== "קרטון" && u !== 'ק"ג') return "units";
    return "cartons";
  }

  for (const o of orders) {
    for (const it of o.items) {
      if (!it.product) continue;
      const r = rowFor(it.product);
      const qty = Number(it.quantity);
      const kind = classify(it.product, it.unit, it.isSingle);
      if (kind === "cartons") r.cartons += qty;
      else if (kind === "units") r.units += qty;
      else r.singlesKg += qty;
    }
  }
  for (const w of walkins) {
    for (const it of w.items) {
      if (!it.product) continue;
      const r = rowFor(it.product);
      // במזדמנים נשמר משקל ולא כמות
      const kind = classify(it.product, it.product.unit, it.isSingle);
      if (kind === "units") r.units += Number(it.weight);
      else r.singlesKg += Number(it.weight);
    }
  }

  const list = Array.from(rows.values()).sort((a, b) => a.sortKey - b.sortKey);
  // עיגול ק"ג לשתי ספרות - נצבר מהרבה הזמנות ויוצר זנב עשרוני מיותר
  for (const r of list) {
    r.singlesKg = Math.round(r.singlesKg * 100) / 100;
  }

  return {
    pricelist,
    points: Array.from(pointsMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "he")
    ),
    rows: list,
  };
}
