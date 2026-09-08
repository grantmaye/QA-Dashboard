# Inspect — Website QA Dashboard

[![Verify](https://github.com/grantmaye/QA-Dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/grantmaye/QA-Dashboard/actions/workflows/ci.yml)

A small website quality workflow: scan a site, inspect the evidence, assign a finding, and track it across later scans. Built with **Next.js, TypeScript, Node.js, Apollo GraphQL, and PostgreSQL**.

The default demo works offline against deliberately imperfect sample HTML. It needs no API keys or database account. Sample scan history is seeded demonstration data, not historical monitoring of real businesses.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Embedded PGlite stores data in `.data/qa`. The first request creates a cookie-scoped workspace with three fictional sites, six sample scans, and 30 findings. The browser stores only the workspace cookie; the actual data lives in the database.

For a production build:

```sh
npm run build
npm start
```

## A two-minute walkthrough

1. Click **Run scan** on a website card. The queued job runs real checks against local HTML fixtures.
2. Open an issue. Read its evidence and recommendation, assign an owner, and add a note.
3. Run another scan. Existing ownership, notes, and status remain intact.
4. Open **Scan history** to see checked URLs, response timings, and new/recurring/not-observed counts.
5. Select **Viewer** in the desktop sidebar. Mutations are disabled in the interface and rejected by the service.
6. Run `npm run benchmark` to compare naive owner lookups with request-scoped GraphQL batching.

## What it checks

| Check              | What it actually measures                                             |
| ------------------ | --------------------------------------------------------------------- |
| HTTP errors        | Status codes for visited same-origin pages                            |
| Page title         | A non-empty title element                                             |
| Meta description   | A non-empty description attribute                                     |
| Document language  | Presence of an HTML lang value                                        |
| Main heading       | Whether the response contains exactly one h1; an editorial convention |
| Image alternatives | Missing alt attributes; empty decorative alt is accepted              |
| Insecure resources | HTTP src attributes in an HTTPS HTML response                         |

This is not a full accessibility audit, a browser renderer, an external broken-link checker, or a Core Web Vitals tool. It does not execute JavaScript. A page excluded by crawl limits may still have problems. “Not observed” deliberately does not mean “fixed.”

## GraphQL as the application boundary

`POST /api/graphql` exposes typed sites, scans, findings, members, and mutations. The dashboard requests nested issue owners in the same operation. A request-scoped DataLoader batches those owner lookups instead of querying once per issue.

```graphql
query IssuePage($after: String) {
  issues(first: 10, after: $after) {
    edges {
      cursor
      node {
        id
        title
        severity
        status
        assignee {
          name
        }
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

```graphql
mutation QueueScan($siteId: ID!) {
  startScan(siteId: $siteId) {
    id
    status
  }
}
```

The issue connection uses keyset pagination by stable ID. The main demo screen uses an aggregate dashboard query; it is intentionally simpler than a production paginated client. Mutations use runtime validation and workspace-scoped SQL. See [architecture](docs/architecture.md) for the request and worker flows.

## PostgreSQL and a separate worker

```sh
docker compose up -d
```

Set `DATABASE_URL=postgres://qa:qa@localhost:5432/qa` in `.env.local` for Next.js. Start the worker in a second terminal with its environment explicitly set:

```sh
DATABASE_URL=postgres://qa:qa@localhost:5432/qa npm run worker
```

The local default runs a best-effort worker through Next.js `after()`. Jobs persist before execution. A separate worker needs external PostgreSQL: two processes must not open the same PGlite directory. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, use two-minute leases, and fence completion by attempt number. Expired leases get up to three attempts. Ordinary scan failures are shown in history and can be retried by starting a new scan.

## Live scanning

Copy `.env.example` to `.env.local` and set `ENABLE_LIVE_SCANS=true`; restart Next.js. Set the same variable for a separate worker. Add a site in live mode using its final canonical URL. Only scan sites you own or have permission to check.

The crawler respects robots exclusions, visits at most eight URLs, follows only same-origin query-free links, caps response bodies at 1 MiB, bounds DNS and HTTP waits, and rejects private/reserved addresses. DNS results are validated and pinned to the socket; redirects are checked again. Cross-origin redirects fail with an explanation. Use the destination URL directly.

**Deployment boundary:** role selection is a simulation, not authentication. The unsigned random cookie provides demo separation, not verified membership. Live mode is off by default. Before exposing this to untrusted users, add sign-in, trusted membership checks, rate limits, storage quotas, worker monitoring, and network egress restrictions. See [security and operations](docs/security.md).

## Verification

```sh
npm test
npm run typecheck
npm run format:check
npm run benchmark
npm run build
npx playwright install chromium
npm run test:e2e
```

CI runs the service tests against both embedded PGlite and PostgreSQL, then builds the app and runs desktop/mobile Playwright workflows. Screenshots and failure traces are retained as workflow artifacts. The tests cover network address validation, fixture checks, robots exclusions, triage persistence, workspace isolation, duplicate enqueue, stale completion fencing, pagination, and owner batching.

Measured locally with 30 assigned issues: **30 owner queries without batching, 1 with DataLoader**. This measures the owner lookup portion, not total request queries or production throughput. Timing is printed for context and is not a performance guarantee.

## Project map

```text
src/app/                 Next.js pages and HTTP routes
src/components/          Dashboard interface
src/lib/graphql.ts       Schema, resolvers, request DataLoader
src/lib/service.ts       Workspace, triage, queue and completion rules
src/lib/scanner.ts       HTML checks and bounded crawl
src/lib/transport.ts     Public network policy and pinned HTTP transport
src/lib/fixtures.ts      Offline sample responses
src/lib/database.ts      PGlite/PostgreSQL adapter
src/lib/schema.ts        Idempotent initial schema
scripts/worker.ts        Separate PostgreSQL worker
scripts/benchmark.ts     Reproducible N+1 comparison
tests/                   Service and browser verification
```

## Next steps

Authenticated workspaces, versioned migrations, paginated UI data, issue archival, an append-only triage audit log, and a browser-based accessibility worker are deliberate follow-on work. This repository demonstrates the smaller complete workflow first.

MIT licensed.
