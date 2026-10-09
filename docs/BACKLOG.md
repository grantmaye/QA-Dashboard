# Product backlog

## October 9 completed slice

The demo identity boundary now fails closed outside explicit local demo mode, with server principal/membership integration seams, role/cookie spoofing coverage, and request-worker workspace isolation. See [identity checkpoint](identity-checkpoint.md) and [security model](security.md). Production authentication remains unimplemented; the authenticated adapter returns no principal.

## Next QA work

- Implement a reviewed provider adapter, verified membership/session expiry and authenticated provisioning only in a separately authorized production-auth slice. Do not use demo cookies/headers or decode-only tokens as authority.
- Add the sanitized completed-scan report described in the spa repository's QA handoff. Preserve coverage limits and “Not observed does not mean fixed”; omit sensitive free-text evidence unless its sanitization can be substantiated.
- Release gates: admission/quotas/body limits, authorized-target worker network isolation, transport redirect/DNS/body/time-limit tests, PostgreSQL worker monitoring, migrations/retention and audit history, and separately isolated arbitrary-site browser execution.
- Preserve draft PRs #2 (teaching manual) and #3 (caption cleanup); no merges or deployments in this session. Reconcile the teaching manual's old default-demo/setup descriptions if these branches are later combined.

## Shared Feature priority

After the verified Stillwell WordPress and QA boundary checkpoints, next product work is the four Elementor kit briefs in `feature-elementor-kits` (`feature/kit-briefs`, draft PR #1). Ten templates per kit, distinct UX, Elementor Free/Hello preferred. Official export and clean-import checks are required before claiming working kits. Envato category eligibility and AI-content rules remain release gates; no marketplace submission is authorized.
