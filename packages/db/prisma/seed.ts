import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const orgId = process.env.DEFAULT_ORG_ID;
const orgName = process.env.DEFAULT_ORG_NAME ?? "Default Organization";
const orgSlug = process.env.DEFAULT_ORG_SLUG ?? "default";

async function main() {

  if (!orgId) {
    throw new Error("DEFAULT_ORG_ID env var is not set")
  }

  await db.org.upsert({
    where: { id: orgId },
    update: {},
    create: {
      id: orgId,
      name: orgName,
      slug: orgSlug,
    }
  })
}
main()
  .then(async () => {
    await db.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    await pool.end();
    process.exit(1);
  });
