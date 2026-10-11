> October 11 adds a test-only [warmed-handler revocation regression and readiness record](identity-readiness-2026-10-11.md). The October 9 implementation and historical verification below remain unchanged.

# Identity boundary checkpoint — 9 October 2026

Branch: `codex/harden-demo-identity-boundary`, based on freshly fetched main `8d8c9ba35c0f459bb08e2d90cff3d74c7dd91a25`.

## Delivered

- Central server identity resolver and shared GraphQL HTTP handler. Explicit local demo retains its cookie/role simulation. Missing/invalid configuration is closed; authenticated mode has no provider installed and returns 401 before SQL access.
- Trusted-principal seam validates selected workspace membership and role. Client cookies, role headers, user/workspace headers and unverified bearer values never establish authenticated authority. Missing or conflicting membership is rejected; missing database workspaces are not created.
- Demo-only HttpOnly/Strict cookies, trusted origin-based Secure handling, no identity-detail error leakage, and no implicit OWNER in GraphQL context creation.
- Request-scoped worker now scopes exhausted-lease updates as well as job claims. Previously its exhaustion UPDATE could affect other workspaces. This was found in local code/testing; no breach or real-data exposure was observed.
- Explicit worker configuration and documentation. No identity provider, production authentication, accounts, external credentials, public deployment or security certification.

## Verification

Baseline at main: formatting, typecheck, **8 service tests on PGlite and PostgreSQL**, production build, **1 controlled Chromium preflight test**, **6 desktop/mobile browser tests** all passed.

Final implementation: formatting/typecheck/build passed; **13 service/identity tests on each database adapter**, **4 actual built-Next HTTP boundary tests**, **1 controlled Chromium preflight test** and **6 desktop/mobile browser tests** passed. `git diff --check` passed. No final failing tests. A development TypeScript environment-shape mismatch was corrected before the successful runs.

The HTTP tests exercise missing configuration, authenticated mode without a provider, hosted demo plus live scans, and hosted authenticated mode without a provider. Every rejected query/mutation leaves the test PGlite path absent. Context tests use two mocked trusted principals and cover cross-workspace reads, triage, enqueue, preflight, retries and lease expiry, Viewer mutation rejection despite forged OWNER, missing membership/workspace, cookie flags and generic verifier errors. Mocks exercise the integration contract; they are not a real login flow.

Local external adapter: PostgreSQL **17.11**, workspace-extracted from the already configured signed Debian snapshot. Unix socket only, peer local authentication, TCP disabled. It contains synthetic test data only. Browser dependencies were reused from the cloud environment. No network settings changed. The disconnect notification was checked against live shell execution at 06:18 UTC; execution remained available and changes were preserved.

CI now includes the four built-route tests. Exact remote commit and GitHub Actions outcome are recorded in the draft PR/session handoff after push. Existing browser workflows retain screenshot artifacts; no UI components were edited by this branch.

## Review boundaries

Draft PR #2 remains `eaefd379751f9c5ff62d7705121371b4affc8027`; draft PR #3 remains `0bb34a5c4cf17aba2c2d1b2cbeac3ceb096e7645`. Neither was changed or merged. This branch's README/architecture edits may overlap the teaching documentation PR; reconcile those descriptions during an authorized future review. No component overlap with the decorative-caption PR was introduced.

Health remains an unauthenticated SQL connectivity probe. Request body limits, quotas, session-provider integration/revocation, authenticated workspace provisioning, CSRF review for the eventual provider, rate limits, migrations/retention/audit history, worker monitoring and egress isolation remain separate production gates. `QA_DEPLOYMENT_MODE=local` is operator intent, not a substitute for loopback binding or network isolation.
