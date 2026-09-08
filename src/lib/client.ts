import type { Dashboard, Role } from './model';
export const workspaceQuery = `query Workspace { currentRole liveScansEnabled dashboard { storageMode sites { id name url mode createdAt } scans { id siteId status createdAt completedAt error attempt result { pages { url title status durationMs } findings { fingerprint } warnings coverage newCount recurringCount notObservedCount } } issues { id siteId fingerprint rule severity title pageUrl target evidence recommendation status assigneeId assignee { id name initials } firstSeen lastSeen note } members { id name initials } } }`;
export async function request<T>(
  query: string,
  variables: Record<string, unknown> = {},
  role: Role = 'OWNER',
): Promise<T> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Role': role },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors)
    throw new Error(result.errors?.[0]?.message || result.error || 'Request failed.');
  return result.data as T;
}
export const getWorkspace = (role: Role) =>
  request<{ dashboard: Dashboard; liveScansEnabled: boolean }>(workspaceQuery, {}, role);
