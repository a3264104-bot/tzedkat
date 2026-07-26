// §20: שליחת מייל סיכום למזדמן
// POST /api/agent/walkin/[id]/send-summary
// Body: { email?: string }
//   - אם יש email במזדמן ולא הועבר → משתמש בשמור
//   - אם הועבר email → מעדכן את המזדמן וגם שולח
//   - אם אין email בשום מקום → שגיאה

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "צדקת רבותינו <noreply@tzidkat.com>";

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "מזומן",
  CARD_TERMINAL: "אשראי במסוף",
  TRANSFER: "העברה בנקאית",
  ONLINE: "אשראי אונליין",
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const providedEmail = body.email ? String(body.email).trim() : null;

  const walkin = await prisma.walkinOrder.findUnique({
    where: { id },
    include: {
      items: true,
      pricelist: { select: { name: true, deliveryDateText: true } },
    },
  });
  if (!walkin) {
    return NextResponse.json({ error: "מזדמן לא נמצא" }, { status: 404 });
  }
  if (walkin.agentId !== g.agent.id && !g.isAdmin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  // קבע איזה מייל לשלוח - חדש או שמור
  const targetEmail = providedEmail || walkin.customerEmail;
  if (!targetEmail) {
    return NextResponse.json({ error: "יש להזין כתובת מייל" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
  }

  if (!RESEND_API_KEY) {
    return NextResponse.json(
      { error: "שירות המייל לא מוגדר. פנה למנהל." },
      { status: 500 }
    );
  }

  // בנה HTML מעוצב
  const html = buildEmailHtml(walkin);
  const subject = `סיכום רכישה #${walkin.walkinNumber} - צדקת רבותינו`;

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: [targetEmail],
      subject,
      html,
    });
  } catch (e: any) {
    console.error("[send-summary] Resend error:", e);
    return NextResponse.json(
      { error: `שגיאה בשליחת המייל: ${e?.message || "לא ידוע"}` },
      { status: 500 }
    );
  }

  // עדכון המזדמן: שמור את המייל אם היה חדש + סמן שנשלח
  const updateData: any = {
    summarySentAt: new Date(),
    summarySentVia: "EMAIL",
  };
  if (providedEmail && providedEmail !== walkin.customerEmail) {
    updateData.customerEmail = providedEmail;
  }
  await prisma.walkinOrder.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ ok: true, sentTo: targetEmail });
}

function buildEmailHtml(walkin: any): string {
  const rows = walkin.items
    .map((it: any) => {
      const label = it.isSingle ? "בודדים" : "";
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eee;">
            ${it.productName}${label ? ` <span style="font-size:11px;color:#f59e0b;">(${label})</span>` : ""}
          </td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
            ${Number(it.weight).toFixed(2)} ק"ג
          </td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
            ₪${Number(it.unitPrice).toFixed(2)}
          </td>
          <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;">
            ₪${Number(it.totalPrice).toFixed(2)}
          </td>
        </tr>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <title>סיכום רכישה</title>
</head>
<body style="margin:0;padding:0;background:#fef3c7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">

          <!-- Header -->
          <tr>
            <td style="background:#FFE000;padding:24px;text-align:center;border-bottom:4px solid #C0461E;">
              <h1 style="margin:0;color:#C0461E;font-size:24px;">צדקת רבותינו</h1>
              <p style="margin:6px 0 0;color:#3f3f46;font-size:14px;">עופות בשר ודגים</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:24px;">
              <h2 style="margin:0 0 8px;color:#3f3f46;font-size:18px;">
                שלום ${escapeHtml(walkin.customerName)}! 🐔
              </h2>
              <p style="margin:0;color:#52525b;font-size:14px;">
                תודה שרכשת אצלנו בחלוקה של <strong>${escapeHtml(walkin.pricelist.name)}</strong>.
              </p>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding:0 24px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr style="background:#f4f4f5;">
                    <th style="padding:10px;text-align:right;color:#71717a;font-weight:bold;">מוצר</th>
                    <th style="padding:10px;text-align:center;color:#71717a;font-weight:bold;">משקל</th>
                    <th style="padding:10px;text-align:center;color:#71717a;font-weight:bold;">מחיר לק"ג</th>
                    <th style="padding:10px;text-align:center;color:#71717a;font-weight:bold;">סה"כ</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
                <tfoot>
                  <tr style="background:#fef3c7;">
                    <td colspan="3" style="padding:12px;text-align:left;font-weight:bold;color:#3f3f46;">סה"כ לתשלום:</td>
                    <td style="padding:12px;text-align:center;font-weight:bold;font-size:16px;color:#C0461E;">
                      ₪${Number(walkin.totalAmount).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Payment -->
          <tr>
            <td style="padding:0 24px 16px;">
              <div style="background:#f4f4f5;border-radius:8px;padding:12px;font-size:13px;color:#3f3f46;">
                <strong>אמצעי תשלום:</strong> ${PAYMENT_LABELS[walkin.paymentMethod] || walkin.paymentMethod}
                ${walkin.paymentReceived ? "" : ' <span style="color:#d97706;font-weight:bold;">(ממתין לאישור)</span>'}
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 24px 24px;text-align:center;">
              <p style="margin:0 0 12px;color:#52525b;font-size:14px;">
                בפעם הבאה מוזמן להזמין מראש דרך האתר:
              </p>
              <a href="https://tzidkat.com" style="display:inline-block;background:#C0461E;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">
                לאתר ההזמנות ←
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fef3c7;padding:16px 24px;text-align:center;font-size:12px;color:#71717a;">
              צדקת רבותינו · עופות בשר ודגים<br>
              המכירה המוזלת לכבוד שבת ויום טוב
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
