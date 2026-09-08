import type { Database } from './database';
export async function migrate(db: Database) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS workspaces(id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS members(workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,id text,name text NOT NULL,initials text NOT NULL,PRIMARY KEY(workspace_id,id))`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS sites(workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,id text,data jsonb NOT NULL,PRIMARY KEY(workspace_id,id))`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS scans(workspace_id text NOT NULL, id text, site_id text NOT NULL, status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, lease_until timestamptz, attempt integer NOT NULL DEFAULT 0, result jsonb, error text, PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id) ON DELETE CASCADE)`,
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS one_active_scan ON scans(workspace_id,site_id) WHERE status IN ('QUEUED','RUNNING')`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS issues(workspace_id text NOT NULL,id text,site_id text NOT NULL,fingerprint text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,site_id,fingerprint),FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id) ON DELETE CASCADE)`,
  );
  await db.query(`CREATE INDEX IF NOT EXISTS scans_queue ON scans(status,created_at)`);
}
