// §410: 🎙️ קול טבעי להודעות הטלפון.
//
// במקום ההקראה הממוחשבת של ימות (רובוטית, בלי הטעמה), כל הודעה
// שהמנהל מפרסם מוקלטת אוטומטית בקול טבעי (Gemini TTS), עולה לימות
// כקובץ שמע, ובשיחה מושמע הקובץ.
//
// ⚠️ תמיד יש גיבוי: אם אין מפתח, ההקלטה נכשלה או ההעלאה לימות
// נכשלה — audioPath נשאר ריק וה-IVR מקריא את הטקסט כרגיל (עם
// התיקונים של hebrew-speech). לקוח אף פעם לא שומע שקט בגלל זה.
//
// ENV:
//   GEMINI_API_KEY        — ההקלטה
//   YEMOT_TOKEN           — "מספר-מערכת:סיסמה", להעלאת הקובץ לימות
//   YEMOT_NATURAL_VOICE   — "false" מכבה את השמעת הקבצים (חזרה להקראה)
//   YEMOT_VOICE_NAME      — קול של Gemini (ברירת מחדל Kore)
//   YEMOT_VOICE_DIR       — תיקייה בימות לקבצים (ברירת מחדל: שורש)

import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { speakableHebrew } from "@/lib/hebrew-speech";

const YEMOT_API = "https://www.call2all.co.il/ym/api";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

export { naturalVoiceEnabled } from "@/lib/phone-voice-flag";

/** PCM 16-bit mono → WAV */
function pcmToWav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * הקלטת הטקסט בקול טבעי. מחזיר WAV, או שגיאה בעברית למנהל.
 * הטקסט עובר קודם speakableHebrew — אותם תאריכים ושעות כמו בהקראה.
 */
export async function generateVoiceWav(
  text: string
): Promise<{ ok: true; wav: Buffer; spoken: string } | { ok: false; error: string; spoken: string }> {
  const spoken = speakableHebrew(text);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "חסר GEMINI_API_KEY", spoken };
  if (!spoken) return { ok: false, error: "אין טקסט להקלטה", spoken };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    "הקריאי בעברית, בקול חם וברור, בקצב רגוע, עם הפסקה קצרה בסוף כל משפט — " +
                    "כמו הודעה מוקלטת במערכת טלפונית לקהל חרדי. אל תוסיפי שום מילה מעבר לטקסט:\n\n" +
                    spoken,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: process.env.YEMOT_VOICE_NAME || "Kore" },
              },
            },
          },
        }),
      }
    );
    clearTimeout(timer);
    const j: any = await res.json().catch(() => null);
    const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData)?.inlineData;
    if (!res.ok || !part?.data) {
      const msg = String(j?.error?.message ?? `HTTP ${res.status}`).slice(0, 200);
      return { ok: false, error: `ההקלטה נכשלה: ${msg}`, spoken };
    }
    const rate = Number(String(part.mimeType ?? "").match(/rate=(\d+)/)?.[1] ?? 24000);
    return { ok: true, wav: pcmToWav(Buffer.from(part.data, "base64"), rate), spoken };
  } catch (e: any) {
    return { ok: false, error: `ההקלטה נכשלה: ${String(e?.message ?? e).slice(0, 200)}`, spoken };
  }
}

/** הנתיב בימות (בלי סיומת) — כפי שמושמע ב-f- */
function voicePath(announcementId: string): string {
  const dir = (process.env.YEMOT_VOICE_DIR || "").replace(/^\/+|\/+$/g, "");
  // ⚠️ בלי נקודות ומקפים — הם מפרידים בפרוטוקול של ימות. cuid נקי מהם.
  const name = `voice_${announcementId.replace(/[^a-zA-Z0-9_]/g, "")}`;
  return dir ? `${dir}/${name}` : name;
}

async function uploadToYemot(path: string, wav: Buffer): Promise<string | null> {
  const token = process.env.YEMOT_TOKEN;
  if (!token || !token.includes(":")) return "חסר YEMOT_TOKEN";
  const fd = new FormData();
  fd.append("token", token);
  fd.append("path", `ivr2:/${path}.wav`);
  // ימות ממירים לפורמט הטלפוני (8kHz) בעצמם
  fd.append("convertAudio", "1");
  fd.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");
  try {
    const res = await fetch(`${YEMOT_API}/UploadFile`, { method: "POST", body: fd });
    const j: any = await res.json().catch(() => null);
    if (j?.responseStatus === "OK") return null;
    const msg = String(j?.message ?? `HTTP ${res.status}`);
    if (/token is invalid|do not match/i.test(msg)) {
      return "הסיסמה של ימות (YEMOT_TOKEN) לא תקפה";
    }
    return `ההעלאה לימות נכשלה: ${msg.slice(0, 200)}`;
  } catch (e: any) {
    return `ההעלאה לימות נכשלה: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}

/**
 * מקליט ומעלה את ההודעה, ושומר את הנתיב. לא זורק — כישלון רק נרשם
 * (voiceError), וההודעה ממשיכה להיות מוקראת כרגיל.
 */
export async function attachNaturalVoice(announcementId: string): Promise<void> {
  try {
    const ann = await prisma.phoneAnnouncement.findUnique({
      where: { id: announcementId },
      select: { id: true, text: true },
    });
    if (!ann?.text) return;

    // אותו טקסט כבר הוקלט (שליחה גלובלית יוצרת הודעה לכל מכירה פעילה) —
    // משתמשים באותו קובץ במקום להקליט שוב
    const twin = await prisma.phoneAnnouncement.findFirst({
      where: { id: { not: ann.id }, text: ann.text, audioPath: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { audioPath: true },
    });
    if (twin?.audioPath) {
      await prisma.phoneAnnouncement.update({
        where: { id: ann.id },
        data: { audioPath: twin.audioPath, voiceError: null },
      });
      return;
    }

    const gen = await generateVoiceWav(ann.text);
    if (!gen.ok) {
      await prisma.phoneAnnouncement.update({
        where: { id: ann.id },
        data: { audioPath: null, voiceError: gen.error },
      });
      return;
    }
    const path = voicePath(ann.id);
    const err = await uploadToYemot(path, gen.wav);
    // ⚠️ הטקסט אולי השתנה בזמן ההקלטה — שומרים רק אם הוא עדיין אותו טקסט
    await prisma.phoneAnnouncement.updateMany({
      where: { id: ann.id, text: ann.text },
      data: err ? { audioPath: null, voiceError: err } : { audioPath: path, voiceError: null },
    });
    if (err) console.error("[phone-voice]", ann.id, err);
  } catch (e) {
    console.error("[phone-voice] failed:", e);
  }
}

/**
 * מריץ את ההקלטה ברקע אחרי שהתשובה למנהל כבר נשלחה (10-20 שניות).
 * ברצף ולא במקביל — כך הודעה שנייה עם אותו טקסט משתמשת בקובץ של הראשונה.
 */
export function voiceInBackground(ids: (string | null | undefined)[]): void {
  const list = ids.filter((x): x is string => !!x);
  if (list.length === 0) return;
  waitUntil(
    (async () => {
      for (const id of list) await attachNaturalVoice(id);
    })()
  );
}
