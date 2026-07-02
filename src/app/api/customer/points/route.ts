import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// endpoint ציבורי - לא מצריך auth - נקודות חלוקה נדרשות בשלב ההרשמה לפני שהלקוח מחובר
export async function GET() {
  const points = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, city: true },
  });
  return NextResponse.json(points);
}
