// ═══════════════════════════════════════════════════════════════
// §404: 📎 קבצים מצורפים למייל ללקוחות (תמונה / PDF)
// ═══════════════════════════════════════════════════════════════
// הקובץ מועלה קודם ל-Supabase Storage (/api/admin/upload,
// purpose=broadcast), והמייל מקבל רק את הכתובת:
//   🖼 תמונה — מוצגת **בתוך** גוף המייל (פלאייר של המכירה)
//   📄 PDF   — מצורף כקובץ, ובנוסף כפתור "לצפייה בקובץ"
//
// ⚠️ כתובת בלבד, לא הקובץ עצמו: מייל ל-500 לקוחות לא מעביר 500 פעם
// 4MB דרך השרת, וה-JSON לשליחה נשאר קטן.

export type BroadcastAttachment = {
  url: string;
  filename: string;
  kind: "image" | "pdf";
};

export const MAX_BROADCAST_ATTACHMENTS = 3;

/**
 * ⚠️ רק קבצים שהועלו דרכנו (ה-bucket שלנו, תיקיית broadcast). כתובת
 * חיצונית שרירותית לא תצורף — Resend מוריד אותה ושולח לכל הלקוחות.
 */
export function cleanBroadcastAttachments(raw: unknown): BroadcastAttachment[] {
  if (!Array.isArray(raw)) return [];
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return [];
  const prefix = `${base}/storage/v1/object/public/product-images/broadcast/`;
  const out: BroadcastAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const url = String((a as any).url || "");
    if (!url.startsWith(prefix)) continue;
    // הסוג לפי הקובץ ששמרנו (הסיומת נקבעת בהעלאה), לא לפי מה שנשלח
    const kind = /\.pdf$/i.test(url) ? "pdf" : "image";
    const filename =
      String((a as any).filename || "").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 120) ||
      (kind === "pdf" ? "קובץ.pdf" : "תמונה.jpg");
    out.push({ url, filename, kind });
    if (out.length >= MAX_BROADCAST_ATTACHMENTS) break;
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** ה-HTML שמתווסף לגוף המייל: תמונות בתוך המייל, כפתור לכל PDF */
export function attachmentsHtml(atts: BroadcastAttachment[]): string {
  if (atts.length === 0) return "";
  const parts = atts.map((a) =>
    a.kind === "image"
      ? `<div style="margin:16px 0;text-align:center;">
           <img src="${esc(a.url)}" alt="${esc(a.filename)}" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;" />
         </div>`
      : `<div style="margin:12px 0;">
           <a href="${esc(a.url)}" style="display:inline-block;background:#C0461E;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;">📄 לצפייה בקובץ: ${esc(a.filename.replace(/\.pdf$/i, ""))}</a>
         </div>`
  );
  return parts.join("\n");
}
