// ═══════════════════════════════════════════════════════════════
// §inbound: קובץ אקסל שחזר במייל → הזמנה, אוטומטית
// ═══════════════════════════════════════════════════════════════
// POST /api/inbound/email   (גוף: המייל הגולמי, message/rfc822)
//
// מי קורא: Cloudflare Email Worker שמקבל את המיילים לכתובת הקליטה
// (INBOUND_EXCEL_ADDRESS, למשל orders@tzidkat.com). ה-Worker מעביר
// עותק של כל מייל ל-Gmail של המנהל, ושולח לכאן את המייל המלא עם
// הסוד המשותף בכותרת x-inbound-secret.
//
// הזרימה:
//   1. מזהים את הלקוח — לפי החתימה בקובץ (C:<id> בשורה 1) **וגם** לפי
//      כתובת השולח. שתיהן חייבות להתאים: קובץ שהועבר לאדם אחר לא
//      יוצר הזמנה על הכרטיס של מי שקיבל אותו במקור.
//   2. מפענחים את הקובץ (אותו פענוח כמו במסך המנהל).
//   3. יוצרים הזמנה (createExcelOrder — אותן חסימות: כרטיס תקין או
//      מזומן, מכירה פעילה, לפני שעת הסגירה).
//   4. עונים ללקוח: אישור עם פירוט, או הסבר מה לתקן — תמיד עם מייל
//      המנהל לשאלות.
//
// ⚠️ כל מייל נרשם ביומן (EXCEL_EMAIL_IN) — גם כשלא נוצרה הזמנה — כדי
// שהמנהל יראה במסך "הזמנה דרך אקסל" מה הגיע ומה קרה איתו.

import { NextResponse } from "next/server";
import crypto from "crypto";
import PostalMime from "postal-mime";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseOrderExcel } from "@/lib/excel-order-lib";
import { createExcelOrder } from "@/lib/excel-order-create";
import {
  sendExcelOrderConfirmation,
  sendExcelOrderProblem,
  type ExcelProblemKind,
} from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const OWN_DOMAIN = "tzidkat.com";

function isExcelAttachment(a: { filename?: string | null; mimeType?: string }) {
  const name = (a.filename || "").toLowerCase();
  const type = (a.mimeType || "").toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    type.includes("spreadsheetml") ||
    type === "application/vnd.ms-excel"
  );
}

export async function POST(req: Request) {
  // ─── אימות: רק ה-Worker שלנו ───
  const secret = (process.env.INBOUND_EMAIL_SECRET || "").trim();
  const given = req.headers.get("x-inbound-secret") || "";
  // השוואה בזמן קבוע — לא מדליפה כמה תווים מהסוד נכונים
  const ok =
    !!secret &&
    given.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.arrayBuffer();
  let email: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    email = await PostalMime.parse(raw);
  } catch (e: any) {
    console.error("[inbound] MIME parse failed:", e?.message);
    return NextResponse.json({ ok: false, error: "bad mime" }, { status: 400 });
  }

  const from = (email.from?.address || req.headers.get("x-envelope-from") || "").trim().toLowerCase();
  const messageId = (email.messageId || "").slice(0, 190) || `no-id:${from}:${email.date ?? Date.now()}`;
  const subject = (email.subject || "").slice(0, 200);
  const header = (name: string) =>
    email.headers.find((h) => h.key.toLowerCase() === name)?.value?.toLowerCase() ?? "";

  const log = (result: string, extra: Record<string, unknown> = {}, customer?: { id: string; name: string } | null) =>
    audit({
      actorId: customer?.id ?? "inbound-email",
      actorRole: customer ? "CUSTOMER" : "SYSTEM",
      actorName: customer?.name ?? from,
      action: "EXCEL_EMAIL_IN",
      targetType: "Email",
      targetId: messageId,
      targetName: subject,
      meta: { from, result, ...extra },
      req,
    });

  // ─── פעם אחת לכל מייל (ה-Worker עשוי לנסות שוב) ───
  const seen = await prisma.adminAuditLog.findFirst({
    where: { action: "EXCEL_EMAIL_IN", targetId: messageId },
    select: { id: true },
  });
  if (seen) return NextResponse.json({ ok: true, duplicate: true });

  // ─── לא עונים לתשובות אוטומטיות ולעצמנו (מניעת לולאה) ───
  const autoSubmitted = header("auto-submitted");
  if (
    !from ||
    from.endsWith(`@${OWN_DOMAIN}`) ||
    from.includes("mailer-daemon") ||
    from.includes("postmaster") ||
    (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list", "auto_reply"].includes(header("precedence"))
  ) {
    await log("ignored-auto", {
      // לאבחון: מה Cloudflare מוסיף לכותרות האימות
      authResults: (header("authentication-results") + " | " + header("received-spf")).slice(0, 400),
    });
    return NextResponse.json({ ok: true, ignored: "auto" });
  }

  // ─── שולח מזויף? ───
  // כתובת "From" אפשר לזייף. Cloudflare בודק את המייל (SPF/DKIM/DMARC)
  // ומוסיף את התוצאה בכותרת. **הזמנה נוצרת רק ממייל שעבר אימות** —
  // DKIM תקין של דומיין השולח, או SPF תקין. בלי זה, מי שיודע את המייל
  // של לקוח היה יכול להזמין על הכרטיס שלו.
  const authResults = [
    header("authentication-results"),
    header("arc-authentication-results"),
    header("received-spf"),
  ].join(" ");
  const fromDomain = from.split("@")[1] || "";
  const dkimPass = new RegExp(`dkim=pass[^;]*header\\.(d|i)=@?([a-z0-9.-]*\\.)?${fromDomain.replace(/\./g, "\\.")}(?![a-z0-9.-])`).test(authResults);
  // ⚠️ SPF נחשב רק אם הוא של **אותו דומיין** כמו ה-From (יישור). אחרת
  // תוקף שולח מהדומיין שלו (SPF תקין) עם From מזויף של לקוח.
  const mailFrom = (authResults.match(/smtp\.mailfrom=([^\s;]+)/)?.[1] || "").split("@").pop() || "";
  const spfPass =
    /spf=pass/.test(authResults) && !!fromDomain && (mailFrom === fromDomain || mailFrom.endsWith(`.${fromDomain}`));
  const dmarcFail = /dmarc=fail/.test(authResults);
  const auth = { dkimPass, spfPass, dmarcFail, hasHeader: !!authResults.trim() };
  if (dmarcFail || (!dkimPass && !spfPass)) {
    await log("rejected-spoof", { auth, authResults: authResults.slice(0, 400) });
    return NextResponse.json({ ok: true, ignored: "unauthenticated" });
  }

  const excel = (email.attachments || []).find(isExcelAttachment);
  if (!excel) {
    // מייל רגיל (שאלה וכו') — ה-Worker כבר העביר אותו למנהל
    await log("no-attachment");
    return NextResponse.json({ ok: true, handled: false });
  }

  const reply = (kind: ExcelProblemKind, opts: { name?: string | null; detail?: string; saleName?: string; issues?: any[] } = {}) =>
    sendExcelOrderProblem({
      to: from,
      customerName: opts.name ?? null,
      kind,
      detail: opts.detail ?? null,
      saleName: opts.saleName ?? null,
      issues: opts.issues,
    });

  // ─── פענוח ───
  let parsed: Awaited<ReturnType<typeof parseOrderExcel>>;
  try {
    const content =
      typeof excel.content === "string" ? Buffer.from(excel.content, "base64") : Buffer.from(excel.content as ArrayBuffer);
    parsed = await parseOrderExcel(content);
  } catch (e: any) {
    await reply("bad_file");
    await log("bad-file", { error: String(e?.message || e).slice(0, 200), filename: excel.filename });
    return NextResponse.json({ ok: true, result: "bad-file" });
  }
  if (!parsed.pricelistId) {
    await reply("bad_file", { detail: "זה לא קובץ ההזמנה שנשלח מאיתנו" });
    await log("bad-file", { reason: "no-pricelist", filename: excel.filename });
    return NextResponse.json({ ok: true, result: "bad-file" });
  }

  // ─── זיהוי הלקוח: כתובת השולח, ואם הקובץ חתום — חייב להיות אותו לקוח ───
  const byEmail = await prisma.customer.findMany({
    where: { email: { equals: from, mode: "insensitive" }, isActive: true },
    select: { id: true, name: true, email: true },
  });
  let customer: { id: string; name: string } | null = null;
  if (parsed.customerId) {
    customer = byEmail.find((c) => c.id === parsed.customerId) ?? null;
  } else if (byEmail.length === 1) {
    // קובץ ישן בלי חתימת לקוח — לפי השולח בלבד, רק אם הוא חד-משמעי
    customer = byEmail[0];
  }
  if (!customer) {
    await reply("unknown_sender");
    await log("unknown-sender", { fileCustomerId: parsed.customerId, emailMatches: byEmail.length });
    return NextResponse.json({ ok: true, result: "unknown-sender" });
  }

  if (parsed.rows.length === 0) {
    await reply(parsed.issues.length ? "other" : "no_items", {
      name: customer.name,
      detail: parsed.issues.length ? "אף שורה בקובץ לא נקלטה" : undefined,
      issues: parsed.issues,
    });
    await log("no-items", { issues: parsed.issues.length }, customer);
    return NextResponse.json({ ok: true, result: "no-items" });
  }

  // ─── יצירת ההזמנה ───
  const result = await createExcelOrder({
    customerId: customer.id,
    pricelistId: parsed.pricelistId,
    rows: parsed.rows.map((r) => ({ productId: r.productId, isSingle: r.isSingle, quantity: r.quantity })),
    enforceCloseTime: true,
  });

  if (!result.ok) {
    const sale = await prisma.pricelist.findUnique({ where: { id: parsed.pricelistId }, select: { name: true } });
    const kind: ExcelProblemKind =
      result.code === "NO_PAYMENT" || result.code === "CARD_PROBLEM"
        ? "payment"
        : result.code === "SALE_CLOSED"
          ? "closed"
          : result.code === "SALE_NOT_ACTIVE" || result.code === "NO_SALE"
            ? "not_active"
            : result.code === "NO_ITEMS"
              ? "no_items"
              : "other";
    await reply(kind, {
      name: customer.name,
      detail: kind === "payment" && result.code === "CARD_PROBLEM" ? result.error : kind === "other" ? result.error : undefined,
      saleName: sale?.name,
      issues: parsed.issues,
    });
    await log(`refused:${result.code}`, { error: result.error }, customer);
    return NextResponse.json({ ok: true, result: result.code });
  }

  const mail = await sendExcelOrderConfirmation({
    to: from,
    customerName: customer.name,
    orderNumber: result.orderNumber,
    replacedOrderNumber: result.replacedOrderNumber,
    saleName: result.saleName,
    pointName: result.pointName,
    deliveryDateText: result.deliveryDateText,
    items: result.items,
    orderFee: result.orderFee,
    estimatedTotal: result.estimatedTotal,
    isCash: result.isCash,
    issues: parsed.issues,
  });
  await log(
    "order-created",
    {
      orderNumber: result.orderNumber,
      replaced: result.replacedOrderNumber,
      items: result.items.length,
      issues: parsed.issues.length,
      total: result.estimatedTotal,
      confirmationSent: mail.ok,
      auth,
    },
    customer
  );
  console.log(
    `[inbound] order #${result.orderNumber} from ${from} (customer=${customer.id}) items=${result.items.length} replaced=${result.replacedOrderNumber ?? "-"}`
  );
  return NextResponse.json({ ok: true, result: "order-created", orderNumber: result.orderNumber });
}
