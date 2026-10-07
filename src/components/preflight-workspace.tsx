'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Circle, Play, RefreshCw, X } from 'lucide-react';
import { request } from '@/lib/client';
import type { Role } from '@/lib/model';
import type { PreflightRun, Variant } from '@/lib/preflight/model';
import styles from './preflight-workspace.module.css';
const query = `query Preflight { preflightRuns { id status createdAt completedAt error attempt input { variant fixtureVersion retryOf } preflight { verdict fixtureVersion policyVersion browserVersion evidenceHash durationMs gates { id title passed evidence sequences } timeline { sequence elapsedMs consent kind name payload } } } }`;
function prettyPayload(payload: string) {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
export default function PreflightWorkspace() {
  const [runs, setRuns] = useState<PreflightRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [variant, setVariant] = useState<Variant>('BROKEN');
  const [role, setRole] = useState<Role>('OWNER');
  const [sequence, setSequence] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const result = await request<{ preflightRuns: PreflightRun[] }>(query, {}, role);
    setRuns(result.preflightRuns);
    setLoading(false);
  }, [role]);
  useEffect(() => {
    let cancelled = false;
    request<{ preflightRuns: PreflightRun[] }>(query, {}, role)
      .then((result) => {
        if (!cancelled) {
          setRuns(result.preflightRuns);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [role]);
  const active = runs.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING');
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not refresh runs.');
      }
      if (!cancelled) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, refresh]);
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  const result = run?.preflight;
  const event =
    result?.timeline.find((e) => e.sequence === sequence) ??
    result?.timeline.find((e) => e.kind === 'EVENT');
  async function start(retry?: PreflightRun) {
    setBusy(true);
    setError('');
    try {
      const data = await request<{ startPreflight: { id: string } }>(
        'mutation Start($input:StartPreflightInput!){startPreflight(input:$input){id}}',
        { input: { variant: retry?.input.variant ?? variant, retryOf: retry?.id ?? null } },
        role,
      );
      setSelected(data.startPreflight.id);
      setSequence(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start preflight.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <a href="/" className={styles.back}>
          <ArrowLeft size={15} /> Inspect / QA
        </a>
        <span className={styles.wordmark}>
          PREFLIGHT<span> / CAMPAIGN RELEASE</span>
        </span>
        <span className={styles.local}>CONTROLLED FIXTURE LAB</span>
      </header>
      <main className={styles.layout}>
        <aside className={styles.brief}>
          <div className={styles.index}>RELEASE FILE / 001</div>
          <h1>
            Before the
            <br />
            campaign
            <br />
            <em>goes live.</em>
          </h1>
          <p className={styles.intro}>Follow the events. Find what breaks. Keep the evidence.</p>
          <div className={styles.campaign}>
            <span className={styles.stamp}>N / S</span>
            <div>
              <strong>Northstar Studio</strong>
              <small>Autumn workshop · fictional campaign</small>
            </div>
          </div>
          <div className={styles.contract}>
            <span>THE JOURNEY</span>
            <p>
              Landing page <ArrowRight size={12} /> Signup <ArrowRight size={12} /> Conversion
            </p>
            <dl>
              <dt>Source / medium</dt>
              <dd>demo / email</dd>
              <dt>Campaign</dt>
              <dd>autumn-workshop</dd>
              <dt>Consent cases</dt>
              <dd>Enabled + disabled</dd>
            </dl>
          </div>
          <fieldset className={styles.variants}>
            <legend>Choose the release candidate</legend>
            {(['BROKEN', 'FIXED'] as const).map((value) => (
              <label key={value} className={variant === value ? styles.chosen : ''}>
                <input
                  type="radio"
                  name="variant"
                  value={value}
                  checked={variant === value}
                  onChange={() => setVariant(value)}
                />
                <span>
                  <strong>
                    {value === 'BROKEN' ? '01 / Broken fixture' : '02 / Fixed fixture'}
                  </strong>
                  <small>
                    {value === 'BROKEN'
                      ? 'Duplicate, attribution, schema & consent faults'
                      : 'Corrected instrumentation'}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          <button
            className={styles.runButton}
            disabled={loading || busy || active || role === 'VIEWER'}
            onClick={() => start()}
          >
            <Play size={15} />
            {busy ? 'Queuing…' : active ? 'Preflight in progress' : 'Run preflight'}
            <ArrowRight size={16} />
          </button>
          <label className={styles.role}>
            Demo permissions
            <select
              aria-label="Preflight demo role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="OWNER">Owner</option>
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer · read only</option>
            </select>
          </label>
          <p className={styles.boundary}>
            Role selection simulates permissions; it is not sign-in. No real visitors, ad accounts,
            or external analytics requests.
          </p>
          <details className={styles.contractDetails}>
            <summary>What “ready” means</summary>
            <p>
              Both controlled Chromium journeys completed and all six local policy checks passed.
              This does not approve a deployment or certify consent compliance. The runner
              intercepts requests before they leave the browser.
            </p>
          </details>
        </aside>
        <section className={styles.review} aria-label="Release evidence">
          <div className={styles.reviewHeading}>
            <div>
              <span className={styles.kicker}>RELEASE INSPECTION</span>
              <h2>Evidence before approval.</h2>
            </div>
            <button
              className={styles.refresh}
              onClick={() =>
                refresh()
                  .then(() => setError(''))
                  .catch((e) => setError(e.message))
              }
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
              <button
                onClick={() =>
                  refresh()
                    .then(() => setError(''))
                    .catch((e) => setError(e.message))
                }
              >
                Retry loading
              </button>
            </div>
          )}
          {loading ? (
            <p role="status">Loading saved runs…</p>
          ) : !run ? (
            <div className={styles.empty}>
              <span>01 → 02 → 03</span>
              <h3>A release needs a trace.</h3>
              <p>
                Run the broken fixture first. Then inspect the fixed candidate.
                <br />
                Every verdict is calculated from browser-observed requests.
              </p>
              <div>PAGE VIEW / FORM SUBMISSION / CONVERSION</div>
            </div>
          ) : (
            <>
              <div
                className={`${styles.verdict} ${result?.verdict === 'READY' ? styles.ready : result ? styles.blocked : styles.pending}`}
                role="status"
              >
                <div>
                  <span>
                    {run.input.variant === 'BROKEN' ? '01 / BROKEN FIXTURE' : '02 / FIXED FIXTURE'}{' '}
                    · ATTEMPT {run.attempt}
                  </span>
                  <h3>
                    {result?.verdict === 'READY'
                      ? 'Ready for review'
                      : result
                        ? 'Release blocked'
                        : run.status === 'FAILED'
                          ? 'Run failed'
                          : run.status === 'RUNNING'
                            ? 'Observing the journey…'
                            : 'Waiting for the worker…'}
                  </h3>
                  <p>
                    {result
                      ? `${result.gates.filter((g) => g.passed).length} of ${result.gates.length} gates passed · ${result.timeline.filter((e) => e.kind === 'EVENT').length} analytics requests observed`
                      : run.error ||
                        'The verdict appears only after both browser journeys complete.'}
                  </p>
                </div>
                <span className={styles.verdictMark}>
                  {result?.verdict === 'READY' ? (
                    <Check size={40} />
                  ) : result ? (
                    <X size={40} />
                  ) : (
                    <Circle size={36} />
                  )}
                </span>
              </div>
              {run.status === 'FAILED' && (
                <div className={styles.failure}>
                  <p>
                    No readiness verdict was issued. Retry creates a new run with the same fixture;
                    this failed record remains in history.
                  </p>
                  <button disabled={busy || active || role === 'VIEWER'} onClick={() => start(run)}>
                    Retry failed run
                  </button>
                </div>
              )}
              {result && (
                <>
                  <div className={styles.gates} aria-label="Release gates">
                    {result.gates.map((gate, index) => (
                      <details key={gate.id} className={gate.passed ? styles.pass : styles.fail}>
                        <summary>
                          <span className={styles.gateNumber}>0{index + 1}</span>
                          <strong>{gate.title}</strong>
                          <span>{gate.passed ? 'PASS' : 'BLOCK'}</span>
                          {gate.passed ? <Check size={15} /> : <X size={15} />}
                        </summary>
                        <p>{gate.evidence}</p>
                        {gate.sequences.length > 0 && (
                          <div className={styles.refs}>
                            Evidence{' '}
                            {gate.sequences.map((seq) => (
                              <button key={seq} onClick={() => setSequence(seq)}>
                                #{seq}
                              </button>
                            ))}
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                  <div className={styles.traceHeading}>
                    <h3>Observed event ledger</h3>
                    <span>CLICK A ROW TO INSPECT ITS PAYLOAD</span>
                  </div>
                  <div className={styles.trace}>
                    <ol className={styles.timeline}>
                      {result.timeline.map((item) => (
                        <li key={item.sequence}>
                          <button
                            aria-pressed={event?.sequence === item.sequence}
                            className={
                              event?.sequence === item.sequence ? styles.selectedEvent : ''
                            }
                            onClick={() => setSequence(item.sequence)}
                          >
                            <span className={styles.sequence}>
                              {String(item.sequence).padStart(2, '0')}
                            </span>
                            <span>
                              <strong>{item.name}</strong>
                              <small>
                                {item.consent ? 'Consent enabled' : 'Consent disabled'} ·{' '}
                                {item.kind === 'EVENT'
                                  ? 'request captured'
                                  : 'browser action completed'}
                              </small>
                            </span>
                            <time>+{item.elapsedMs}ms</time>
                          </button>
                        </li>
                      ))}
                    </ol>
                    <div className={styles.payload} aria-label="Selected evidence">
                      <div>
                        <span>EVIDENCE / {event?.sequence.toString().padStart(2, '0')}</span>
                        <span>{event?.kind}</span>
                      </div>
                      <h4>{event?.name}</h4>
                      <p>
                        {event?.kind === 'EVENT'
                          ? 'Intercepted POST /collect · never sent to an external service'
                          : 'Completed by the controlled browser runner'}
                      </p>
                      <pre>
                        {event?.payload
                          ? prettyPayload(event.payload)
                          : 'No analytics payload for this browser action.'}
                      </pre>
                    </div>
                  </div>
                  <details className={styles.receipt}>
                    <summary>Reproduction receipt · {result.evidenceHash.slice(0, 12)}</summary>
                    <dl>
                      <dt>Run ID</dt>
                      <dd>{run.id}</dd>
                      <dt>Fixture / policy</dt>
                      <dd>
                        {result.fixtureVersion} / {result.policyVersion}
                      </dd>
                      <dt>Chromium</dt>
                      <dd>{result.browserVersion}</dd>
                      <dt>Measured duration</dt>
                      <dd>{result.durationMs} ms</dd>
                      <dt>Evidence SHA-256</dt>
                      <dd>{result.evidenceHash}</dd>
                    </dl>
                    <p>
                      The evidence hash excludes timings. Repeating the same fixture should preserve
                      event content and order, not identical durations.
                    </p>
                  </details>
                </>
              )}
            </>
          )}
          <section className={styles.history} aria-label="Run history">
            <div>
              <h3>Run history</h3>
              <span>LAST 30 / SAVED IN YOUR DEMO WORKSPACE</span>
            </div>
            {!runs.length ? (
              <p>No seeded runs. Your first test starts the record.</p>
            ) : (
              <ul>
                {runs.map((item) => (
                  <li key={item.id}>
                    <button
                      aria-pressed={run?.id === item.id}
                      onClick={() => {
                        setSelected(item.id);
                        setSequence(null);
                      }}
                    >
                      <span className={styles.historyStatus}>
                        {item.preflight?.verdict ?? item.status}
                      </span>
                      <strong>
                        {item.input.variant === 'BROKEN' ? 'Broken fixture' : 'Fixed fixture'}
                        {item.input.retryOf ? ' · retry' : ''}
                      </strong>
                      <time>{new Date(item.createdAt).toLocaleString()}</time>
                      <code>{item.id.slice(0, 8)}</code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
