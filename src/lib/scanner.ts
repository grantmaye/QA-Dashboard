import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { type Finding, type ScanResult, type Transport } from './model';
import { validateUrl } from './transport';

export function finding(
  rule: string,
  severity: Finding['severity'],
  title: string,
  pageUrl: string,
  target: string,
  evidence: string,
  recommendation: string,
): Finding {
  return {
    fingerprint: createHash('sha256')
      .update([rule, pageUrl, target].join('\n'))
      .digest('hex')
      .slice(0, 24),
    rule,
    severity,
    title,
    pageUrl,
    target,
    evidence: evidence.slice(0, 300),
    recommendation,
  };
}
export function inspectHtml(html: string, pageUrl: string) {
  const $ = load(html);
  const findings: Finding[] = [];
  const add = (
    rule: string,
    severity: Finding['severity'],
    title: string,
    target: string,
    evidence: string,
    recommendation: string,
  ) => findings.push(finding(rule, severity, title, pageUrl, target, evidence, recommendation));
  const title = $('title').first().text().trim();
  if (!title)
    add(
      'MISSING_TITLE',
      'MEDIUM',
      'Page title is missing',
      'document',
      'No non-empty <title> found.',
      'Give this page a descriptive, unique title.',
    );
  if (!$('meta[name="description" i]').attr('content')?.trim())
    add(
      'MISSING_DESCRIPTION',
      'LOW',
      'Meta description is missing',
      'document',
      'No non-empty description meta tag found.',
      'Write a concise description that reflects the page content.',
    );
  if (!$('html').attr('lang')?.trim())
    add(
      'MISSING_LANGUAGE',
      'MEDIUM',
      'Document language is not declared',
      'document',
      'The html element has no lang value.',
      'Set the correct language on the html element.',
    );
  if ($('h1').length !== 1)
    add(
      'H1_STRUCTURE',
      'LOW',
      'Review the main heading',
      'document',
      `${$('h1').length} h1 elements found.`,
      'Review the heading structure. One descriptive main heading is a useful editorial convention, not a standalone accessibility conformance test.',
    );
  $('img').each((index, el) => {
    if ($(el).attr('alt') === undefined)
      add(
        'MISSING_ALT',
        'MEDIUM',
        'Image has no alt attribute',
        $(el).attr('src') || `image-${index}`,
        $.html(el),
        'Add meaningful alternative text, or alt="" for a decorative image.',
      );
  });
  if (new URL(pageUrl).protocol === 'https:')
    $('[src]').each((_, el) => {
      const src = $(el).attr('src')!;
      if (src.startsWith('http:'))
        add(
          'INSECURE_RESOURCE',
          'HIGH',
          'Insecure resource on HTTPS page',
          src,
          src,
          'Serve this resource over HTTPS.',
        );
    });
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    try {
      const url = new URL($(el).attr('href')!, pageUrl);
      url.hash = '';
      if (
        url.origin === new URL(pageUrl).origin &&
        ['http:', 'https:'].includes(url.protocol) &&
        !url.search
      )
        links.push(url.href);
    } catch {}
  });
  return { title, findings, links: [...new Set(links)].sort() };
}

export async function scanWebsite(input: string, transport: Transport): Promise<ScanResult> {
  const root = validateUrl(input);
  const queue = [root.href];
  const visited = new Set<string>();
  const result: ScanResult = {
    pages: [],
    findings: [],
    warnings: [],
    coverage: '',
    newCount: 0,
    recurringCount: 0,
    notObservedCount: 0,
  };
  const started = Date.now();
  const robotsUrl = new URL('/robots.txt', root).href;
  const response = await transport(robotsUrl, root.origin);
  if (response.status !== 404 && response.status >= 400)
    throw new Error('Could not safely read robots.txt.');
  const robots = robotsParser(robotsUrl, response.status === 404 ? '' : response.html);
  // Sequential crawling deliberately limits pressure on a small business website.
  while (queue.length && visited.size < 8 && Date.now() - started < 35000) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      if (robots.isAllowed(url, 'QA-Dashboard') === false) {
        result.warnings.push(`${url}: excluded by robots.txt`);
        continue;
      }
      const response = await transport(url, root.origin);
      result.pages.push({
        url,
        status: response.status,
        title: '',
        durationMs: response.durationMs,
      });
      if (response.status >= 400) {
        result.findings.push(
          finding(
            'HTTP_ERROR',
            response.status >= 500 ? 'HIGH' : 'MEDIUM',
            `Page returns HTTP ${response.status}`,
            url,
            url,
            `GET returned ${response.status}.`,
            'Restore the page, correct links to it, or redirect it to a relevant replacement.',
          ),
        );
        continue;
      }
      if (!response.contentType.includes('text/html')) continue;
      const inspected = inspectHtml(response.html, response.url);
      result.pages[result.pages.length - 1].title = inspected.title;
      result.findings.push(...inspected.findings);
      for (const link of inspected.links)
        if (!visited.has(link) && !queue.includes(link) && queue.length < 32) queue.push(link);
    } catch (error) {
      result.warnings.push(`${url}: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  }
  result.findings = [...new Map(result.findings.map((f) => [f.fingerprint, f])).values()].slice(
    0,
    200,
  );
  if (queue.length)
    result.warnings.push('Crawl budget reached. Some discovered pages were not checked.');
  if (!result.pages.length) throw new Error(result.warnings[0] || 'No pages could be fetched.');
  result.coverage = `${result.pages.length} URLs checked. Maximum 8 URLs; same-origin, query-free links only. HTML response checks; JavaScript is not rendered.`;
  return result;
}
