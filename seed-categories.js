const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

// הקטגוריות הבסיסיות לפי בקשת הלקוח (ניתנות לעריכה/הוספה/הסתרה/סידור דרך המנהל)
const categories = [
  { name: 'עופות טריים', sortOrder: 1 },
  { name: 'בשר בקר', sortOrder: 2 },
  { name: 'דגים', sortOrder: 3 },
  { name: 'קפואים ומארזים', sortOrder: 4 },
  { name: 'מוצרים מיוחדים / מוגבלים', sortOrder: 5 },
];

async function main() {
  for (const cat of categories) {
    // בודקים אם כבר קיימת קטגוריה בשם הזה כדי לא ליצור כפילות
    const existing = await prisma.category.findFirst({ where: { name: cat.name } });
    if (existing) {
      console.log('כבר קיימת:', cat.name);
      continue;
    }
    await prisma.category.create({ data: cat });
    console.log('נוצרה קטגוריה:', cat.name);
  }
  console.log('סיום - כל הקטגוריות מוכנות');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
