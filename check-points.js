// מציג את כל נקודות החלוקה עם העיר שלהן - כדי לתקן קיבוץ ערים
// הרצה: node check-points.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const points = await prisma.deliveryPoint.findMany({
    orderBy: [{ city: "asc" }, { sortOrder: "asc" }],
  });

  console.log("=== כל נקודות החלוקה (" + points.length + ") ===\n");

  // קיבוץ לפי עיר - להראות איך הלקוח רואה אותן
  const byCity = {};
  points.forEach((p) => {
    const city = p.city || "(ללא עיר)";
    if (!byCity[city]) byCity[city] = [];
    byCity[city].push(p);
  });

  Object.entries(byCity).forEach(([city, pts]) => {
    console.log(`עיר: "${city}" (${pts.length} נקודות)`);
    pts.forEach((p) => {
      console.log(`   - id: ${p.id}`);
      console.log(`     שם: "${p.name}" | פעיל: ${p.isActive ? "כן" : "לא"}`);
    });
    console.log("");
  });

  console.log("שים לב: כל 'עיר' כאן = כרטיס נפרד שהלקוח רואה בבחירה.");
  console.log('אם רמות וירושלים מופיעות בנפרד - צריך לאחד את ה-city שלהן.');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
