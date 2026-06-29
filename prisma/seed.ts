import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// קטגוריות
const categories = [
  { key: "poultry", name: "עופות טריים", sortOrder: 1 },
  { key: "meat", name: "בשר", sortOrder: 2 },
  { key: "fish", name: "דגים", sortOrder: 3 },
  { key: "frozen", name: "מוצרים קפואים / מארזים", sortOrder: 4 },
];

// מוצרים מתוך המחירון תמוז תשפ"ו
// allowSingles=true למוצרי בשר ודגים (מחיר בקרטון + אפשרות בודדים בתוספת 3 ש"ח לק"ג)
type Seed = {
  name: string;
  cat: string;
  price: number;
  unit?: string;
  saleType?: "WEIGHT" | "UNIT" | "PACKAGE";
  allowSingles?: boolean;
  packageWeight?: string;
  isFrozen?: boolean;
  limitedQty?: boolean;
};

const products: Seed[] = [
  // עופות טריים
  { name: "עוף שלם", cat: "poultry", price: 28.9 },
  { name: "עוף מחולק", cat: "poultry", price: 29.9 },
  { name: "עצמות / גרונות", cat: "poultry", price: 9.9 },
  { name: "כנפיים", cat: "poultry", price: 15.9 },
  { name: "כרעיים", cat: "poultry", price: 41.9 },
  { name: "ירכיים", cat: "poultry", price: 37.9 },
  { name: "שוקיים", cat: "poultry", price: 48.9 },
  { name: "חזה", cat: "poultry", price: 47.9 },
  { name: "שניצל", cat: "poultry", price: 51.9 },
  { name: "שניצל פרמיום", cat: "poultry", price: 58.9 },
  { name: "פרגיות", cat: "poultry", price: 81.9 },
  { name: "כבד צלוי - טרי 200 גרם", cat: "poultry", price: 32.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "200 גרם", limitedQty: true },

  // דגים (בקרטון, אפשרות בודדים בתוספת)
  { name: "סלומון - נורבגי", cat: "fish", price: 59.9, allowSingles: true },
  { name: "מנות סלומון - נורבגי", cat: "fish", price: 69.9, allowSingles: true },
  { name: "מושט עם עור", cat: "fish", price: 14.9, allowSingles: true },
  { name: "מושט ללא עור", cat: "fish", price: 22.9, allowSingles: true },

  // בשר (בקרטון, אפשרות בודדים בתוספת)
  { name: "צלעות - מס' 2", cat: "meat", price: 60.9, allowSingles: true },
  { name: "חזה - מס' 3", cat: "meat", price: 51.9, allowSingles: true },
  { name: "כתף מרכזי - מס' 4", cat: "meat", price: 61.9, allowSingles: true },
  { name: "צלי כתף - מס' 5", cat: "meat", price: 101.9, allowSingles: true },
  { name: "פילה מדומה - מס' 6", cat: "meat", price: 79.9, allowSingles: true },
  { name: "מכסה הצלע - מס' 7", cat: "meat", price: 49.9, allowSingles: true },
  { name: "שריר הזרוע - מס' 8", cat: "meat", price: 78.9, allowSingles: true },
  { name: "זרוע (אוסובוקו) - מס' 8 עם עצם", cat: "meat", price: 67.9, allowSingles: true },
  { name: "צוואר - מס' 10", cat: "meat", price: 52.9, allowSingles: true },
  { name: "בשר לחמין - מס' 29", cat: "meat", price: 49.9, allowSingles: true },
  { name: "אצבעות אנטריקוט - עם עצם", cat: "meat", price: 47.9, allowSingles: true },
  { name: "עין אנטריקוט", cat: "meat", price: 123.9, allowSingles: true },

  // קפואים / מארזים
  { name: "נקניקיות בקר מרגז – 400ג' - קפוא", cat: "frozen", price: 25.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "400 גרם", isFrozen: true },
  { name: "בקר טחון – 500ג' - קפוא", cat: "frozen", price: 37.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "500 גרם", isFrozen: true },
  { name: "עוף טחון – 500ג' - קפוא", cat: "frozen", price: 24.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "500 גרם", isFrozen: true },
  { name: "נקניקיות עוף רגיל – 400ג' - קפוא", cat: "frozen", price: 13.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "400 גרם", isFrozen: true },
  { name: "נקניקיות עוף חריף – 400ג' - קפוא", cat: "frozen", price: 14.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "400 גרם", isFrozen: true },
  { name: "נקניקיות עוף קראנץ – 900ג' - קפוא", cat: "frozen", price: 27.5, saleType: "PACKAGE", unit: "מארז", packageWeight: "900 גרם", isFrozen: true },
];

// נקודות חלוקה + נציגים מתוך רשימת הנציגים
const points = [
  { name: "מודיעין", contactName: 'הר"ר אברהם א. רוזנטל הי"ו', phone: "058-4171209", email: "9744365@GMAIL.COM" },
  { name: "ברכפלד", contactName: 'הר"ר אברהם א. רוזנטל הי"ו', phone: "058-4171209", email: "9744365@GMAIL.COM" },
  { name: "ביתר A - תפארת אברהם אלימלך", contactName: 'הר"ר יוחנן ברש"ז שמעיה הי"ו', phone: "053-4138451", email: "AA0534138451@GMAIL.COM" },
  { name: "ביתר A - אור ישראל", contactName: "בטלפון/מייל", phone: "058-7678894", email: "M5402088@GMAIL.COM" },
  { name: "ביתר B - בית אהרן", contactName: "בטלפון/מייל", phone: "058-7678894", email: "M5402088@GMAIL.COM" },
  { name: "ביתר B - בית יעקב חיים", contactName: "בטלפון/מייל", phone: "058-7678894", email: "M5402088@GMAIL.COM" },
  { name: "ירושלים", contactName: 'הר"ר חיים משה בריזל הי"ו', phone: "050-4100885", email: "" },
  { name: "רמות", contactName: 'הר"ר אשר בוקשפן הי"ו', phone: "058-7678894", email: "M5402088@GMAIL.COM" },
  { name: "גבעת זאב", contactName: "בטלפון/מייל", phone: "058-7678894", email: "M5402088@GMAIL.COM" },
  { name: "בני ברק", contactName: 'הר"ר פנחס אלבוים הי"ו', phone: "054-2525584", email: "P0542525584@GMAIL.COM" },
  { name: "טבריה", contactName: "בטלפון/מייל", phone: "058-7678894", email: "M5402088@GMAIL.COM" },
];

async function main() {
  console.log("🌱 Seeding...");

  // Admin
  const email = process.env.ADMIN_EMAIL || "admin@tzedkat.co.il";
  const password = process.env.ADMIN_PASSWORD || "admin1234";
  const hash = await bcrypt.hash(password, 10);
  await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { email, password: hash, name: "מנהל" },
  });
  console.log(`✅ Admin: ${email} / ${password}`);

  // Categories
  const catMap: Record<string, string> = {};
  for (const c of categories) {
    const created = await prisma.category.create({ data: { name: c.name, sortOrder: c.sortOrder } });
    catMap[c.key] = created.id;
  }

  // Products
  let sort = 0;
  const productIds: string[] = [];
  for (const p of products) {
    const created = await prisma.product.create({
      data: {
        name: p.name,
        categoryId: catMap[p.cat],
        cartonPrice: p.price,
        allowSingles: p.allowSingles ?? false,
        singleSurcharge: p.allowSingles ? 3 : null,
        unit: p.unit ?? 'ק"ג',
        saleType: p.saleType ?? "WEIGHT",
        packageWeight: p.packageWeight ?? null,
        isFrozen: p.isFrozen ?? false,
        limitedQty: p.limitedQty ?? false,
        sortOrder: sort++,
      },
    });
    productIds.push(created.id);
  }

  // Delivery points
  const pointIds: string[] = [];
  let psort = 0;
  for (const pt of points) {
    const created = await prisma.deliveryPoint.create({
      data: {
        name: pt.name,
        contactName: pt.contactName,
        phone: pt.phone,
        email: pt.email || null,
        sortOrder: psort++,
      },
    });
    pointIds.push(created.id);
  }

  // Pricelist: מחירון תמוז תשפ"ו — פעיל, כל הנקודות וכל המוצרים
  const pricelist = await prisma.pricelist.create({
    data: {
      name: 'מחירון תמוז תשפ"ו',
      status: "ACTIVE",
      singleSurcharge: 3,
      deliveryDateText: 'יום שני/שלישי פר\' חקת — ל\' סיון / א\' תמוז',
      notes: 'ההרשמה: עד מוצ"ש פר\' קרח כ"ח סיון. אין לקחת בהקפה! יש לשלם מיד עם לקיחת הסחורה.',
      points: { create: pointIds.map((id) => ({ pointId: id })) },
      products: { create: productIds.map((id) => ({ productId: id })) },
    },
  });
  console.log(`✅ Pricelist: ${pricelist.name} (ACTIVE)`);

  console.log("🎉 Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
