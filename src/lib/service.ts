import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Sql } from './database';
import {
  QaError,
  type Dashboard,
  type Issue,
  type Member,
  type Role,
  type Scan,
  type ScanResult,
  type Site,
  type Transport,
} from './model';
import { validateUrl, publicTransport } from './transport';
import { scanWebsite } from './scanner';
import { demoTransport } from './fixtures';
const scanSelect = `id,site_id AS "siteId",status,created_at::text AS "createdAt",completed_at::text AS "completedAt",result,error,attempt`;
export function requireEditor(role: Role) {
  if (role === 'VIEWER')
    throw new QaError('Viewer mode cannot change sites, scans, or issues.', 'FORBIDDEN');
}
async function siteFor(tx: Sql, workspace: string, id: string) {
  const rows = await tx.query<{ data: Site }>(
    'SELECT data FROM sites WHERE workspace_id=$1 AND id=$2',
    [workspace, id],
  );
  if (!rows[0]) throw new QaError('Site not found in this workspace.', 'NOT_FOUND');
  return rows[0].data;
}
export class QaService {
  constructor(
    public db: Database,
    private liveTransport: Transport = publicTransport,
  ) {}
  async initialize(workspace: string) {
    await this.db.transaction(async (tx) => {
      const created = await tx.query(
        'INSERT INTO workspaces(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
        [workspace],
      );
      if (!created.length) return;
      for (const m of [
        { id: 'grant', name: 'Grant Maye', initials: 'GM' },
        { id: 'alex', name: 'Alex Chen', initials: 'AC' },
        { id: 'jordan', name: 'Jordan Ellis', initials: 'JE' },
      ])
        await tx.query('INSERT INTO members(workspace_id,id,name,initials) VALUES($1,$2,$3,$4)', [
          workspace,
          m.id,
          m.name,
          m.initials,
        ]);
      for (const [index, name] of [
        'Northstar Studio',
        'Fieldwork Supply',
        'Juniper House',
      ].entries()) {
        const id = ['northstar', 'fieldwork', 'juniper'][index];
        const site: Site = {
          id,
          name,
          url: `https://${id}.example/`,
          mode: 'DEMO',
          createdAt: new Date().toISOString(),
        };
        await tx.query('INSERT INTO sites(workspace_id,id,data) VALUES($1,$2,$3::jsonb)', [
          workspace,
          id,
          JSON.stringify(site),
        ]);
        const result = await scanWebsite(site.url, demoTransport);
        result.newCount = result.findings.length;
        const previous = {
          ...result,
          findings: result.findings.slice(2),
          newCount: result.findings.length - 2,
        };
        await tx.query(
          "INSERT INTO scans(workspace_id,id,site_id,status,created_at,completed_at,result,attempt) VALUES($1,$2,$3,'COMPLETED',now()-interval '1 day',now()-interval '1 day',$4::jsonb,1)",
          [workspace, `${id}-previous`, id, JSON.stringify(previous)],
        );
        result.newCount = 2;
        result.recurringCount = result.findings.length - 2;
        await tx.query(
          "INSERT INTO scans(workspace_id,id,site_id,status,completed_at,result,attempt) VALUES($1,$2,$3,'COMPLETED',now(),$4::jsonb,1)",
          [workspace, `${id}-latest`, id, JSON.stringify(result)],
        );
        for (const [i, f] of result.findings.entries()) {
          const issue: Issue = {
            ...f,
            id: randomUUID(),
            siteId: id,
            status: i === 2 ? 'IN_PROGRESS' : 'OPEN',
            assigneeId: ['grant', 'alex', 'jordan'][i % 3],
            firstSeen: new Date(Date.now() - 86400000).toISOString(),
            lastSeen: new Date().toISOString(),
            note: '',
          };
          await tx.query(
            'INSERT INTO issues(workspace_id,id,site_id,fingerprint,data) VALUES($1,$2,$3,$4,$5::jsonb)',
            [workspace, issue.id, id, f.fingerprint, JSON.stringify(issue)],
          );
        }
      }
    });
  }
  async dashboard(workspace: string): Promise<Dashboard> {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
      return {
        sites: (
          await tx.query<{ data: Site }>(
            'SELECT data FROM sites WHERE workspace_id=$1 ORDER BY id',
            [workspace],
          )
        ).map((r) => r.data),
        scans: await tx.query<Scan>(
          `SELECT ${scanSelect} FROM scans WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 100`,
          [workspace],
        ),
        issues: (
          await tx.query<{ data: Issue }>(
            'SELECT data FROM issues WHERE workspace_id=$1 ORDER BY id',
            [workspace],
          )
        ).map((r) => r.data),
        members: await tx.query<Member>(
          'SELECT id,name,initials FROM members WHERE workspace_id=$1 ORDER BY id',
          [workspace],
        ),
        storageMode: this.db.mode,
      };
    });
  }
  async addSite(workspace: string, role: Role, input: unknown) {
    requireEditor(role);
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(60),
        url: z.string().max(500),
        mode: z.enum(['DEMO', 'LIVE']),
      })
      .safeParse(input);
    if (!parsed.success) throw new QaError('Provide a site name, valid URL, and scan mode.');
    const url = validateUrl(parsed.data.url);
    if (parsed.data.mode === 'LIVE' && process.env.ENABLE_LIVE_SCANS !== 'true')
      throw new QaError(
        'Live scans are disabled. Set ENABLE_LIVE_SCANS=true on the server to enable them.',
      );
    if (parsed.data.mode === 'DEMO' && !url.hostname.endsWith('.example'))
      throw new QaError('Sample sites use a fictional .example address.');
    const site: Site = {
      ...parsed.data,
      url: url.href,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
      const [{ count }] = await tx.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM sites WHERE workspace_id=$1',
        [workspace],
      );
      if (count >= 10) throw new QaError('This demo supports up to 10 sites.');
      await tx.query('INSERT INTO sites(workspace_id,id,data) VALUES($1,$2,$3::jsonb)', [
        workspace,
        site.id,
        JSON.stringify(site),
      ]);
      return site;
    });
  }
  async enqueue(workspace: string, role: Role, siteId: string) {
    requireEditor(role);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
      const site = await siteFor(tx, workspace, siteId);
      if (site.mode === 'LIVE' && process.env.ENABLE_LIVE_SCANS !== 'true')
        throw new QaError('Live scanning is disabled on this server.');
      const active = await tx.query<Scan>(
        `SELECT ${scanSelect} FROM scans WHERE workspace_id=$1 AND site_id=$2 AND status IN ('QUEUED','RUNNING')`,
        [workspace, siteId],
      );
      if (active.length) return active[0];
      const id = randomUUID();
      return (
        await tx.query<Scan>(
          `INSERT INTO scans(workspace_id,id,site_id,status) VALUES($1,$2,$3,'QUEUED') RETURNING ${scanSelect}`,
          [workspace, id, siteId],
        )
      )[0];
    });
  }
  async runOne(workspace?: string) {
    const job = await this.db.transaction(async (tx) => {
      // Only expired leases are retried. The attempt number fences stale workers.
      await tx.query(
        "UPDATE scans SET status='FAILED',error='Worker lease expired after three attempts.',completed_at=now() WHERE status='RUNNING' AND lease_until<now() AND attempt>=3",
      );
      const rows = await tx.query<Scan & { workspace: string }>(
        `SELECT ${scanSelect},workspace_id AS workspace FROM scans WHERE (status='QUEUED' OR (status='RUNNING' AND lease_until<now() AND attempt<3)) ${workspace ? 'AND workspace_id=$1' : ''} ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        workspace ? [workspace] : [],
      );
      if (!rows.length) return null;
      const job = rows[0];
      await tx.query(
        "UPDATE scans SET status='RUNNING',attempt=attempt+1,lease_until=now()+interval '2 minutes',error=null WHERE workspace_id=$1 AND id=$2",
        [job.workspace, job.id],
      );
      return { ...job, attempt: job.attempt + 1 };
    });
    if (!job) return false;
    try {
      const site = await siteFor(this.db, job.workspace, job.siteId);
      if (site.mode === 'LIVE' && process.env.ENABLE_LIVE_SCANS !== 'true')
        throw new QaError('Live scans are disabled.');
      const result = await scanWebsite(
        site.url,
        site.mode === 'DEMO' ? demoTransport : this.liveTransport,
      );
      await this.complete(job.workspace, job.id, job.attempt, result);
    } catch (error) {
      await this.db.query(
        "UPDATE scans SET status='FAILED',error=$4,completed_at=now(),lease_until=null WHERE workspace_id=$1 AND id=$2 AND attempt=$3 AND status='RUNNING'",
        [
          job.workspace,
          job.id,
          job.attempt,
          error instanceof Error ? error.message : 'Scan failed.',
        ],
      );
    }
    return true;
  }
  async complete(workspace: string, id: string, attempt: number, result: ScanResult) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
      const [scan] = await tx.query<Scan>(
        `SELECT ${scanSelect} FROM scans WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [workspace, id],
      );
      if (!scan || scan.status !== 'RUNNING' || scan.attempt !== attempt) return;
      const previous = await tx.query<{ result: ScanResult }>(
        "SELECT result FROM scans WHERE workspace_id=$1 AND site_id=$2 AND status='COMPLETED' ORDER BY completed_at DESC LIMIT 1",
        [workspace, scan.siteId],
      );
      const before = new Set(previous[0]?.result.findings.map((f) => f.fingerprint) ?? []);
      const current = new Set(result.findings.map((f) => f.fingerprint));
      result.newCount = [...current].filter((f) => !before.has(f)).length;
      result.recurringCount = [...current].filter((f) => before.has(f)).length;
      result.notObservedCount = [...before].filter((f) => !current.has(f)).length;
      for (const f of result.findings) {
        const [existing] = await tx.query<{ data: Issue }>(
          'SELECT data FROM issues WHERE workspace_id=$1 AND site_id=$2 AND fingerprint=$3',
          [workspace, scan.siteId, f.fingerprint],
        );
        const issue: Issue = {
          ...f,
          id: existing?.data.id ?? randomUUID(),
          siteId: scan.siteId,
          status: existing?.data.status ?? 'OPEN',
          assigneeId: existing?.data.assigneeId ?? null,
          firstSeen: existing?.data.firstSeen ?? new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          note: existing?.data.note ?? '',
        };
        await tx.query(
          'INSERT INTO issues(workspace_id,id,site_id,fingerprint,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(workspace_id,site_id,fingerprint) DO UPDATE SET data=excluded.data',
          [workspace, issue.id, scan.siteId, f.fingerprint, JSON.stringify(issue)],
        );
      }
      await tx.query(
        "UPDATE scans SET status='COMPLETED',result=$3::jsonb,completed_at=now(),lease_until=null WHERE workspace_id=$1 AND id=$2",
        [workspace, id, JSON.stringify(result)],
      );
      await tx.query(
        `DELETE FROM scans WHERE workspace_id=$1 AND site_id=$2 AND status IN ('COMPLETED','FAILED') AND id NOT IN (SELECT id FROM scans WHERE workspace_id=$1 AND site_id=$2 ORDER BY created_at DESC,id LIMIT 30)`,
        [workspace, scan.siteId],
      );
    });
  }
  async triage(workspace: string, role: Role, id: string, input: unknown) {
    requireEditor(role);
    const parsed = z
      .object({
        status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED']),
        assigneeId: z.string().nullable(),
        note: z.string().max(500),
      })
      .safeParse(input);
    if (!parsed.success) throw new QaError('Invalid issue update.');
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
      const [row] = await tx.query<{ data: Issue }>(
        'SELECT data FROM issues WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
        [workspace, id],
      );
      if (!row) throw new QaError('Issue not found.', 'NOT_FOUND');
      if (parsed.data.assigneeId) {
        const members = await tx.query('SELECT id FROM members WHERE workspace_id=$1 AND id=$2', [
          workspace,
          parsed.data.assigneeId,
        ]);
        if (!members.length) throw new QaError('Assignee does not belong to this workspace.');
      }
      const issue = { ...row.data, ...parsed.data };
      await tx.query('UPDATE issues SET data=$3::jsonb WHERE workspace_id=$1 AND id=$2', [
        workspace,
        id,
        JSON.stringify(issue),
      ]);
      return issue;
    });
  }
}
