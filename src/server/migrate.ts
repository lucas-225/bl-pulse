import { closeDatabase, initDatabase, isDatabaseReady } from './db.js';

await initDatabase();
if (!isDatabaseReady()) {
  console.error('Managed database was not initialized. Check project database configuration.');
  process.exitCode = 1;
} else {
  console.info('BL Pulse database schema is ready.');
}
await closeDatabase();
