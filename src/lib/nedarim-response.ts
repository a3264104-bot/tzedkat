// 🔒 לאיזה לקוח שייכת תשובת נדרים (TransactionResponse)?
//
// לכל בקשה ל-iframe מצרפים את מספר הלקוח — ב-Param1 וב-Comment
// ("customer:<id>|type:registration"). אם נדרים מחזירים אותו בתשובה,
// משווים אותו ללקוח שאליו עומדים לשמור: תשובה של בקשה אחרת לא נשמרת.
// אם השדות לא חזרו — מחזירים "" (אין על מה להשוות), והשרת מסתמך על
// שאר הבדיקות.
export function responseCustomerId(value: any): string {
  if (!value || typeof value !== "object") return "";
  const p1 = String(value.Param1 ?? value.param1 ?? "").trim();
  if (p1) return p1;
  const comment = String(value.Comments ?? value.Comment ?? value.comments ?? value.comment ?? "");
  const m = comment.match(/customer:([A-Za-z0-9]+)/);
  return m ? m[1] : "";
}
