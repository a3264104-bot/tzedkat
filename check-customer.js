// סקריפט אבחון: מציג את כל המשתמשים בטבלת Customer
// עם המייל והטלפון המדויקים - להשוואה מול מה שהוזן ב"שכחתי סיסמה"
// הרצה: node check-customer.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.customer.findMany({
    select: {
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log("=== כל המשתמשים בטבלת Customer (" + customers.length + ") ===");
  console.log("");
  customers.forEach((c) => {
    console.log(
      "שם: " + c.name +
      " | מייל: " + (c.email || "--- אין מייל ---") +
      " | טלפון: " + (c.phone || "אין") +
      " | תפקיד: " + c.role
    );
  });
  console.log("");
  console.log("שים לב: משתמש בלי מייל לא יכול לאפס סיסמה בעצמו.");
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
