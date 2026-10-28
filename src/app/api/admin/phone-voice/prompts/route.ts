// §411: 🎙️ הודעות המערכת בקול טבעי.
//
// GET  → מצב כל הודעה (הקלטה אנושית / קול טבעי / רובוט) + המתג
// POST { files: [...] }  → מקליט ומעלה עד 3 הודעות (המסך קורא בסבבים)
// POST { on: true|false } → הפעלה/כיבוי בשיחות

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { listYemotRoot, promptStatuses, voicePrompt } from "@/lib/voiced-prompts";

export const maxDuration = 120;

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const r = await promptStatuses();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));

  if (typeof b.on === "boolean") {
    await prisma.systemSettings.upsert({
      where: { id: "singleton" },
      update: { voicedPromptsOn: b.on },
      create: { id: "singleton", voicedPromptsOn: b.on },
    });
    return NextResponse.json({ ok: true });
  }

  const files: string[] = Array.isArray(b.files) ? b.files.map(String).slice(0, 3) : [];
  if (files.length === 0) return NextResponse.json({ error: "לא נבחרו הודעות" }, { status: 400 });
  const root = await listYemotRoot();
  if (!root.ok) return NextResponse.json({ error: root.error }, { status: 502 });

  const results = [];
  for (const file of files) {
    const error = await voicePrompt(file, root.names);
    results.push({ file, ok: !error, error });
  }
  return NextResponse.json({ results });
}
