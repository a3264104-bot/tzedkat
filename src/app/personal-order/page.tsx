import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PersonalOrderClient } from "./PersonalOrderClient";
import { redirect } from "next/navigation";
// §248: בדיקת תוקף כרטיס (§202)
import { canChargeCard } from "@/lib/card-expiry-lib";

export const dynamic = "force-dynamic";

export default async function PersonalOrderPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/personal-order");
  }

  const customerId = (session.user as any).id as string;

  // §9: טעינת מוצרים מהטבלה הרגילה - מקור אמת אחד
  // סינון: isActive + allowPersonalOrder
  const [products, customer, existingRequests] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, allowPersonalOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        category: { select: { name: true } },
        // §73: תמונת הכשרות - כמו בהזמנה הרגילה
        kashrutRef: { select: { name: true, imageUrl: true } },
      },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      // §248: שדות התשלום - לחסימת בקשה בלי אמצעי גבייה.
      select: {
        name: true,
        phone: true,
        email: true,
        paymentToken: true,
        paymentPreference: true,
        cardExpiry: true,
      },
    }),
    prisma.personalRequest.findMany({
      where: { customerId, status: { notIn: ["CANCELLED", "DONE"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        items: { select: { productName: true, quantity: true, isSingle: true } },
      },
    }),
  ]);

  return (
    <PersonalOrderClient
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: p.imageUrl,
        category: p.category?.name ?? null,
        // §73: שם הכשרות מהרפרנס (עם נפילה לטקסט החופשי) + תמונה,
        // בדיוק כמו שההזמנה הרגילה מציגה
        kashrut: p.kashrutRef?.name ?? p.kashrut,
        kashrutImageUrl: p.kashrutRef?.imageUrl ?? null,
        // §73: לבורר בודדים/קרטונים
        allowSingles: p.allowSingles,
        singlesMode: p.singlesMode,
        unit: p.unit,
      }))}
      // §248: 🚫 בקשה אישית דורשת אמצעי תשלום.
      //
      // 🐛 הזמנה רגילה חוסמת לקוח בלי כרטיס (§61/§202), ובקשה
      // אישית לא בדקה כלום. המנהל היה מברר מול הספק ומזמין -
      // ואז מגלה שאין ממי לגבות.
      //
      // ⚠️ החישוב **בשרת** ולא במסך: כללי התוקף (§202) יושבים
      // בספרייה, ושכפול שלהם בקליינט היה מתפצל.
      customer={
        customer
          ? {
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              canPay:
                customer.paymentPreference === "CASH" ||
                (!!customer.paymentToken &&
                  canChargeCard(customer.cardExpiry)),
              // ⚠️ מבדיל בין "אין כרטיס" ל"פג תוקף": לקוח שיש לו
              // כרטיס ומקבל "אין לך כרטיס" חושב שהמערכת טועה.
              cardExpired:
                !!customer.paymentToken &&
                !canChargeCard(customer.cardExpiry),
            }
          : null
      }
      existingRequests={existingRequests.map((r) => ({
        id: r.id,
        requestNumber: r.requestNumber,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        hasUnreadForCustomer: r.hasUnreadForCustomer,
        items: r.items,
      }))}
    />
  );
}
