# Why Inspect exists: a product scenario

This is an **illustrative fictional scenario**, not a claim about the author's employment, a client engagement, a production incident, or measured business results. Northstar and the sample sites are independent demonstration fixtures. No real visitor, advertising account, employer branding, or confidential data is required.

## The situation

Imagine a small team preparing a workshop announcement. One person edits the website, another reviews content, and a third checks analytics. They can open the page and see a working form, but that does not answer two separate questions: is the page's basic HTML in reasonable shape, and does the campaign emit the intended analytics events under the intended consent setting?

A spreadsheet of problems quickly loses context. Someone writes “missing image text” without a page URL or evidence. Another person fixes a different image. A later scan repeats the same warning, and nobody knows whether it is newly introduced, already assigned, or deliberately ignored. Meanwhile, a form can look successful while producing duplicate conversions or incomplete campaign attribution.

Inspect makes those review conversations concrete. Its website workflow records a finding's evidence, location, recommendation and owner, then preserves human notes and status when the same finding returns. Its separate campaign workspace runs a controlled browser journey and lets a reviewer move from a failed gate to the exact captured event payload.

## The people who benefit

| Person                        | Question they need answered                                  | Implemented help                                                                    |
| ----------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Content or website reviewer   | Which checked pages need attention?                          | Bounded HTML findings with URLs, evidence and recommendations                       |
| Developer handling a finding  | Is this the same issue, and what was already decided?        | Stable fingerprints, saved ownership, notes and status                              |
| Campaign QA reviewer          | Did the intended event sequence occur with correct payloads? | Chromium-observed events, six gates and a payload inspector                         |
| Team lead reviewing readiness | What supports this result, and what remains unknown?         | Saved run history, explicit coverage, gate evidence and failure states              |
| Developer learning the system | How do UI actions become durable, reviewable results?        | Source-linked tests, a shared queue and the [technical manual](technical-manual.md) |

These are plausible beneficiaries of the workflow. The repository does not establish adoption, customer outcomes, conversion lift, time savings, or financial return.

## A concrete before-and-after review

### Before: ambiguous website notes

A reviewer notices a missing title and sends a short message. Later, another person performs another check and reports the same problem. The team must reconstruct whether it was assigned, resolved, or overlooked.

### With the implemented website workflow

The reviewer runs the fictional site's scan, opens the finding, assigns a sample owner and records a note. A later run correlates the same rule, URL and target with the existing issue. Its owner, note and status survive; fresh evidence is available. New, recurring and not-observed counts describe the comparison without declaring an unseen problem fixed.

The benefit is traceability within the demonstration workflow. The bounded scanner still misses pages outside its crawl and does not render JavaScript or certify accessibility.

### Before: a form that looks successful

The fictional workshop page shows a success message. That visual result alone cannot reveal duplicated conversion events, absent campaign attribution, an invalid numeric value, or analytics emitted when consent is disabled.

### With the implemented campaign workflow

Run **Broken fixture**. Chromium completes both consent journeys, while the event ledger records the attempted analytics requests. Failed gates explain the defects and reference sequence numbers. Select an event to inspect its raw payload.

Run **Fixed fixture**. The consent-enabled journey emits one page view, one form event and one conversion; the consent-disabled journey emits none. All six gates pass, and the UI says **Ready for review**. Select the previous broken run to compare saved evidence. A receipt helps compare repeated content and ordering, independent of timing differences.

The benefit is an explainable local regression demonstration. The requests are intercepted; they do not reach a real analytics vendor. The result does not authorize release, establish legal compliance, or prove production measurement correctness.

## Why the two screens look different

Website review is organized around sites, issues and ownership. Campaign inspection is organized around a run, acceptance gates, a chronological event ledger and the selected payload. The campaign screen's navy brief and evidence panels support a different task from the original purple dashboard. The design avoids treating unrelated numbers as the primary answer: reviewers need the evidence behind a decision.

## What the software actually offers today

- Persistent cookie-scoped demonstration workspaces with embedded or external PostgreSQL.
- Bounded website fixture scans, optional guarded live HTML scans, issue triage and scan comparisons.
- Controlled Chromium campaign fixtures with enabled/disabled consent journeys.
- Strict event validation, attribution, order, conversion-count and consent gates.
- Saved evidence, failed-run retry, queue leases and stale-worker completion protection.
- Desktop/mobile browser tests and service tests against embedded and external PostgreSQL.

Owner/Member/Viewer is an explicit simulation. There are no real user accounts, campaign imports, vendor integrations, production alerting, campaign approvals or deployment controls.

## Where a real product would need further work

A real team would need authenticated accounts and memberships, authorized target management, isolated workers, request quotas, retention, operational monitoring and a supported migration process. Real campaign checks would also require a defined consent policy, permitted test data and evidence from the actual collector. Those are potential next steps, not promised or implemented features.

A useful next experiment would measure whether reviewers can explain a failed gate and find its payload without help. That would test usability. Any later claim about saved time or fewer release defects should come from an explicit evaluation with recorded methods and results; no such metric is claimed here.

## Tell the story accurately

A concise project explanation is:

> Inspect demonstrates how to turn website checks and campaign event observations into persistent review evidence. I can show a repeated finding retaining its triage history, then run a deliberately broken and fixed campaign fixture to explain each browser-observed gate. The queue protects saved results from stale workers, and the tests cover both database behavior and browser workflows. The demo deliberately separates evidence from production approval.

Use this as a description of the repository, not an invented professional backstory. For implementation details, hands-on exercises and answers, continue to the [technical manual](technical-manual.md). For a fast setup, return to the [README](../README.md).
