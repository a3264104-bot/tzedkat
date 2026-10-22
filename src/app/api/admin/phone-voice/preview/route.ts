// §410: 🔊 השמעה לפני פרסום.
//
// POST /api/admin/phone-voice/preview  { text }
//   → { spoken, audio }  — spoken: מה שייאמר בפועל (תאריכים ושעות במילים),
//                          audio: הקלטה בקול הטבעי (data:audio/wav), או null
//                          + voiceError אם אין קול טבעי (ואז הלקוח ישמע הקראה רגילה)

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { generateVoiceWav } from "@/lib/phone-voice";

export const maxDuration = 120;

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const text = String(b.text ?? "").trim().slice(0, 600);
  if (!text) return NextResponse.json({ error: "אין טקסט" }, { status: 400 });

  const gen = await generateVoiceWav(text);
  return NextResponse.json({
    spoken: gen.spoken,
    audio: gen.ok ? `data:audio/wav;base64,${gen.wav.toString("base64")}` : null,
    voiceError: gen.ok ? null : gen.error,
  });
}
