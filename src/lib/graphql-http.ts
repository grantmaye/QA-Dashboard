import { HeaderMap } from '@apollo/server';
import { contextFor, type createApi } from './graphql';
import type { QaService } from './service';
import {
  identityConfig,
  resolveIdentity,
  IdentityError,
  type IdentityEnvironment,
  type PrincipalVerifier,
} from './identity';

type Dependencies = {
  api: ReturnType<typeof createApi>;
  makeService: () => Promise<QaService>;
  schedule: (work: () => Promise<void>) => void;
  env?: () => IdentityEnvironment;
  verify?: PrincipalVerifier;
};
const errorResponse = (error: string, status: number) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/** The Next route and HTTP-boundary tests use the same handler. No client identity adapters. */
export function createGraphqlPost(deps: Dependencies) {
  let started: Promise<void> | undefined;
  return async (request: Request): Promise<Response> => {
    try {
      const config = identityConfig((deps.env ?? (() => process.env))());
      if (!request.headers.get('content-type')?.startsWith('application/json')) {
        return errorResponse('Use application/json.', 415);
      }
      const url = new URL(request.url);
      // Hosted mode requires APP_ORIGIN. Host fallback is only for an explicitly local workflow.
      const expectedOrigin =
        config.appOrigin || `${url.protocol}//${request.headers.get('host') || url.host}`;
      const origin = request.headers.get('origin');
      if (origin && origin !== expectedOrigin) {
        return errorResponse('Cross-origin requests are not allowed.', 403);
      }
      const identity = await resolveIdentity(request, config, deps.verify);
      // Authorization precedes reading the GraphQL body, opening SQL, seeding, resolving, or scheduling.
      const raw = await request.text();
      if (raw.length > 16000) return errorResponse('Request too large.', 413);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return errorResponse('Invalid JSON.', 400);
      }
      const service = await deps.makeService();
      if (identity.mode === 'demo') {
        await service.initialize(identity.workspace);
      } else {
        const rows = await service.db.query('SELECT id FROM workspaces WHERE id=$1', [
          identity.workspace,
        ]);
        if (!rows.length) return errorResponse('The authorized workspace is unavailable.', 403);
      }
      started ??= deps.api.start();
      await started;
      const headers = new HeaderMap();
      request.headers.forEach((v, k) => headers.set(k, v));
      const result = await deps.api.executeHTTPGraphQLRequest({
        httpGraphQLRequest: { method: 'POST', headers, search: '', body },
        context: async () => contextFor(service, identity.workspace, identity.role),
      });
      if (result.body.kind !== 'complete') return errorResponse('Streaming is not supported.', 400);
      // Best-effort runner is scoped to the resolved workspace, never a request cookie in auth mode.
      deps.schedule(async () => {
        await service.runOne(identity.workspace);
      });
      const response = new Response(result.body.string, {
        status: result.status ?? 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      if (identity.mode === 'demo') {
        const secure = new URL(config.appOrigin || request.url).protocol === 'https:';
        response.headers.set(
          'Set-Cookie',
          `qa-workspace=${identity.workspace}; Path=/; Max-Age=604800; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof IdentityError) return errorResponse(error.message, error.status);
      return errorResponse('The request could not be completed.', 500);
    }
  };
}
