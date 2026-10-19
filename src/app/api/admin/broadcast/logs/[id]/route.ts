// GET /api/admin/broadcast/logs/[id] — הנמענים של שליחה אחת: מי קיבל, מי נכשל, ומי לא הגיע אליו התור

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;

  const log = await prisma.broadcastLog.findUnique({ where: { id }, select: { id: true, subject: true } });
  if (!log) return NextResponse.json({ error: "השליחה לא נמצאה" }, { status: 404 });

  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId: id },
    // נכשלו ראשונים — בשבילם נכנסים למסך
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      customerId: true,
      name: true,
      email: true,
      status: true,
      error: true,
      resendId: true,
      sentAt: true,
    },
  });

  return NextResponse.json({
    subject: log.subject,
    recipients: recipients.map((r) => ({ ...r, sentAt: r.sentAt?.toISOString() ?? null })),
  });
}
