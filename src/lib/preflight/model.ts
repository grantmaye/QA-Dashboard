export const FIXTURE_VERSION = 'northstar-1';
export const POLICY_VERSION = 'campaign-1';
export type Variant = 'BROKEN' | 'FIXED';
export type PreflightInput = { variant: Variant; fixtureVersion: string; retryOf: string | null };
export type Observation = {
  sequence: number;
  elapsedMs: number;
  consent: boolean;
  kind: 'ACTION' | 'EVENT';
  name: string;
  payload: string;
};
export type Gate = {
  id: string;
  title: string;
  passed: boolean;
  evidence: string;
  sequences: number[];
};
export type PreflightResult = {
  verdict: 'BLOCKED' | 'READY';
  fixtureVersion: string;
  policyVersion: string;
  browserVersion: string;
  evidenceHash: string;
  durationMs: number;
  timeline: Observation[];
  gates: Gate[];
};
export type PreflightRun = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  attempt: number;
  input: PreflightInput;
  preflight: PreflightResult | null;
};
