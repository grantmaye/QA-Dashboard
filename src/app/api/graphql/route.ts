import { after } from 'next/server';
import { getDatabase } from '@/lib/database';
import { QaService } from '@/lib/service';
import { createApi } from '@/lib/graphql';
import { createGraphqlPost } from '@/lib/graphql-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const POST = createGraphqlPost({
  api: createApi(),
  makeService: async () => new QaService(await getDatabase()),
  schedule: after,
});
