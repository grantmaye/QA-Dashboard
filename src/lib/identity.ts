import { randomUUID } from 'node:crypto';
import type { Role } from './model';

export class IdentityError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 503,
  ) {
    super(message);
  }
}
export type IdentityEnvironment = Record<string, string | undefined>;
export type IdentityConfig = {
  mode: 'demo' | 'authenticated';
  deployment: 'local' | 'hosted';
  appOrigin?: string;
};
export function identityConfig(env: IdentityEnvironment): IdentityConfig {
  const mode = env.QA_IDENTITY_MODE;
  const deployment = env.QA_DEPLOYMENT_MODE;
  if (
    (mode !== 'demo' && mode !== 'authenticated') ||
    (deployment !== 'local' && deployment !== 'hosted') ||
    ![undefined, 'false', 'true'].includes(env.ENABLE_LIVE_SCANS)
  ) {
    throw new IdentityError('Identity and deployment configuration is missing or invalid.', 503);
  }
  if (deployment === 'hosted' && mode === 'demo') {
    throw new IdentityError('Hosted operation requires verified server identity.', 503);
  }
  let appOrigin: string | undefined;
  if (env.APP_ORIGIN) {
    try {
      const url = new URL(env.APP_ORIGIN);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== env.APP_ORIGIN)
        throw new Error();
      appOrigin = url.origin;
    } catch {
      throw new IdentityError('APP_ORIGIN must be an exact HTTP or HTTPS origin.', 503);
    }
  }
  if (deployment === 'hosted' && !appOrigin?.startsWith('https://')) {
    throw new IdentityError('Hosted operation requires an explicit HTTPS APP_ORIGIN.', 503);
  }
  return { mode, deployment, appOrigin };
}

/** Only an in-process verifier may return this. Never deserialize it from request headers/body. */
export type VerifiedPrincipal = {
  subject: string;
  activeWorkspaceId: string | null;
  memberships: ReadonlyArray<{ workspaceId: string; role: Role }>;
};
export type PrincipalVerifier = (request: Request) => Promise<VerifiedPrincipal | null>;
export type RequestIdentity = {
  mode: IdentityConfig['mode'];
  workspace: string;
  role: Role;
  subject?: string;
};
// No identity provider is installed. Authenticated mode intentionally returns 401 until one is wired.
// This seam must verify a server session and load trusted membership, not trust client role claims.
export const verifyPrincipal: PrincipalVerifier = async () => null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles: readonly string[] = ['OWNER', 'MEMBER', 'VIEWER'];
export async function resolveIdentity(
  request: Request,
  config: IdentityConfig,
  verify: PrincipalVerifier = verifyPrincipal,
): Promise<RequestIdentity> {
  if (config.mode === 'demo') {
    const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)qa-workspace=([^;]*)/)?.[1];
    const requested = request.headers.get('x-demo-role');
    if (requested !== null && !roles.includes(requested)) {
      throw new IdentityError('Choose a valid demo role.', 400);
    }
    return {
      mode: 'demo',
      workspace: cookie && uuid.test(cookie) ? cookie : randomUUID(),
      role: (requested ?? 'OWNER') as Role,
    };
  }
  let principal: VerifiedPrincipal | null;
  try {
    principal = await verify(request);
  } catch {
    // Do not expose verifier details, session tokens, membership data or upstream errors.
    throw new IdentityError('Identity verification is unavailable.', 503);
  }
  if (!principal || typeof principal.subject !== 'string' || !principal.subject.trim()) {
    throw new IdentityError('A verified server identity is required.', 401);
  }
  const workspace = principal.activeWorkspaceId;
  if (
    typeof workspace !== 'string' ||
    !uuid.test(workspace) ||
    !Array.isArray(principal.memberships)
  ) {
    throw new IdentityError('A trusted workspace membership is required.', 403);
  }
  const memberships = principal.memberships.filter((m) => m?.workspaceId === workspace);
  if (memberships.length !== 1 || !roles.includes(memberships[0].role)) {
    throw new IdentityError('A trusted workspace membership is required.', 403);
  }
  return {
    mode: 'authenticated',
    subject: principal.subject,
    workspace,
    role: memberships[0].role,
  };
}
