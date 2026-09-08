import { ApolloServer } from '@apollo/server';
import { GraphQLError, type ValidationContext, type ASTVisitor } from 'graphql';
import DataLoader from 'dataloader';
import type { QaService } from './service';
import { QaError, type Issue, type Member, type Role } from './model';
export const typeDefs = `#graphql
  enum Role { OWNER MEMBER VIEWER }
  enum Severity { HIGH MEDIUM LOW }
  enum IssueStatus { OPEN IN_PROGRESS RESOLVED IGNORED }
  enum SiteMode { DEMO LIVE }
  enum ScanStatus { QUEUED RUNNING COMPLETED FAILED }
  type Member { id: ID!, name: String!, initials: String! }
  type Site { id: ID!, name: String!, url: String!, mode: SiteMode!, createdAt: String! }
  type Finding { fingerprint: ID!, rule: String!, severity: Severity!, title: String!, pageUrl: String!, target: String!, evidence: String!, recommendation: String! }
  type PageResult { url: String!, status: Int!, title: String!, durationMs: Int! }
  type ScanResult { pages: [PageResult!]!, findings: [Finding!]!, warnings: [String!]!, coverage: String!, newCount: Int!, recurringCount: Int!, notObservedCount: Int! }
  type Scan { id: ID!, siteId: ID!, status: ScanStatus!, createdAt: String!, completedAt: String, result: ScanResult, error: String, attempt: Int! }
  type Issue { id: ID!, siteId: ID!, fingerprint: ID!, rule: String!, severity: Severity!, title: String!, pageUrl: String!, target: String!, evidence: String!, recommendation: String!, status: IssueStatus!, assigneeId: ID, assignee: Member, firstSeen: String!, lastSeen: String!, note: String! }
  type Dashboard { sites: [Site!]!, scans: [Scan!]!, issues: [Issue!]!, members: [Member!]!, storageMode: String! }
  type IssueEdge { cursor: String!, node: Issue! }
  type PageInfo { endCursor: String, hasNextPage: Boolean! }
  type IssueConnection { edges: [IssueEdge!]!, pageInfo: PageInfo! }
  type Query { dashboard: Dashboard!, issues(first: Int = 20, after: String, siteId: ID): IssueConnection!, currentRole: Role!, liveScansEnabled: Boolean! }
  input SiteInput { name: String!, url: String!, mode: SiteMode! }
  input TriageInput { status: IssueStatus!, assigneeId: ID, note: String! }
  type Mutation { addSite(input: SiteInput!): Site!, startScan(siteId: ID!): Scan!, updateIssue(id: ID!, input: TriageInput!): Issue! }
`;
export type Context = {
  service: QaService;
  workspace: string;
  role: Role;
  members: DataLoader<string, Member | null>;
  metrics: { memberQueries: number };
  naive: boolean;
};
export function contextFor(
  service: QaService,
  workspace: string,
  role: Role = 'OWNER',
  naive = false,
): Context {
  const metrics = { memberQueries: 0 };
  const members = new DataLoader<string, Member | null>(async (ids) => {
    metrics.memberQueries++;
    const rows = await service.db.query<Member>(
      'SELECT id,name,initials FROM members WHERE workspace_id=$1 AND id=ANY($2::text[])',
      [workspace, [...ids]],
    );
    const byId = new Map(rows.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id) ?? null);
  });
  return { service, workspace, role, members, metrics, naive };
}
function budget(context: ValidationContext): ASTVisitor {
  let count = 0;
  return {
    Field(node) {
      if (++count === 301) context.reportError(new GraphQLError('Operation exceeds 300 fields.'));
    },
    FragmentDefinition(node) {
      context.reportError(new GraphQLError('Fragments are disabled in this demo.'));
    },
    OperationDefinition(node) {
      if (node.operation === 'mutation' && node.selectionSet.selections.length > 1)
        context.reportError(new GraphQLError('Send one mutation per request.'));
    },
  };
}
export function createApi() {
  return new ApolloServer<Context>({
    typeDefs,
    validationRules: [budget],
    includeStacktraceInErrorResponses: false,
    resolvers: {
      Query: {
        dashboard: (_: unknown, __: unknown, c: Context) => c.service.dashboard(c.workspace),
        currentRole: (_: unknown, __: unknown, c: Context) => c.role,
        liveScansEnabled: () => process.env.ENABLE_LIVE_SCANS === 'true',
        issues: async (
          _: unknown,
          { first = 20, after, siteId }: { first: number; after?: string; siteId?: string },
          c: Context,
        ) => {
          if (first < 1 || first > 50) throw new QaError('Page size must be between 1 and 50.');
          let cursor = '';
          if (after) {
            cursor = Buffer.from(after, 'base64url').toString('utf8');
            if (!/^[0-9a-f-]{36}$/i.test(cursor)) throw new QaError('Invalid issue cursor.');
          }
          const rows = await c.service.db.query<{ data: Issue }>(
            `SELECT data FROM issues WHERE workspace_id=$1 AND id>$2 ${siteId ? 'AND site_id=$4' : ''} ORDER BY id LIMIT $3`,
            siteId ? [c.workspace, cursor, first + 1, siteId] : [c.workspace, cursor, first + 1],
          );
          const edges = rows
            .slice(0, first)
            .map((r) => ({ node: r.data, cursor: Buffer.from(r.data.id).toString('base64url') }));
          return {
            edges,
            pageInfo: { endCursor: edges.at(-1)?.cursor ?? null, hasNextPage: rows.length > first },
          };
        },
      },
      Mutation: {
        addSite: (_: unknown, { input }: { input: unknown }, c: Context) =>
          c.service.addSite(c.workspace, c.role, input),
        startScan: (_: unknown, { siteId }: { siteId: string }, c: Context) =>
          c.service.enqueue(c.workspace, c.role, siteId),
        updateIssue: (_: unknown, { id, input }: { id: string; input: unknown }, c: Context) =>
          c.service.triage(c.workspace, c.role, id, input),
      },
      Issue: {
        assignee: async (issue: Issue, _: unknown, c: Context) => {
          if (!issue.assigneeId) return null;
          if (c.naive) {
            c.metrics.memberQueries++;
            return (
              (
                await c.service.db.query<Member>(
                  'SELECT id,name,initials FROM members WHERE workspace_id=$1 AND id=$2',
                  [c.workspace, issue.assigneeId],
                )
              )[0] ?? null
            );
          }
          return c.members.load(issue.assigneeId);
        },
      },
    },
    formatError: (formatted, error) => {
      const original = error instanceof GraphQLError ? error.originalError : null;
      if (original instanceof QaError) return { ...formatted, extensions: { code: original.code } };
      if (formatted.extensions?.code === 'INTERNAL_SERVER_ERROR') {
        console.error('Resolver failure', error);
        return {
          message: 'The operation failed. Please retry.',
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        };
      }
      return formatted;
    },
  });
}
