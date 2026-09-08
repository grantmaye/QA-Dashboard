'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  Globe,
  Layers,
  ListChecks,
  Plus,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { getWorkspace, request } from '@/lib/client';
import type { Dashboard as Data, Issue, IssueStatus, Role } from '@/lib/model';
const labels: Record<IssueStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  IGNORED: 'Ignored',
};
export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null),
    [role, setRole] = useState<Role>('OWNER'),
    [tab, setTab] = useState('Overview'),
    [site, setSite] = useState('all'),
    [search, setSearch] = useState(''),
    [severity, setSeverity] = useState('all'),
    [selected, setSelected] = useState<Issue | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [live, setLive] = useState(false);
  const refresh = useCallback(async () => {
    const result = await getWorkspace(role);
    setData(result.dashboard);
    setLive(result.liveScansEnabled);
  }, [role]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  const active = data?.scans.some((s) => s.status === 'RUNNING' || s.status === 'QUEUED');
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => refresh().catch((e) => setError(e.message)), 1500);
    return () => clearInterval(timer);
  }, [active, refresh]);
  async function mutate(query: string, variables: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await request(query, variables, role);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const issues =
    data?.issues.filter(
      (i) =>
        (site === 'all' || i.siteId === site) &&
        (severity === 'all' || i.severity === severity) &&
        `${i.title} ${i.pageUrl}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const open = issues.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS');
  const scans = data?.scans.filter((s) => site === 'all' || s.siteId === site) ?? [];
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <ListChecks size={21} />
          </span>
          inspect<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="avatar">G</span>
          <div>
            Grant’s workspace<small>Portfolio demo</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {[
            ['Overview', Layers],
            ['Issues', ListChecks],
            ['Scan history', Activity],
            ['How it works', ShieldCheck],
          ].map(([name, Icon]) => (
            <button
              key={String(name)}
              className={tab === name ? 'nav-item current' : 'nav-item'}
              onClick={() => setTab(String(name))}
            >
              {typeof Icon !== 'string' && <Icon size={18} />}
              <span>{String(name)}</span>
              {name === 'Issues' && (
                <b>{data?.issues.filter((i) => i.status === 'OPEN').length ?? '—'}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-dot" /> Demo workspace
          <p>
            Sample sites. Real checks.
            <br />
            Changes persist in your browser’s workspace.
          </p>
          <label>
            Preview permissions
            <select
              aria-label="Demo role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="OWNER">Owner</option>
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer · read only</option>
            </select>
          </label>
          <small>Role selection is a demo, not sign-in.</small>
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            Workspace <ChevronRight size={14} /> <strong>{tab}</strong>
          </span>
          <span className="header-right">
            <span className="status-dot" /> System ready <span className="avatar">GB</span>
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">WEBSITE QUALITY, IN ONE PLACE</div>
              <h1>{tab}</h1>
              <p>Catch the small things before your visitors do.</p>
            </div>
            <button
              className="primary"
              disabled={role === 'VIEWER'}
              onClick={() => setAdding(true)}
            >
              <Plus size={16} /> Add website
            </button>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError('')} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="panel loading">Loading your workspace…</div>
          ) : (
            <>
              <div className="summary">
                <article>
                  <span>
                    Monitored websites <Globe size={17} />
                  </span>
                  <strong>{data.sites.length.toString().padStart(2, '0')}</strong>
                  <small>Across your workspace</small>
                </article>
                <article>
                  <span>
                    Open issues <ListChecks size={17} />
                  </span>
                  <strong>{open.length}</strong>
                  <small>
                    <i className="dot medium" /> Awaiting review or a fix
                  </small>
                </article>
                <article>
                  <span>
                    High priority <ShieldCheck size={17} />
                  </span>
                  <strong>{open.filter((i) => i.severity === 'HIGH').length}</strong>
                  <small>Start with these findings</small>
                </article>
                <article>
                  <span>
                    Completed scans <Activity size={17} />
                  </span>
                  <strong>{scans.filter((s) => s.status === 'COMPLETED').length}</strong>
                  <small>{active ? 'A scan is in progress' : 'Ready for the next scan'}</small>
                </article>
              </div>
              {tab === 'Overview' && (
                <section>
                  <div className="section-heading">
                    <h2>
                      Your websites <span>{data.sites.length}</span>
                    </h2>
                    <span>Bounded scans · up to 8 pages</span>
                  </div>
                  <div className="sites">
                    {data.sites.map((s, index) => {
                      const last = data.scans.find((scan) => scan.siteId === s.id);
                      const count = data.issues.filter(
                        (i) => i.siteId === s.id && ['OPEN', 'IN_PROGRESS'].includes(i.status),
                      ).length;
                      const running = last && ['RUNNING', 'QUEUED'].includes(last.status);
                      return (
                        <article className="site-card" key={s.id}>
                          <div className="site-top">
                            <span className={`site-logo logo-${index % 3}`}>
                              {s.name
                                .split(' ')
                                .map((w) => w[0])
                                .join('')
                                .slice(0, 2)}
                            </span>
                            <span className="badge">
                              {s.mode === 'DEMO' ? 'Sample site' : 'Live site'}
                            </span>
                          </div>
                          <h3>{s.name}</h3>
                          <span className="site-url">{new URL(s.url).hostname}</span>
                          <div className="site-health">
                            <strong>{count} open issues</strong>
                            <span>{last?.result?.pages.length ?? 0} pages checked</span>
                          </div>
                          <div className="severity-bar">
                            {['HIGH', 'MEDIUM', 'LOW'].map((level) => (
                              <span
                                key={level}
                                className={level.toLowerCase()}
                                style={{
                                  flex: Math.max(
                                    0.1,
                                    data.issues.filter(
                                      (i) => i.siteId === s.id && i.severity === level,
                                    ).length,
                                  ),
                                }}
                              />
                            ))}
                          </div>
                          <div className="site-actions">
                            <button
                              className="text-button"
                              onClick={() => {
                                setSite(s.id);
                                setTab('Issues');
                              }}
                            >
                              View issues <ArrowUpRight size={14} />
                            </button>
                            <button
                              disabled={busy || !!running || role === 'VIEWER'}
                              onClick={() =>
                                mutate(
                                  'mutation Scan($siteId: ID!) { startScan(siteId: $siteId) { id status } }',
                                  { siteId: s.id },
                                )
                              }
                            >
                              {running ? 'Scanning…' : 'Run scan'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {(tab === 'Overview' || tab === 'Issues') && (
                <section className="panel">
                  <div className="section-heading table-heading">
                    <div>
                      <h2>{tab === 'Overview' ? 'Issue inbox' : 'All issues'}</h2>
                      <p>Evidence, ownership, and next steps for every finding.</p>
                    </div>
                    <span className="badge">{issues.length} findings</span>
                  </div>
                  <div className="filters">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search issues"
                        placeholder="Search issues or pages…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter website"
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                    >
                      <option value="all">All websites</option>
                      {data.sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter severity"
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                    >
                      <option value="all">All priorities</option>
                      <option value="HIGH">High</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="LOW">Low</option>
                    </select>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Issue / page</th>
                          <th>Priority</th>
                          <th>Status</th>
                          <th>Owner</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {issues.slice(0, tab === 'Overview' ? 7 : 200).map((i) => (
                          <tr key={i.id}>
                            <td>
                              <button className="issue-title" onClick={() => setSelected({ ...i })}>
                                {i.title}
                              </button>
                              <small>
                                {new URL(i.pageUrl).hostname}
                                {new URL(i.pageUrl).pathname}
                              </small>
                            </td>
                            <td>
                              <span className={`priority ${i.severity.toLowerCase()}`}>
                                <i className={`dot ${i.severity.toLowerCase()}`} />
                                {i.severity.toLowerCase()}
                              </span>
                            </td>
                            <td>
                              <span className={`state ${i.status.toLowerCase()}`}>
                                {labels[i.status]}
                              </span>
                            </td>
                            <td>
                              <span
                                className="avatar small"
                                title={data.members.find((m) => m.id === i.assigneeId)?.name}
                              >
                                {data.members.find((m) => m.id === i.assigneeId)?.initials ?? '—'}
                              </span>
                            </td>
                            <td>
                              <button
                                aria-label={`Inspect ${i.title}`}
                                className="icon-button"
                                onClick={() => setSelected({ ...i })}
                              >
                                <ChevronRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {issues.length === 0 && <p className="empty">No issues match these filters.</p>}
                  </div>
                  <div className="table-footer">
                    Showing {Math.min(issues.length, tab === 'Overview' ? 7 : 200)} of{' '}
                    {issues.length} findings
                    {tab === 'Overview' && (
                      <button className="text-button" onClick={() => setTab('Issues')}>
                        View all issues <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </section>
              )}
              {tab === 'Scan history' && (
                <section className="panel">
                  <div className="section-heading table-heading">
                    <h2>Scan activity</h2>
                    <span>Most recent first</span>
                  </div>
                  {scans.map((s) => (
                    <details className="scan" key={s.id}>
                      <summary>
                        <span>
                          <strong>{data.sites.find((site) => site.id === s.siteId)?.name}</strong>
                          <small>{new Date(s.createdAt).toLocaleString()}</small>
                        </span>
                        <span className="badge">{s.status}</span>
                        <span>{s.result?.findings.length ?? '—'} findings</span>
                      </summary>
                      <div className="scan-detail">
                        {s.error && <p className="error">{s.error}</p>}
                        {s.result && (
                          <>
                            <p>{s.result.coverage}</p>
                            <p>
                              <strong>{s.result.newCount}</strong> new ·{' '}
                              <strong>{s.result.recurringCount}</strong> recurring ·{' '}
                              <strong>{s.result.notObservedCount}</strong> not observed in this
                              scan. Not observed does not mean fixed.
                            </p>
                            {s.result.warnings.map((w) => (
                              <p key={w}>{w}</p>
                            ))}
                            {s.result.pages.map((p) => (
                              <p key={p.url}>
                                <code>{p.status}</code> {p.url}{' '}
                                <small>{p.durationMs} ms response</small>
                              </p>
                            ))}
                          </>
                        )}
                      </div>
                    </details>
                  ))}
                </section>
              )}
              {tab === 'How it works' && (
                <section className="panel explain">
                  <h2>A small QA workflow you can inspect</h2>
                  <p>
                    Next.js and TypeScript provide the interface. Apollo GraphQL connects sites,
                    durable scan jobs, findings, and owners. PostgreSQL stores the workflow; the
                    local demo uses embedded PGlite.
                  </p>
                  <h3>What a scan checks</h3>
                  <p>
                    HTTP errors, missing page titles and descriptions, document language, heading
                    structure, missing image alt attributes, and insecure resources in returned
                    HTML. These are focused checks, not a complete accessibility audit or browser
                    performance report.
                  </p>
                  <h3>Try the complete flow</h3>
                  <ol>
                    <li>Run a sample scan from a website card.</li>
                    <li>Open a finding and read its evidence.</li>
                    <li>Assign an owner, set a status, and save a note.</li>
                    <li>Run another scan: your triage remains intact.</li>
                    <li>Switch to Viewer to try read-only permissions.</li>
                  </ol>
                  <h3>Sample and live modes</h3>
                  <p>
                    Sample sites run against local HTML fixtures, so the demo needs no third-party
                    accounts. Live mode is {live ? 'enabled' : 'disabled'} on this server. Public
                    scans have page, time, response-size, origin, and network-address limits.
                  </p>
                  <h3>Honest boundaries</h3>
                  <p>
                    The cookie isolates demo workspaces, but this is not authenticated multi-tenant
                    software. Add real sign-in, trusted membership checks, and abuse controls before
                    a public production deployment. JavaScript is not executed; response timings are
                    not Core Web Vitals.
                  </p>
                </section>
              )}
              <footer>
                <span>
                  <Check size={14} /> {data.storageMode} persistence
                </span>
                <span>Inspect / Website QA Dashboard</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Issue details"
            className="drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" aria-label="Close issue" onClick={() => setSelected(null)}>
              <X size={20} />
            </button>
            <div className="eyebrow">ISSUE DETAILS</div>
            <h2>{selected.title}</h2>
            <p className="break">{selected.pageUrl}</p>
            <span className={`priority ${selected.severity.toLowerCase()}`}>
              {selected.severity.toLowerCase()} priority
            </span>
            <h3>Evidence</h3>
            <pre>{selected.evidence}</pre>
            <h3>Recommendation</h3>
            <p>{selected.recommendation}</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await mutate(
                    'mutation Triage($id: ID!, $input: TriageInput!) { updateIssue(id: $id, input: $input) { id status note } }',
                    {
                      id: selected.id,
                      input: {
                        status: selected.status,
                        assigneeId: selected.assigneeId,
                        note: selected.note,
                      },
                    },
                  )
                )
                  setSelected(null);
              }}
            >
              <label>
                Status
                <select
                  value={selected.status}
                  disabled={role === 'VIEWER'}
                  onChange={(e) =>
                    setSelected({ ...selected, status: e.target.value as IssueStatus })
                  }
                >
                  {Object.entries(labels).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <select
                  value={selected.assigneeId ?? ''}
                  disabled={role === 'VIEWER'}
                  onChange={(e) => setSelected({ ...selected, assigneeId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {data?.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review note
                <textarea
                  maxLength={500}
                  rows={4}
                  value={selected.note}
                  disabled={role === 'VIEWER'}
                  onChange={(e) => setSelected({ ...selected, note: e.target.value })}
                />
              </label>
              <button className="primary" disabled={busy || role === 'VIEWER'}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </section>
        </div>
      )}
      {adding && (
        <div className="overlay">
          <section role="dialog" aria-modal="true" aria-label="Add website" className="modal">
            <button
              className="close"
              aria-label="Close add website"
              onClick={() => setAdding(false)}
            >
              <X size={20} />
            </button>
            <h2>Add a website</h2>
            <p>Use a .example address for an offline sample.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await mutate(
                    'mutation Add($input: SiteInput!) { addSite(input: $input) { id } }',
                    { input: { name: f.get('name'), url: f.get('url'), mode: f.get('mode') } },
                  )
                )
                  setAdding(false);
              }}
            >
              <label>
                Name
                <input name="name" required maxLength={80} placeholder="My portfolio" />
              </label>
              <label>
                Website URL
                <input name="url" type="url" required placeholder="https://portfolio.example" />
              </label>
              <label>
                Scan mode
                <select name="mode">
                  <option value="DEMO">Offline sample</option>
                  {live && <option value="LIVE">Live public website</option>}
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Add website
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
