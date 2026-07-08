import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    settings = await prisma.systemSettings.create({ data: { id: "singleton" } });
  }
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json();
  const data: any = {};

  if ("adminEmail" in b && b.adminEmail) data.adminEmail = String(b.adminEmail).trim();
  if ("adminWhatsappPhone" in b) data.adminWhatsappPhone = b.adminWhatsappPhone?.trim() || null;
  if ("sendEmailToCustomer" in b) data.sendEmailToCustomer = !!b.sendEmailToCustomer;
  if ("sendEmailToAdmin" in b) data.sendEmailToAdmin = !!b.sendEmailToAdmin;
  if ("personalOrdersEnabled" in b) data.personalOrdersEnabled = !!b.personalOrdersEnabled;
  if ("customerEmailTemplate" in b) data.customerEmailTemplate = b.customerEmailTemplate || null;
  if ("adminEmailTemplate" in b) data.adminEmailTemplate = b.adminEmailTemplate || null;

  const settings = await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });

  return NextResponse.json(settings);
}
