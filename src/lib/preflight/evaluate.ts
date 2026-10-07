import { createHash } from 'node:crypto';
import { z } from 'zod';
import { POLICY_VERSION, type Gate, type Observation, type PreflightResult } from './model';
const common = {
  schema_version: z.literal(1),
  page: z.literal('/workshop'),
  consent: z.boolean(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
};
const eventSchema = z.discriminatedUnion('name', [
  z.object({ ...common, name: z.literal('page_view') }).strict(),
  z
    .object({ ...common, name: z.literal('form_submit'), form_id: z.literal('workshop-signup') })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('conversion'),
      form_id: z.literal('workshop-signup'),
      conversion_id: z.string().min(1).max(80),
      value: z.number().nonnegative().finite(),
      currency: z.literal('USD'),
    })
    .strict(),
]);
export function evaluateEvidence(
  timeline: Observation[],
): Pick<PreflightResult, 'verdict' | 'gates' | 'evidenceHash'> {
  const events = timeline.filter((x) => x.kind === 'EVENT');
  const parsed = events.map((event) => {
    try {
      const payload: unknown = JSON.parse(event.payload);
      return {
        event,
        result: eventSchema.safeParse(payload),
        payload:
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : {},
      };
    } catch {
      return { event, result: null, payload: {} as Record<string, unknown> };
    }
  });
  const invalid = parsed.filter(
    (x) =>
      !x.result?.success ||
      x.payload.consent !== x.event.consent ||
      x.payload.name !== x.event.name,
  );
  const missing = parsed.filter(
    ({ payload }) =>
      payload.utm_source !== 'demo' ||
      payload.utm_medium !== 'email' ||
      payload.utm_campaign !== 'autumn-workshop',
  );
  const enabled = events.filter((x) => x.consent);
  const conversions = enabled.filter((x) => x.name === 'conversion');
  const denied = events.filter((x) => !x.consent);
  const sequence = enabled.map((x) => x.name);
  const workflow = ['page_view', 'form_submit', 'conversion'];
  const actions = [true, false].every((consent) =>
    ['Page loaded', 'Form submitted'].every((name) =>
      timeline.some((x) => x.kind === 'ACTION' && x.name === name && x.consent === consent),
    ),
  );
  const gates: Gate[] = [
    {
      id: 'journey',
      title: 'Both consent journeys completed',
      passed: actions,
      evidence: actions
        ? 'The browser loaded and submitted the form with consent enabled and disabled.'
        : 'A required browser action was not observed. This evidence is incomplete.',
      sequences: timeline.filter((x) => x.kind === 'ACTION').map((x) => x.sequence),
    },
    {
      id: 'schema',
      title: 'Event payloads match the contract',
      passed: events.length > 0 && invalid.length === 0,
      evidence: invalid.length
        ? invalid
            .map(
              (x) =>
                `#${x.event.sequence} ${x.result?.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') || 'Payload does not match the observed event or consent state'}`,
            )
            .join(' | ')
        : events.length
          ? 'All observed payloads match schema version 1.'
          : 'No event payloads were observed.',
      sequences: invalid.length
        ? invalid.map((x) => x.event.sequence)
        : events.map((x) => x.sequence),
    },
    {
      id: 'campaign',
      title: 'Campaign attribution survives the journey',
      passed: events.length > 0 && missing.length === 0,
      evidence: missing.length
        ? `${missing.length} payloads are missing or changing the expected utm_source, utm_medium, or utm_campaign.`
        : events.length
          ? 'Expected demo / email / autumn-workshop values are present on every observed event.'
          : 'No campaign-bearing events were observed.',
      sequences: missing.map((x) => x.event.sequence),
    },
    {
      id: 'conversion',
      title: 'One conversion per submission',
      passed: conversions.length === 1,
      evidence: `Consent-enabled journey: ${conversions.length} conversion requests for one form submission. Expected exactly one.`,
      sequences: conversions.map((x) => x.sequence),
    },
    {
      id: 'order',
      title: 'Page → form → conversion event order',
      passed: sequence.join(',') === workflow.join(','),
      evidence: `Observed with consent enabled: ${sequence.join(' → ') || 'no events'}.`,
      sequences: enabled.map((x) => x.sequence),
    },
    {
      id: 'consent',
      title: 'No analytics when consent is disabled',
      passed: denied.length === 0 && actions,
      evidence: denied.length
        ? `${denied.length} analytics requests were attempted with consent disabled.`
        : 'No analytics requests observed during the completed consent-disabled journey.',
      sequences: denied.map((x) => x.sequence),
    },
  ];
  return {
    verdict: gates.every((g) => g.passed) ? 'READY' : 'BLOCKED',
    gates,
    evidenceHash: createHash('sha256')
      .update(
        JSON.stringify({
          policy: POLICY_VERSION,
          timeline: timeline.map(({ elapsedMs, ...rest }) => rest),
        }),
      )
      .digest('hex'),
  };
}
