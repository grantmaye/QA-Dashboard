import { getDatabase } from '../src/lib/database';
import { QaService } from '../src/lib/service';
if (!process.env.DATABASE_URL)
  throw new Error('A separate worker requires DATABASE_URL. Embedded mode uses the in-app runner.');
const db = await getDatabase();
const service = new QaService(db);
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
while (!stopped) {
  try {
    if (!(await service.runOne())) await new Promise((resolve) => setTimeout(resolve, 1500));
  } catch (error) {
    console.error('Worker error', error);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
await db.close();
