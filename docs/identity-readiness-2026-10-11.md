# Identity readiness regression — 11 October 2026

This bounded follow-up starts from fetched draft PR4 head `c7b3ed6e0cfc89fa27b389d6d54d5339a298546c`. It changes regression coverage and documentation only. No application identity logic, provider, credential, permission, database schema or deployment configuration is changed. Draft PRs 2 and 3 remain preserved.

## Additional coverage

[The new warmed-handler regression](../tests/identity.test.ts#L362) sends twelve requests through the same authenticated handler and Apollo instance. A valid OWNER request first opens SQL and succeeds. Subsequent requests simulate a revoked session, removed membership, a different granted workspace, conflicting OWNER/VIEWER memberships, and an unavailable verifier. Every rejection happens before reading the GraphQL body, obtaining the service, issuing any further SQL query or scheduling work. Responses are no-store, issue no demo cookie and do not expose the workspace/provider detail. Recovery resolves the new VIEWER role and rejects its mutation despite forged OWNER hints.

This tests mocked trusted-principal transitions, **not a real session provider or production revocation system**. The current implementation already behaves correctly. The gap was missing regression coverage for a stale-principal fallback after a successful request.

## Fault-injection evidence

An isolated scratch copy deliberately returns its last non-null principal when a later verifier returns null or throws. The exact pre-existing thirteen tests from the starting commit pass with that defect. The new regression fails at the first revoked-session request: **200 instead of the required 401**. The unmodified repository implementation passes all fourteen tests. This demonstrates additional detection, not a discovered live authentication bypass. The deliberately defective application code was never copied into the repository or deployed.

[Evidence and logs](evidence/2026-10-11-identity/) retain the baseline/mutant outcome and final local checks.

## Local verification

- Formatting, TypeScript and `git diff --check`: passed.
- Fourteen service/identity tests on PGlite: passed.
- Production Next build: passed.
- Four tests against the actual built Next HTTP route: passed; rejected requests do not create the test database.
- One controlled Chromium preflight test: passed.
- Six desktop/mobile end-to-end workflows: passed.
- A local external PostgreSQL server was not available in this recovered executor, so that adapter was **not rerun locally**. Existing CI includes PostgreSQL 17; its exact-head outcome is reported in PR4 and the handoff, separately from local results.

No UI components changed. Browser tests remain bounded workflow regression checks, not a new accessibility certification. Test processes use synthetic data and are stopped after verification. No Mac, new account, terms acceptance, host/security expansion, merge or deployment was used.

## Production readiness remains blocked

- [Provider seam](../src/lib/identity.ts#L63): `verifyPrincipal` intentionally returns null. A separately authorized adapter must verify a server session and trusted membership, including expiry/revocation and upstream failure behavior. Never use demo cookies, role headers or decode-only bearer tokens as authority.
- [Per-request verification](../src/lib/identity.ts#L85) and [membership validation](../src/lib/identity.ts#L101): preserve per-request checks and rejection of conflicting membership. The new regression guards against stale successful authority surviving later failure.
- [HTTP ordering](../src/lib/graphql-http.ts#L39): identity precedes body reading, service access and worker scheduling. Keep provider errors generic. Add provider-specific integration tests once a provider is actually selected; mocks cannot establish that contract.
- [Workspace lookup](../src/lib/graphql-http.ts#L53): authenticated requests require an existing workspace and never demo-seed it. Real provisioning and authoritative membership lifecycle remain unimplemented.
- Health exposure, bounded streaming body admission/quotas, provider-specific CSRF/session review, target authorization/worker egress isolation, migrations/retention and audit history remain separate gates in [the security model](security.md) and [backlog](BACKLOG.md).
