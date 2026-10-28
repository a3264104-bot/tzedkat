// §411: 🎙️ הודעות המערכת בקול טבעי.
//
// במרכזייה יש ~110 הודעות קבועות (prompt). חלקן הוקלטו בקול אנושי
// והועלו לימות; השאר מוקראות ברובוט. הכלי הזה מקליט בקול הטבעי רק את
// אלה שאין להן קובץ בימות, מעלה אותן בשם nv_<שם>.wav, ושומר במסד מה
// הוקלט. prompt() משמיע אותן רק אם המתג voicedPromptsOn דלוק.

import { prisma } from "@/lib/prisma";
import { setVoicedPrompts } from "@/lib/yemot-lib";
import { PROMPT_CATALOG } from "@/lib/yemot-prompt-catalog";
import { generateVoiceWav, uploadToYemot } from "@/lib/phone-voice";

const YEMOT_API = "https://www.call2all.co.il/ym/api";

let cache: { at: number } | null = null;

/** נטען בתחילת כל בקשה של ה-IVR. מטמון של דקה — שאילתה אחת לדקה, לא לכל הקשה. */
export async function loadVoicedPrompts(): Promise<void> {
  if (cache && Date.now() - cache.at < 60_000) return;
  cache = { at: Date.now() };
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: "singleton" },
      select: { voicedPrompts: true, voicedPromptsOn: true },
    });
    setVoicedPrompts(s?.voicedPromptsOn ? parseMap(s.voicedPrompts) : {});
  } catch (e) {
    // כישלון = הקראה רגילה, לא שיחה שנופלת
    console.error("[voiced-prompts] load failed:", e);
  }
}

function parseMap(raw: string | null | undefined): Record<string, string> {
  try {
    const m = JSON.parse(raw || "{}");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

export async function getVoicedState() {
  const s = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { voicedPrompts: true, voicedPromptsOn: true },
  });
  return { map: parseMap(s?.voicedPrompts), on: !!s?.voicedPromptsOn };
}

/** שמות הקבצים והתיקיות בשורש המערכת בימות */
export async function listYemotRoot(): Promise<{ ok: true; names: Set<string> } | { ok: false; error: string }> {
  const token = process.env.YEMOT_TOKEN;
  if (!token || !token.includes(":")) return { ok: false, error: "חסר YEMOT_TOKEN" };
  try {
    const res = await fetch(
      `${YEMOT_API}/GetIVR2Dir?token=${encodeURIComponent(token)}&path=${encodeURIComponent("ivr2:/")}`
    );
    const j: any = await res.json().catch(() => null);
    if (j?.responseStatus !== "OK") {
      return { ok: false, error: `ימות: ${String(j?.message ?? res.status).slice(0, 200)}` };
    }
    const names = new Set<string>();
    for (const d of j.dirs ?? []) if (d?.name) names.add(String(d.name));
    for (const f of j.files ?? []) if (f?.name) names.add(String(f.name).replace(/\.[a-z0-9]+$/i, ""));
    for (const f of j.ini ?? []) if (f?.name) names.add(String(f.name).replace(/\.[a-z0-9]+$/i, ""));
    return { ok: true, names };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export type PromptStatus = "human" | "voiced" | "missing";

/** מצב כל הודעה: הקלטה אנושית / קול טבעי / רובוט */
export async function promptStatuses() {
  const [root, state] = await Promise.all([listYemotRoot(), getVoicedState()]);
  if (!root.ok) return { ok: false as const, error: root.error };
  const rows = Object.entries(PROMPT_CATALOG).map(([file, text]) => {
    const status: PromptStatus = root.names.has(file)
      ? "human"
      : state.map[file] === text && root.names.has(`nv_${file}`)
        ? "voiced"
        : "missing";
    return { file, text, status };
  });
  return { ok: true as const, rows, on: state.on };
}

/**
 * מקליט ומעלה הודעה אחת. ⚠️ מסרב אם יש לה הקלטה אנושית בימות.
 */
export async function voicePrompt(file: string, rootNames: Set<string>): Promise<string | null> {
  const text = PROMPT_CATALOG[file];
  if (!text) return "הודעה לא מוכרת";
  if (rootNames.has(file)) return "יש לה הקלטה אנושית — לא נוגעים";
  const gen = await generateVoiceWav(text);
  if (!gen.ok) return gen.error;
  const err = await uploadToYemot(`nv_${file}`, gen.wav);
  if (err) return err;
  // קריאה-כתיבה מחדש: כמה בקשות מקבילות לא ידרסו זו את זו כמעט אף פעם,
  // ובמקרה הגרוע הודעה אחת תוקלט שוב בלחיצה הבאה
  const state = await getVoicedState();
  state.map[file] = text;
  await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    update: { voicedPrompts: JSON.stringify(state.map) },
    create: { id: "singleton", voicedPrompts: JSON.stringify(state.map) },
  });
  return null;
}
