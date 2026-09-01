import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();
  const data: any = {};
  for (const k of [
    "name",
    "categoryId",
    "cartonPrice",
    "allowSingles",
    "singleSurcharge",
    "singlesMode",
    "singleUnitPrice",
    "unit",
    "saleType",
    "priceType",
    "packageWeight",
    "avgWeightPerUnit",
    // §275: משקל יחידה בודדת
    "avgWeightPerPiece",
    "imageUrl",
    "kashrut",
    "kashrutId",
    "isFeatured",
    // §170: 🐛 הטופס שלח והשרת התעלם בשקט. המנהל סימן "מוצר
    // מועדף", לחץ שמירה, וכלום לא קרה - בלי שום שגיאה.
    //
    // ⚠️ זהו הדפוס שנתפס כבר חמש פעמים במערכת: רשימת שדות
    // מפורשת ששוכחים להוסיף אליה שדה חדש.
    "isFavorite",
    "highlightNote",
    "isFrozen",
    "limitedQty",
    "limitedQtyAmount",
    "allowPersonalOrder",
    "isActive",
    "sortOrder",
    // §24: תפריט טלפוני - בלי אלה הטופס שולח והשרת מתעלם בשקט
    "phoneEnabled",
    // §74: phoneKey **הוסר** מהרשימה בכוונה - הוא נגזר מ-phoneCode
    // למטה ואינו מתקבל מהקליינט. ראה ההסבר שם.
    // §69: כתיב פונטי להקראה. phoneCode מטופל בנפרד למטה כי הוא
    // דורש נירמול ובדיקת ייחודיות.
    "phoneName",
  ]) {
    if (k in b) data[k] = b[k];
  }

  // §342: 🔗 **לא-פעיל ⇒ מועדף, אוטומטית.**
  //
  // המצב מהשטח: 4 מוצרים סומנו "לא פעיל" ו-0 סומנו "מועדף",
  // כלומר התכונה של §119 (מחיר מותאם ועמלה) מעולם לא הופעלה —
  // והנציגים הוסיפו את אותם מוצרים 28 פעמים בלי מחיר מותאם.
  //
  // ⚠️ בפועל שני הסימונים משמשים לאותו דבר: "מוצר שהלקוחות לא
  // רואים והנציג מוכר לפי בקשה". הסנכרון כאן חוסך למנהל לזכור
  // לסמן שניים.
  //
  // ⚠️ **בכיוון אחד בלבד**: הפעלה מחדש אינה מבטלת את המועדף.
  // מוצר שהיה פרימיום ועכשיו נכנס למחירון עשוי עדיין להיות
  // כזה שהנציג מוכר במחיר מותאם — וזו החלטה של המנהל, לא של
  // המערכת.
  if (data.isActive === false) {
    data.isFavorite = true;
  }

  // §69: מק"ט טלפוני.
  //
  // מנורמל לספרות בלי אפסים מובילים, בדיוק כמו שה-IVR מנרמל את
  // ההקשה של הלקוח - אחרת "0101" במסך ו-"101" בטלפון לא היו נפגשים.
  //
  // הייחודיות נבדקת כאן ולא נשארת ל-DB: שגיאת unique של Postgres
  // מגיעה כ-P2002 גנרי, והמנהל היה רואה "שגיאה" בלי לדעת שהמספר
  // כבר תפוס ובאיזה מוצר.
  if ("phoneCode" in b) {
    const digits = String(b.phoneCode ?? "").replace(/\D/g, "");
    const code = digits ? String(parseInt(digits, 10)) : null;
    if (code && code !== "0") {
      const taken = await prisma.product.findFirst({
        where: { phoneCode: code, NOT: { id } },
        select: { name: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: `המק"ט ${code} כבר משויך למוצר "${taken.name}"` },
          { status: 409 }
        );
      }
      data.phoneCode = code;
    } else {
      data.phoneCode = null;
    }

    // §74: סדר ההקראה נגזר מהמק"ט.
    //
    // 🐛 הבעיה שנסגרת: היו בטופס שני שדות מספריים - "מקש בתפריט
    // הטלפוני" ו"מק"ט טלפוני למודעה". המנהל לא ידע איזה מהם מפרסמים,
    // ומילוי שונה בשניהם יצר מוצר שסדר ההקראה שלו לא תואם למספר
    // שהלקוח מחזיק ביד מהמודעה.
    //
    // הם מעולם לא היו שני דברים באמת: phoneKey קובע רק את *סדר*
    // ההקראה - התפריט אומר "הקש 1, 2, 3" לפי המיקום ברשימה, לא לפי
    // הערך שלו. לכן גזירה מהמק"ט נותנת בדיוק את מה שרצוי: המוצרים
    // מוקראים בסדר המק"טים שבמודעה.
    const n = code ? parseInt(code, 10) : NaN;
    data.phoneKey = Number.isSafeInteger(n) ? n : null;
  }

  // §69: שדה ריק מהטופס נשמר כ-null ולא כמחרוזת ריקה, אחרת
  // `phoneName || name` ב-IVR היה עדיין נופל לשם הרגיל - אבל
  // הערך במסד היה מבלבל בבדיקות.
  if ("phoneName" in data) {
    data.phoneName = String(data.phoneName ?? "").trim() || null;
  }
  // הגנה על מחיקת הזמנות אישיות שמפנות למוצר
  const product = await prisma.product.update({ where: { id }, data });
  return NextResponse.json(product);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const usedOrders = await prisma.orderItem.count({ where: { productId: id } });
  const usedPersonal = await prisma.personalRequestItem.count({ where: { productId: id } });
  if (usedOrders > 0 || usedPersonal > 0) {
    // לא מוחקים מוצר שמופיע בהזמנות — רק מסתירים
    // §342: השבתה = מועדף — אותו כלל של העדכון למעלה.
    await prisma.product.update({
      where: { id },
      data: { isActive: false, isFavorite: true },
    });
    return NextResponse.json({ ok: true, hidden: true });
  }
  await prisma.pricelistProduct.deleteMany({ where: { productId: id } });
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
