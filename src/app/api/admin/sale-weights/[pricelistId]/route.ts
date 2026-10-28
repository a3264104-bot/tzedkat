// ⚖️ GET /api/admin/sale-weights/[pricelistId]           → JSON לסיכום במסך
//    GET /api/admin/sale-weights/[pricelistId]?xlsx=1    → אקסל: גיליון סיכום
//                                                          + גיליון לכל נקודת חלוקה

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { loadSaleWeights } from "@/lib/sale-weights-lib";
import { buildSaleWeightsWorkbook } from "@/lib/sale-weights-xlsx";

export async function GET(req: Request, { params }: { params: Promise<{ pricelistId: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { pricelistId } = await params;
  const data = await loadSaleWeights(pricelistId);
  if (!data) return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });

  if (!new URL(req.url).searchParams.get("xlsx")) return NextResponse.json(data);

  const wb = buildSaleWeightsWorkbook(data);
  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `משקלים_${data.pricelist.name.replace(/[^\w֐-׿\s-]/g, "")}.xlsx`;
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
