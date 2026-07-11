// מאחד את נקודות ירושלים תחת עיר אחת "ירושלים"
// כדי שהלקוח יראה כרטיס אחד עם שתי נקודות לבחירה
// הרצה: node fix-cities.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // כל נקודה שה-city שלה מכיל "ירושלים" (כולל "רמות - ירושלים") → "ירושלים"
  const jerusalemPoints = await prisma.deliveryPoint.findMany({
    where: { city: { contains: "ירושלים" } },
  });

  console.log(`נמצאו ${jerusalemPoints.length} נקודות באזור ירושלים:\n`);
  for (const p of jerusalemPoints) {
    console.log(`  "${p.name}" — עיר נוכחית: "${p.city}"`);
  }

  const result = await prisma.deliveryPoint.updateMany({
    where: { city: { contains: "ירושלים" } },
    data: { city: "ירושלים" },
  });

  console.log(`\n✓ ${result.count} נקודות אוחדו תחת העיר "ירושלים".`);
  console.log('כעת הלקוח יראה כרטיס אחד "ירושלים" עם הנקודות לבחירה.');

  // הצגת התוצאה
  const after = await prisma.deliveryPoint.findMany({
    where: { city: "ירושלים" },
    select: { name: true },
  });
  console.log("\nנקודות בירושלים כעת:");
  after.forEach((p) => console.log(`  - ${p.name}`));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
