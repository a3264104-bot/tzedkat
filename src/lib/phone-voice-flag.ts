// §410: מתג הקול הטבעי — בקובץ נפרד כדי ש-yemot-lib לא ייגרר ל-prisma.
// YEMOT_NATURAL_VOICE=false ב-Vercel מחזיר את כל ההודעות להקראה רגילה.
export function naturalVoiceEnabled(): boolean {
  return process.env.YEMOT_NATURAL_VOICE !== "false";
}
