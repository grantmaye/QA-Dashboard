import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { QaError, type Transport, type TransportResponse } from './model';

export function publicAddress(value: string): boolean {
  try {
    const address = ipaddr.process(value);
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}
export function validateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new QaError('Enter a valid HTTPS website URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new QaError('Use HTTP or HTTPS on a standard port, without credentials.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    (ipaddr.isValid(host) && !publicAddress(host))
  )
    throw new QaError('Only public website addresses can be scanned.');
  url.hash = '';
  return url;
}

export async function resolvePublic(hostname: string) {
  let timer: ReturnType<typeof setTimeout>;
  const records = await Promise.race([
    lookup(hostname.replace(/^\[|\]$/g, ''), { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS timeout.')), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!records.length || records.some((record) => !publicAddress(record.address)))
    throw new QaError('The website resolves to a private or reserved address.');
  return records;
}

// Resolve and pin every connection. Validating a hostname and then letting a second
// DNS lookup choose the socket address would leave a DNS-rebinding gap.
export const publicTransport: Transport = async (input, origin) => {
  let url = validateUrl(input);
  const started = Date.now();
  for (let hop = 0; hop <= 3; hop++) {
    if (url.origin !== origin)
      throw new QaError(
        'Cross-origin redirects are not followed. Use the final canonical website URL.',
      );
    if (Date.now() - started > 7000) throw new QaError('Redirect time budget reached.');
    const records = await resolvePublic(url.hostname);
    const record = records[0];
    const response = await new Promise<TransportResponse & { location?: string }>(
      (resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).get(
          url,
          {
            headers: {
              'User-Agent': 'QA-Dashboard/1.0 (bounded public-site quality check)',
              Accept: 'text/html, text/plain;q=0.8',
              'Accept-Encoding': 'identity',
            },
            lookup: (_hostname, options, callback) => {
              if (typeof options === 'object' && options.all) callback(null, [record]);
              else callback(null, record.address, record.family);
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on('data', (chunk) => {
              bytes += chunk.length;
              if (bytes > 1024 * 1024) {
                res.destroy(new Error('Response exceeds 1 MiB limit.'));
              } else chunks.push(Buffer.from(chunk));
            });
            res.on('error', reject);
            res.on('end', () =>
              resolve({
                url: url.href,
                status: res.statusCode ?? 0,
                html: Buffer.concat(chunks).toString('utf8'),
                contentType: String(res.headers['content-type'] ?? ''),
                durationMs: Date.now() - started,
                location: res.headers.location,
              }),
            );
          },
        );
        const timer = setTimeout(
          () => request.destroy(new Error('Request exceeded 5 seconds.')),
          5000,
        );
        request.on('close', () => clearTimeout(timer));
        request.on('error', reject);
      },
    );
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      url = validateUrl(new URL(response.location, url).href);
      continue;
    }
    return response;
  }
  throw new QaError('Too many redirects.');
};
