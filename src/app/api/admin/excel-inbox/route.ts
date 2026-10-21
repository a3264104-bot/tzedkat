// §inbound: יומן המיילים שהגיעו לכתובת הקליטה — מה התקבל ומה נעשה איתו
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const rows = await prisma.adminAuditLog.findMany({
    where: { action: "EXCEL_EMAIL_IN" },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, createdAt: true, actorName: true, targetName: true, meta: true, actorRole: true },
  });
  return NextResponse.json({
    // כתובת הקליטה (ריק = עוד לא הוגדרה — הקבצים חוזרים למייל המנהל)
    address: (process.env.INBOUND_EXCEL_ADDRESS || "").trim() || null,
    rows: rows.map((r) => {
      let meta: any = {};
      try {
        meta = r.meta ? JSON.parse(r.meta) : {};
      } catch {}
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        who: r.actorRole === "CUSTOMER" ? r.actorName : meta.from ?? r.actorName,
        from: meta.from ?? null,
        subject: r.targetName,
        result: String(meta.result ?? ""),
        orderNumber: meta.orderNumber ?? null,
        error: meta.error ?? null,
        issues: meta.issues ?? null,
      };
    }),
  });
}
