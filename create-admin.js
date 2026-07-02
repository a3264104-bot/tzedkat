const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  
  if (!email || !password) {
    console.error('חסר ADMIN_EMAIL או ADMIN_PASSWORD ב-.env');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  
  const admin = await prisma.admin.upsert({
    where: { email },
    update: { password: hash },
    create: { email, password: hash },
  });

  console.log('Admin created/updated OK:', admin.email);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
