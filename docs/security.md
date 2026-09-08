# Security and operation notes

This is an interview demo, not an authenticated hosted scanner.

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

The role header is user-controllable. OWNER and MEMBER currently have identical edit permissions. A cookie identifies a random demo workspace but is not a verified identity. Anyone can create fresh workspaces. These controls do not establish secure multi-tenancy.

The request-size check happens after the body is read. Put an upstream body limit in front of an exposed deployment. Field-count limits are not a full cost model: aliases can repeat expensive dashboard reads. Add rate limits and operation-aware cost limits or persisted operations for a real public service.

DNS pinning and address classification reduce SSRF risk but do not replace an egress firewall. Corporate routing can make public IPs sensitive. Use isolated workers with network restrictions and enforce an authorized target list for a production scanning service.

There is no global request quota, workspace expiry task, issue archival, authentication, audit log, or background queue monitoring. HTML checks do not evaluate rendered JavaScript content, CSS resource URLs, responsive behavior, or accessibility conformance. Link query strings are excluded to avoid unbounded parameter spaces; a user-supplied starting URL may contain a query string.

## Troubleshooting

- A scan stays queued: open the dashboard to trigger the local runner or run the PostgreSQL worker. Check worker logs and database configuration.
- A failed scan mentions a redirect: add the final canonical origin instead.
- A live scan fails fetching robots.txt: inspect the site's response or access policy; do not bypass it.
- A PGlite directory reports a lock: use a single app process or move to external PostgreSQL. Never run the separate worker against that directory.
- Viewer edits fail: this is expected. Select Owner or Member in the desktop demo controls.
- Data appears new in another browser: workspaces are cookie-scoped. Clearing the cookie creates a new sample workspace; it does not erase the old database rows.

Back up PostgreSQL normally for retained deployments. Local data can be reset by stopping the app and removing `.data/qa`; this permanently removes local demo workspaces. Health at GET /api/health checks database connectivity, not queue health or target website reachability.
