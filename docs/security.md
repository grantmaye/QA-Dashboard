# Security and operation notes

This is an interview demo, not an authenticated hosted scanner.

## Identity boundary

`QA_IDENTITY_MODE` and `QA_DEPLOYMENT_MODE` are required server configuration. `NODE_ENV=production` does not imply public hosting: the documented loopback demo also uses a production build.

| Configuration                                              | Behavior                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Missing/invalid mode, deployment, live-scan flag or origin | HTTP 503 before database access                                                               |
| `demo` + `local`                                           | Existing role selector and unsigned workspace cookie simulation; synthetic data may be seeded |
| `demo` + `hosted`                                          | HTTP 503, even with live scans disabled                                                       |
| `authenticated` + `local`                                  | Requires a verified server principal and selected workspace membership                        |
| `authenticated` + `hosted`                                 | Also requires exact HTTPS `APP_ORIGIN`                                                        |

The current `verifyPrincipal` adapter returns `null`. Authenticated requests therefore return **401**, before reading the GraphQL body, opening SQL, seeding a workspace, invoking a resolver or scheduling a job. This is a closed integration seam, **not implemented production authentication**. No provider, accounts, OAuth or credentials were provisioned.

A future in-process adapter must verify the server session and load trusted membership. It returns a subject, selected v4 UUID workspace and exactly one matching membership/role. Never construct that object from `x-demo-role`, `qa-workspace`, other client identity headers, or decoded-but-unverified tokens. Missing/invalid principal returns 401; absent/ambiguous membership returns 403. A trusted membership for a workspace absent from storage also returns 403 and cannot create it. Verifier failures return a generic 503 without exposing or logging session/membership details. The adapter owns session expiry/revocation; this slice cannot certify a future adapter.

Demo cookies are set only in demo mode, with HttpOnly, SameSite=Strict, Path=/ and a seven-day maximum age. Secure follows the explicitly configured APP_ORIGIN when supplied, otherwise the direct request scheme; untrusted forwarded-protocol headers are ignored. Authenticated mode ignores the unsigned workspace cookie and role header and does not issue a demo cookie. OWNER defaults exist only within explicit demo resolution; `contextFor` requires an explicit role, and service edits reject any role other than OWNER/MEMBER.

Deployment mode describes operator intent, not proof of network isolation. Bind the local demo to loopback; do not label a public server local to bypass the guard. Trusted-local live scanning remains opt-in. Hosted demo/live combinations are rejected. The separate worker validates the same configuration at startup, but production admission, authenticated provisioning and worker/network isolation remain release gates.

The GraphQL route and its HTTP tests share `createGraphqlPost`. Mocked trusted principals test the future adapter contract without adding a request-controlled test login. The built Next route is separately tested in four closed configurations and must not create a PGlite directory. `/api/health` remains an unauthenticated database-connectivity probe; it does not expose workspace data or establish readiness of the identity provider.

## Implemented controls

- HTTP/S only, standard ports, no URL credentials, and private/reserved literal addresses rejected.
- DNS returns are checked as a group; any private/reserved address rejects the hostname. The chosen public address is pinned into the socket lookup to avoid resolving a different address after validation.
- Redirect targets are revalidated and must remain on the original origin. Cross-origin redirects are rejected.
- Sequential crawl, eight visited URLs, 32 queued links, at most 200 returned findings, and a 1 MiB response cap. Response content is rendered as React text, never injected into the UI as HTML.
- robots.txt exclusions are honored. A 404 means no rules; other error responses fail the scan. Robots directives are not permission to scan.
- JSON POST API, browser same-origin check, Strict HttpOnly workspace cookie, no-store responses, and parameterized SQL.
- Runtime mutation validation, service-level viewer rejection, workspace predicates, and member validation.
- GraphQL operation field budget, one mutation field per operation, and pagination size of 1–50. Fragment definitions are deliberately disabled to keep this demo's budget implementation small.

## Boundaries that remain

Within explicit local demo mode, the role header is user-controllable. OWNER and MEMBER currently have identical edit permissions. A cookie identifies a random demo workspace but is not a verified identity. Anyone with access to that local demo can create fresh workspaces or supply another known demo workspace UUID. These controls do not establish secure multi-tenancy.

The request-size check happens after the body is read. Put an upstream body limit in front of an exposed deployment. Field-count limits are not a full cost model: aliases can repeat expensive dashboard reads. Add rate limits and operation-aware cost limits or persisted operations for a real public service.

DNS pinning and address classification reduce SSRF risk but do not replace an egress firewall. Corporate routing can make public IPs sensitive. Use isolated workers with network restrictions and enforce an authorized target list for a production scanning service.

There is no global request quota, workspace expiry task, issue archival, authentication, audit log, or background queue monitoring. HTML checks do not evaluate rendered JavaScript content, CSS resource URLs, responsive behavior, or accessibility conformance. Link query strings are excluded to avoid unbounded parameter spaces; a user-supplied starting URL may contain a query string.

## Troubleshooting

- A scan stays queued: open the dashboard to trigger the local runner or run the PostgreSQL worker. Check worker logs and database configuration.
- A failed scan mentions a redirect: add the final canonical origin instead.
- A live scan fails fetching robots.txt: inspect the site's response or access policy; do not bypass it.
- A PGlite directory reports a lock: use a single app process or move to external PostgreSQL. Never run the separate worker against that directory.
- GraphQL returns 503 for configuration: copy `.env.example` to `.env.local` for an explicit trusted-local demo; authenticated hosting is not implemented.
- GraphQL returns 401 in authenticated mode: expected until a reviewed provider adapter exists. Do not switch a hosted deployment to demo to work around it.
- Viewer edits fail: this is expected. Select Owner or Member in the desktop demo controls.
- Data appears new in another browser: workspaces are cookie-scoped. Clearing the cookie creates a new sample workspace; it does not erase the old database rows.

Back up PostgreSQL normally for retained deployments. Local data can be reset by stopping the app and removing `.data/qa`; this permanently removes local demo workspaces. Health at GET /api/health checks database connectivity, not queue health or target website reachability.

## Controlled campaign fixtures

Campaign preflight is available at `/preflight`. It executes only the checked-in fictional fixture in a fresh Chromium context; callers choose a known variant, never a URL or script. Every page request is intercepted. The exact fixture navigation is fulfilled locally, analytics POSTs are recorded and fulfilled locally, and other requests are aborted. Service workers are disabled. No real form data or third-party analytics credentials are used.

This adds browser execution only for trusted repository fixtures. It does not relax the existing live scanner's network policy and is not a sandbox for untrusted script execution. “Ready for review” is a computed fixture verdict, not an authorization or compliance decision. Owner/Member/Viewer remains a client-selected demo simulation. See [runner bounds, persistence, and production limitations](campaign-preflight.md).
