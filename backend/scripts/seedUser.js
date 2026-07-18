require("dotenv/config");
const { prisma } = require("../src/lib/prisma.js");
const { hashPassword } = require("../src/lib/auth.js");

async function main() {
  const email = process.env.SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) {
    console.error("Set SEED_EMAIL and SEED_PASSWORD in backend/.env before running this script.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  console.log(`Seeded user ${user.email} (id ${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
