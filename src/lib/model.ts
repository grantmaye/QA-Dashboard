export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'IGNORED';
export type Role = 'OWNER' | 'MEMBER' | 'VIEWER';
export type Finding = {
  fingerprint: string;
  rule: string;
  severity: Severity;
  title: string;
  pageUrl: string;
  target: string;
  evidence: string;
  recommendation: string;
};
export type PageResult = { url: string; status: number; title: string; durationMs: number };
export type ScanResult = {
  pages: PageResult[];
  findings: Finding[];
  warnings: string[];
  coverage: string;
  newCount: number;
  recurringCount: number;
  notObservedCount: number;
};
export type Site = {
  id: string;
  name: string;
  url: string;
  mode: 'DEMO' | 'LIVE';
  createdAt: string;
};
export type Scan = {
  id: string;
  siteId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  result: ScanResult | null;
  error: string | null;
  attempt: number;
};
export type Issue = Finding & {
  id: string;
  siteId: string;
  status: IssueStatus;
  assigneeId: string | null;
  firstSeen: string;
  lastSeen: string;
  note: string;
};
export type Member = { id: string; name: string; initials: string };
export type Dashboard = {
  sites: Site[];
  scans: Scan[];
  issues: Issue[];
  members: Member[];
  storageMode: string;
};
export type TransportResponse = {
  url: string;
  status: number;
  html: string;
  contentType: string;
  durationMs: number;
};
export type Transport = (url: string, origin: string) => Promise<TransportResponse>;
export class QaError extends Error {
  constructor(
    message: string,
    public code = 'BAD_USER_INPUT',
  ) {
    super(message);
  }
}
