// §20: המנהל מתקן משקל סופי (actualWeight) בלי לגעת ב-agentEnteredWeight
// PATCH /api/admin/weight-review-item/[id]

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// Body: {
//   actualWeight?: number,  // המנהל מתקן - זה מה שהלקוח משלם
//   weightParts?: number[], // §349: פירוט לפי קרטון
//   agentNote?: string,     // הערה
//   isCancelled?: boolean,  // ביטול (המנהל יכול גם)
// }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const item = await prisma.orderItem.findUnique({
    where: { id },
    select: {
      id: true,
      unitPrice: true,
      // §349: המחיר שהנציג קבע — גובר על המחירון
      agentSetPrice: true,
      order: {
        select: {
          id: true,
          pricelistId: true,
          status: true,
        },
      },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "פריט לא נמצא" }, { status: 404 });
  }

  const data: any = {};

  // עדכון משקל סופי - זה השדה שהמנהל מתקן
  if ("actualWeight" in body) {
    const w = Number(body.actualWeight);
    if (body.actualWeight === null || body.actualWeight === "") {
      data.actualWeight = null;
      data.finalWeight = null;
      data.finalPrice = null;
      // §349: מחיקת משקל מנקה גם את הפירוט
      data.weightParts = null;
    } else {
      if (isNaN(w) || w < 0) {
        return NextResponse.json({ error: "משקל לא תקין" }, { status: 400 });
      }
      data.actualWeight = w;
      data.finalWeight = w;

      // §349: 🐛 **finalPrice התעלם מהמחיר המותאם.**
      //
      // `w * unitPrice` — המחירון בלבד. מנהל שתיקן משקל במוצר
      // מועדף עם מחיר מותאם (§119) דרס את המחיר שהנציג קבע,
      // והלקוח חויב לפי המחירון.
      //
      // ⚠️ אותה נוסחה של agent-order-item (§339): agentSetPrice
      // גובר על unitPrice.
      const effective =
        item.agentSetPrice != null
          ? Number(item.agentSetPrice)
          : Number(item.unitPrice);
      data.finalPrice = Math.round(w * effective * 100) / 100;

      // §349: 📦 פירוט לפי קרטון — נשמר בנפרד מהסכום.
      //
      // ⚠️ הסכום מאומת מול המערך: [5, 1] עם סכום 7 הוא באג
      // בקליינט, ושמירת שניהם הייתה יוצרת סתירה.
      //
      // ⚠️ בלי מערך — מנקים: משקל שהוזן במשבצת אחת לא צריך
      // פירוט, ופירוט ישן היה מבלבל.
      if (Array.isArray(body.weightParts)) {
        const parts = body.weightParts.map((x: unknown) => Number(x) || 0);
        const partsSum =
          Math.round(parts.reduce((a: number, b: number) => a + b, 0) * 100) /
          100;
        if (Math.abs(partsSum - w) > 0.01) {
          return NextResponse.json(
            { error: `פירוט המשקל (${partsSum}) אינו תואם לסכום (${w})` },
            { status: 400 }
          );
        }
        data.weightParts = parts;
      } else {
        data.weightParts = null;
      }
    }
  }

  if ("agentNote" in body) {
    data.agentNote = body.agentNote ? String(body.agentNote).trim() : null;
  }

  if ("isCancelled" in body) {
    data.isCancelled = !!body.isCancelled;
    if (data.isCancelled) {
      data.finalPrice = 0;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.orderItem.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    ok: true,
    item: {
      id: updated.id,
      // §304: != null — משקל 0 חוזר כ-0, לא כ-null
      actualWeight:
        updated.actualWeight != null ? Number(updated.actualWeight) : null,
      finalWeight:
        updated.finalWeight != null ? Number(updated.finalWeight) : null,
      finalPrice:
        updated.finalPrice != null ? Number(updated.finalPrice) : null,
      // §349: הפירוט חוזר — לשחזור המשבצות
      weightParts: (updated as any).weightParts ?? null,
      agentNote: updated.agentNote,
      isCancelled: updated.isCancelled,
    },
  });
}
