// ═══════════════════════════════════════════════════════════════
// §133: הערת הלקוח לנציג, ותשובת הנציג
// ═══════════════════════════════════════════════════════════════
// POST /api/orders/[id]/note   { note }   ← הלקוח כותב
// PUT  /api/orders/[id]/note   { reply }  ← הנציג עונה
//
// התרחיש: הלקוח רוצה משהו שאינו בתפריט - מוצר מועדף, חיתוך
// מיוחד, בקשה לגבי החלוקה. עד היום זה עבר בטלפון ונשאר בעל פה.
//
// ⚠️ **לא צ'אט.** הערה אחת ותשובה אחת. התכתבות מלאה הייתה הופכת
// את הנציג למוקד שירות בזמן שהוא מחלק סחורה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireAgent } from "@/lib/agent-guard";
import { sendAgentReplyEmail } from "@/lib/email";

// ═══════════════════════════════════════════════════════════════
// POST - הלקוח כותב הערה
// ═══════════════════════════════════════════════════════════════
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }
  const userId = (session.user as any).id as string;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const note = String(b.note ?? "").trim();

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      customerId: true,
      status: true,
      orderNumber: true,
      pointId: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // ⚠️ הלקוח כותב **רק על ההזמנה שלו**. בלי הבדיקה הזו כל מחובר
  // היה יכול לכתוב על כל הזמנה במערכת.
  if (order.customerId !== userId) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  if (order.status === "CANCELLED" || order.status === "COMPLETED") {
    return NextResponse.json(
      { error: "לא ניתן להוסיף הערה להזמנה שהסתיימה" },
      { status: 400 }
    );
  }

  if (note.length > 500) {
    return NextResponse.json(
      { error: "ההערה ארוכה מדי (מקסימום 500 תווים)" },
      { status: 400 }
    );
  }

  // ⚠️ הערה ריקה מוחקת את הקיימת - ומוחקת גם את התשובה.
  // תשובה שנשארת בלי השאלה שלה מבלבלת יותר משהיא עוזרת.
  await prisma.order.update({
    where: { id },
    data: note
      ? { customerNote: note, customerNoteAt: new Date() }
      : {
          customerNote: null,
          customerNoteAt: null,
          agentReply: null,
          agentReplyAt: null,
          agentReplyById: null,
          replySeenAt: null,
        },
  });

  return NextResponse.json({ ok: true, note: note || null });
}

// ═══════════════════════════════════════════════════════════════
// PUT - הנציג עונה
// ═══════════════════════════════════════════════════════════════
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const reply = String(b.reply ?? "").trim();

  if (!reply) {
    return NextResponse.json({ error: "יש לכתוב תשובה" }, { status: 400 });
  }
  if (reply.length > 500) {
    return NextResponse.json(
      { error: "התשובה ארוכה מדי (מקסימום 500 תווים)" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      customerName: true,
      customerNote: true,
      customer: { select: { email: true, name: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות. מערך ריק אצל נציג = אין נקודות, לא "בלי הגבלה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  await prisma.order.update({
    where: { id },
    data: {
      agentReply: reply,
      agentReplyAt: new Date(),
      agentReplyById: g.agent.id,
      // ⚠️ איפוס replySeenAt: תשובה חדשה היא "לא נקראה" מחדש,
      // גם אם הלקוח ראה תשובה קודמת.
      replySeenAt: null,
    },
  });

  // מייל התראה. לא חוסם - כשל שליחה לא יבטל תשובה שנרשמה.
  if (order.customer?.email) {
    sendAgentReplyEmail({
      customerName: order.customer.name,
      email: order.customer.email,
      orderNumber: order.orderNumber,
      note: order.customerNote ?? "",
      reply,
      agentName: g.agent.name,
    }).catch((e) => console.error("[note-reply] email failed:", e));
  }

  console.log(
    `[note-reply] order #${order.orderNumber} answered by agent=${g.agent.id}`
  );

  return NextResponse.json({ ok: true, reply });
}

// ═══════════════════════════════════════════════════════════════
// PATCH - הלקוח סימן שראה את התשובה
// ═══════════════════════════════════════════════════════════════
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }
  const userId = (session.user as any).id as string;
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { customerId: true },
  });
  if (!order || order.customerId !== userId) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  await prisma.order.update({
    where: { id },
    data: { replySeenAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
