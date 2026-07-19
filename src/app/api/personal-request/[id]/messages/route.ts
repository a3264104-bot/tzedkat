import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// §9: הודעות בבקשה אישית
// GET /api/personal-request/[id]/messages - טעינת כל ההודעות (וסימון כנקראו)
// POST /api/personal-request/[id]/messages - שליחת הודעה חדשה (לקוח או מנהל)

async function checkAccess(requestId: string) {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, res: NextResponse.json({ error: "יש להתחבר" }, { status: 401 }) };
  }
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;

  const request = await prisma.personalRequest.findUnique({
    where: { id: requestId },
    select: { id: true, customerId: true },
  });
  if (!request) {
    return { ok: false as const, res: NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 }) };
  }
  const isAdmin = role === "ADMIN" || role === "AGENT";
  const isOwner = request.customerId === userId;
  if (!isAdmin && !isOwner) {
    return { ok: false as const, res: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  return {
    ok: true as const,
    userId,
    role,
    isAdmin,
    isOwner,
    request,
    session,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await checkAccess(id);
  if (!g.ok) return g.res;

  const messages = await prisma.personalRequestMessage.findMany({
    where: { requestId: id },
    orderBy: { createdAt: "asc" },
  });

  // סימון כנקראו — לפי סוג המשתמש
  const updateData: any = {};
  if (g.isAdmin) updateData.hasUnreadForAdmin = false;
  if (g.isOwner) updateData.hasUnreadForCustomer = false;
  if (Object.keys(updateData).length > 0) {
    await prisma.personalRequest.update({
      where: { id },
      data: updateData,
    }).catch(() => null);
  }

  return NextResponse.json({ messages });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await checkAccess(id);
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();

  if (!message) {
    return NextResponse.json({ error: "יש להזין הודעה" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "הודעה ארוכה מדי (מקסימום 2000 תווים)" }, { status: 400 });
  }

  const senderType = g.isAdmin ? "ADMIN" : "CUSTOMER";
  const senderName = g.session?.user?.name || (g.isAdmin ? "מנהל" : "לקוח");

  const created = await prisma.personalRequestMessage.create({
    data: {
      requestId: id,
      senderType,
      senderName,
      message,
    },
  });

  // סימון unread לצד השני
  const updateData: any = { updatedAt: new Date() };
  if (senderType === "CUSTOMER") {
    updateData.hasUnreadForAdmin = true;
    updateData.hasUnreadForCustomer = false;
  } else {
    updateData.hasUnreadForCustomer = true;
    updateData.hasUnreadForAdmin = false;
  }
  await prisma.personalRequest.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ ok: true, message: created });
}
