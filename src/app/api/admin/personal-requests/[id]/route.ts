import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// §9: עדכון בקשה אישית על ידי מנהל
// PATCH /api/admin/personal-requests/[id]
// Body: { status?, notes? }

const ALLOWED_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "CONTACTED",
  "WAITING",
  "DONE",
  "CANCELLED",
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: any = {};

  if (typeof body.status === "string") {
    if (!ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
    }
    data.status = body.status;
  }

  if ("notes" in body) {
    const n = String(body.notes || "").trim();
    data.notes = n.length > 0 ? n : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.personalRequest.update({
    where: { id },
    data,
  });

  return NextResponse.json({ ok: true, id: updated.id });
}

// DELETE - מחיקת בקשה (רק אם בוטלה)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const request = await prisma.personalRequest.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!request) {
    return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  }
  if (request.status !== "CANCELLED") {
    return NextResponse.json(
      { error: "ניתן למחוק רק בקשות שבוטלו" },
      { status: 400 }
    );
  }

  await prisma.personalRequest.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
