import { applySchema, getDb } from '../db';

async function main(): Promise<void> {
  const db = getDb();
  await applySchema(db);
  await db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
