import { database } from './database.js';

try {
  await database.initialize();
  const runner = database.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock(719031)');
    const applied = await database.runMigrations({ transaction: 'all' });
    console.log(`Migrations complete: ${applied.length} applied.`);
  } finally {
    await runner.query('SELECT pg_advisory_unlock(719031)');
    await runner.release();
  }
} catch {
  console.error('Migration failed. Check database connectivity and migration compatibility.');
  process.exitCode = 1;
} finally {
  if (database.isInitialized) await database.destroy();
}
