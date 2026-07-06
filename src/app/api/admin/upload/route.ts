import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/guard";

// העלאת תמונת מוצר ל-Supabase Storage.
// דרישות חד-פעמיות:
// 1. משתני סביבה ב-Vercel וב-.env:
//    NEXT_PUBLIC_SUPABASE_URL  (כתובת הפרויקט, מ-Supabase > Settings > API)
//    SUPABASE_SERVICE_ROLE_KEY (המפתח הסודי service_role, מאותו מסך)
// 2. ב-Supabase > Storage: צור bucket בשם product-images וסמן אותו Public
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "חסרים משתני סביבה של Supabase Storage (ראה הוראות בקובץ)" },
      { status: 500 }
    );
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "לא נשלח קובץ" }, { status: 400 });

  // רק תמונות, עד 3MB
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "ניתן להעלות תמונות בלבד" }, { status: 400 });
  }
  if (file.size > 3 * 1024 * 1024) {
    return NextResponse.json({ error: "התמונה גדולה מדי (מקסימום 3MB)" }, { status: 400 });
  }

  const supabase = createClient(url, key);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) {
    console.error("upload error:", error);
    return NextResponse.json(
      { error: "ההעלאה נכשלה - ודא שקיים bucket ציבורי בשם product-images" },
      { status: 500 }
    );
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
