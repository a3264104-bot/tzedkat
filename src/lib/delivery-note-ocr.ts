// §20: OCR + AI לתעודות משלוח באמצעות Gemini 2.5 Flash
//
// זרימה: המנהל מעלה צילום -> Gemini מחלץ שורות -> החזרת JSON מובנה למנהל לאישור
//
// עלות: ~$0.005 לתעודה (Gemini 2.5 Flash)

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// prompt מותאם לתעודות משלוח ישראליות של ספקי בשר/עופות
// נבנה לאחר ניתוח 7 תעודות מ-3 ספקים שונים:
// אנגוס לאס פידראס, לנדה סחר, נחמיה לחוביץ'
const OCR_PROMPT = `אתה מומחה לקריאת תעודות משלוח של ספקי בשר/עופות בישראל.

חלץ מהתעודה הזאת את הנתונים הבאים בפורמט JSON:

1. פרטי התעודה:
   - supplierName: שם הספק (למשל "לנדה סחר בע\"מ", "אנגוס לאס פידראס", "נחמיה לחוביץ' בע\"מ")
   - noteNumber: מספר תעודת המשלוח (רצף ספרות מודגש בראש התעודה)
   - noteDate: תאריך התעודה בפורמט YYYY-MM-DD

2. items: מערך של שורות מוצרים. כל שורה מכילה:
   - productNameOnNote: שם המוצר בדיוק כפי שכתוב (בעברית, ללא שינויים)
   - quantity: מספר קרטונים (מספר שלם)
   - weight: משקל בק"ג (מספר עשרוני)
   - confidence: רמת ביטחון שלך בזיהוי (0.0 עד 1.0)

חוקים חשובים:
- דלג על שורות סיכום ("סה\"כ", טוטלים בסוף)
- אם יש שדה שאתה לא בטוח בו, סמן confidence נמוך (0.5 או פחות)
- אם הטקסט מטושטש/חתוך, השתמש ב-confidence 0.3-0.5
- אם התעודה מסובבת/הפוכה, נסה לקרוא בכל מקרה
- דוגמאות שמות מוצרים אמיתיות מהתעודות: "עוף טרי ארוז לנדא", "כרעיים עוף טרי אר לנדא", "צוואר צרכני אגודים פמפ", "חזה עוף טרי אר לנדא"

החזר JSON תקין בלבד, ללא שום טקסט נוסף:
{
  "supplierName": "...",
  "noteNumber": "...",
  "noteDate": "YYYY-MM-DD",
  "items": [
    {
      "productNameOnNote": "...",
      "quantity": 0,
      "weight": 0.0,
      "confidence": 0.0
    }
  ]
}`;

export type OCRResult = {
  ok: boolean;
  data?: {
    supplierName?: string;
    noteNumber?: string;
    noteDate?: string;
    items: Array<{
      productNameOnNote: string;
      quantity: number;
      weight: number;
      confidence: number;
    }>;
  };
  error?: string;
  rawResponse?: string;
};

/**
 * מפעיל Gemini 2.5 Flash על תמונת תעודת משלוח.
 * מקבל base64 של התמונה (למשל data URL), מחזיר JSON מובנה.
 */
export async function extractDeliveryNote(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<OCRResult> {
  if (!GEMINI_API_KEY) {
    return { ok: false, error: "GEMINI_API_KEY not configured on server" };
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1, // נמוך = יציב יותר
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    // הסרת prefix של data URL אם קיים
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");

    const result = await model.generateContent([
      OCR_PROMPT,
      {
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType,
        },
      },
    ]);

    const responseText = result.response.text();

    // פרסינג של JSON
    try {
      const parsed = JSON.parse(responseText);

      // ולידציה בסיסית
      if (!parsed.items || !Array.isArray(parsed.items)) {
        return {
          ok: false,
          error: "Gemini returned invalid format - missing items array",
          rawResponse: responseText,
        };
      }

      // נרמול הנתונים
      const normalizedItems = parsed.items
        .filter((item: any) => item && item.productNameOnNote)
        .map((item: any) => ({
          productNameOnNote: String(item.productNameOnNote).trim(),
          quantity: Math.max(0, Math.round(Number(item.quantity) || 0)),
          weight: Math.max(0, Number(item.weight) || 0),
          confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
        }));

      return {
        ok: true,
        data: {
          supplierName: parsed.supplierName ? String(parsed.supplierName).trim() : undefined,
          noteNumber: parsed.noteNumber ? String(parsed.noteNumber).trim() : undefined,
          noteDate: parsed.noteDate ? String(parsed.noteDate).trim() : undefined,
          items: normalizedItems,
        },
        rawResponse: responseText,
      };
    } catch (parseErr: any) {
      return {
        ok: false,
        error: `Failed to parse Gemini JSON: ${parseErr?.message || "unknown"}`,
        rawResponse: responseText,
      };
    }
  } catch (e: any) {
    console.error("[delivery-note-ocr] Gemini error:", e);
    return {
      ok: false,
      error: e?.message || "Gemini API call failed",
    };
  }
}

/**
 * התאמת שמות מוצרים בין מה שהתקבל מ-OCR למוצרים במערכת.
 * משתמש בהתאמה חכמה של מילים משותפות + סף התאמה.
 */
export function matchProductByName(
  ocrName: string,
  products: Array<{ id: string; name: string }>
): { productId: string | null; confidence: number } {
  if (!ocrName || products.length === 0) {
    return { productId: null, confidence: 0 };
  }

  const normalize = (s: string) =>
    s
      .replace(/["'׳״]/g, "") // הסרת גרשיים
      .replace(/[.,()]/g, " ") // הסרת פיסוק
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => w.toLowerCase());

  const ocrWords = new Set(normalize(ocrName));
  if (ocrWords.size === 0) return { productId: null, confidence: 0 };

  let bestMatch: { productId: string | null; score: number } = {
    productId: null,
    score: 0,
  };

  for (const p of products) {
    const productWords = new Set(normalize(p.name));
    if (productWords.size === 0) continue;

    // ספירת מילים משותפות
    let common = 0;
    for (const w of ocrWords) {
      if (productWords.has(w)) common++;
    }

    // ציון = מילים משותפות / מקסימום מילים (Jaccard-like)
    const maxWords = Math.max(ocrWords.size, productWords.size);
    const score = common / maxWords;

    if (score > bestMatch.score) {
      bestMatch = { productId: p.id, score };
    }
  }

  // דורש התאמה של לפחות 40% מילים
  if (bestMatch.score < 0.4) {
    return { productId: null, confidence: bestMatch.score };
  }

  return { productId: bestMatch.productId, confidence: bestMatch.score };
}
