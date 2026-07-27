// חיפוש לקוח לפי טלפון - למסך הנציג
// GET /api/agent/customer-search?phone=X

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user || (role !== "AGENT" && role !== "ADMIN")) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const phoneRaw = searchParams.get("phone") || "";
  if (!phoneRaw.trim()) {
    return NextResponse.json({ found: false });
  }

  // נירמול טלפון - זהה לאלגוריתם בauth.ts + register
  const digits = phoneRaw.replace(/\D/g, "");
  const localPhone = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  const candidates = Array.from(new Set([phoneRaw.trim(), digits, localPhone])).filter(
    (p) => p.length > 0
  );

  const customer = await prisma.customer.findFirst({
    where: {
      OR: candidates.map((p) => ({ phone: p })),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActivated: true,
      cardLast4: true,
      paymentToken: true,
      defaultPoint: { select: { id: true, name: true, city: true } },
      _count: { select: { orders: true } },
    },
  });

  if (!customer) {
    return NextResponse.json({ found: false });
  }

  // אם המשתמש קיים אבל הוא לא לקוח רגיל (מנהל/נציג) - נחזיר הודעה מיוחדת
  if (customer.role !== "CUSTOMER") {
    return NextResponse.json({
      found: false,
      isSystemUser: true,
      systemRole: customer.role, // "AGENT" או "ADMIN"
      customerName: customer.name,
    });
  }

  return NextResponse.json({
    found: true,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      isActivated: customer.isActivated,
      hasCard: !!customer.paymentToken,
      cardLast4: customer.cardLast4,
      pointName: customer.defaultPoint?.name || null,
      orderCount: customer._count.orders,
    },
  });
}
