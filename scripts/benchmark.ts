import { createDatabase } from '../src/lib/database';
import { migrate } from '../src/lib/schema';
import { QaService } from '../src/lib/service';
import { contextFor, createApi } from '../src/lib/graphql';
const db = await createDatabase();
await migrate(db);
const service = new QaService(db);
await service.initialize('benchmark');
const api = createApi();
for (const naive of [true, false]) {
  const context = contextFor(service, 'benchmark', 'OWNER', naive);
  const start = performance.now();
  await api.executeOperation(
    { query: '{ dashboard { issues { id assignee { name } } } }' },
    { contextValue: context },
  );
  console.log(
    JSON.stringify({
      strategy: naive ? 'one query per issue' : 'request-scoped DataLoader',
      issues: 30,
      memberQueries: context.metrics.memberQueries,
      elapsedMs: Math.round(performance.now() - start),
    }),
  );
}
await api.stop();
await db.close();
