#!/usr/bin/env node
// §411: מייצר את src/lib/yemot-prompt-catalog.ts מכל קריאות prompt("שם", "טקסט") בקוד.
// הרצה מתיקיית הפרויקט: node scripts/gen-prompt-catalog.js
const fs = require("fs");
const path = require("path");

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})("src");

const map = {};
for (const f of files) {
  if (f.endsWith("yemot-lib.ts") || f.endsWith("yemot-prompt-catalog.ts")) continue;
  const s = fs.readFileSync(f, "utf8");
  const re = /\bprompt\(\s*"([a-z0-9_]+)"\s*,\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[2];
    if (t.startsWith("`") && t.includes("${")) continue; // טקסט משתנה — אי אפשר להקליט מראש
    const text = t.startsWith("`") ? t.slice(1, -1) : JSON.parse(t);
    // שם עם כמה נוסחים: הראשון מוקלט, האחרים נשארים בהקראה (prompt משווה טקסט)
    if (!(m[1] in map)) map[m[1]] = text;
  }
}

const lines = Object.entries(map)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`);
fs.writeFileSync(
  "src/lib/yemot-prompt-catalog.ts",
  `// §411: 🎙️ קטלוג ההודעות הקבועות של המרכזייה — prompt("שם", "טקסט").
//
// ⚠️ נוצר אוטומטית (scripts/gen-prompt-catalog.js) — לא לערוך ידנית.
// משמש את "הקלטת הודעות המערכת בקול טבעי": כל הודעה שאין לה הקלטה
// אנושית בימות מוקלטת אוטומטית. הודעה חדשה שלא נכנסה לכאן נשארת
// בהקראה רגילה עד שמריצים את הסקריפט שוב.
//
// אחרי שינוי נוסח בקוד: node scripts/gen-prompt-catalog.js
// (הקלטה של נוסח ישן לא תושמע — prompt משמיע אותה רק כשהטקסט זהה.)

export const PROMPT_CATALOG: Record<string, string> = {
${lines.join("\n")}
};
`
);
console.log("wrote", lines.length, "prompts");
