# Architecture and tradeoffs

## Request flow

The client sends one typed GraphQL operation to a Next.js Node route. The route resolves a random workspace cookie and simulated role. Apollo validates the operation, resolvers call QaService, and the service validates business inputs before parameterized SQL runs. Errors can arrive with HTTP 200 under GraphQL; the client checks the errors array as well as the HTTP status.

GraphQL is useful here because the screen combines related sites, scans, issues, and owners. REST could also implement this application. GraphQL offers a selectable typed graph; it does not itself provide authentication, caching, SQL efficiency, or a job queue.

TypeScript checks code at build time. Zod validates untrusted mutation input at runtime. The GraphQL schema validates API shapes. Client operation types are maintained manually rather than generated; code generation would reduce schema drift as operations grow.

## Job lifecycle

A scan mutation inserts QUEUED in a transaction, then returns. A partial unique index allows one active scan per site. Repeated enqueue while active returns that job; it is not a general idempotency-key implementation.

A runner claims one queued or expired job in a short transaction with SKIP LOCKED, increments the attempt, and grants a two-minute lease. Network work happens outside the transaction. Completion locks the workspace and scan, checks status and attempt, upserts findings, and commits the result atomically. A delayed worker with an old attempt cannot publish results over a newer claim. Jobs that exhaust expired leases fail visibly.

Local after() execution is best effort. Later GraphQL requests can resume the queue; an external PostgreSQL worker provides independent polling. There is no guarantee that a serverless host keeps background work alive. The scan deadline is checked between requests, so an in-flight request can exceed the nominal 35-second crawl budget. DNS has a two-second timeout, each HTTP request has five seconds, and redirect chains are additionally bounded. The lease is longer than the bounded scan.

## Findings versus human workflow

A finding fingerprint hashes rule, page URL, and target. Stable fingerprints preserve an issue's ID, first-seen time, note, status, and owner on repeat scans. Evidence and last-seen time refresh. Changing a target URL creates a different fingerprint; this is not semantic DOM identity.

Results compare fingerprint sets with the previous completed scan: new, recurring, and not observed. Absence is not resolution because this is a partial crawl. Even a manually resolved issue stays resolved if seen again; automatic reopening is a future policy decision. Reviewers can inspect scan evidence and reopen it themselves.

## Persistence and concurrency

The same SQL adapter targets PGlite or a PostgreSQL pool. Service mutations lock the workspace row to serialize conflicting changes within a demo workspace. A dashboard read also takes that lock for a coherent service snapshot. This favors a straightforward demo over high write throughput. Different PostgreSQL workspaces can proceed independently.

The schema uses relational workspace/site/scan keys and JSONB for site and issue payloads. This makes the small application easy to evolve but sacrifices database-level validation of every payload field. The initial schema uses CREATE IF NOT EXISTS; it is not a versioned migration system. Do not start multiple first-time migrators simultaneously against an empty external database.

The UI loads at most 100 recent scans; retention keeps roughly 30 terminal scans per site, with active jobs retained. Each scan caps findings at 200 and each workspace at 10 sites. Issue history is not automatically deleted or capped over time. A production service needs quotas, retention, archival, and pagination on every potentially large collection.

## N+1 demonstration

Issue.assignee uses a request-local DataLoader. The batch query fetches all requested member IDs within the workspace, then maps results back to input order. Missing members return null. The loader deduplicates repeated IDs and does not share results between requests or workspaces.

The benchmark uses the same schema, seed, and operation twice. A naive resolver makes 30 member queries for 30 issues; the batched resolver makes one. The benchmark does not count dashboard SQL, measure network latency, or prove a throughput improvement under load. Run it yourself with npm run benchmark.
