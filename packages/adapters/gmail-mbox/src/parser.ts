/**
 * Streaming mbox parser.
 *
 * mbox format: one file, many messages. Each message begins with a line
 * starting with `From ` (space, not colon). Following lines are RFC 822:
 * header block, blank line, body. `>From ` escapes inside the body are
 * conventional but optional.
 *
 * We parse with a line-oriented state machine to avoid loading the whole
 * archive into memory. Returns an async generator of `ParsedMessage`.
 *
 * What this parser does NOT handle (v1 scope):
 *   - MIME multipart (attachments, HTML/plain alternatives)
 *   - quoted-printable or base64 body decoding beyond trivial ASCII
 *   - RFC 2047 encoded-word headers (utf-8 subjects get partially garbled)
 * These land in W9-10 with the google-drive-folder adapter, which needs
 * full MIME handling anyway.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';

export interface ParsedMessage {
  headers: Record<string, string>;
  /** Addresses are preserved verbatim — parsing them is the adapter's job. */
  body: string;
  /** Byte offset in the source archive (for citation). */
  byteOffset: number;
}

export async function* parseMbox(path: string): AsyncIterable<ParsedMessage> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let state: 'before' | 'headers' | 'body' = 'before';
  let headers: Record<string, string> = {};
  let bodyLines: string[] = [];
  let lastHeaderName: string | null = null;
  let byteOffset = 0;
  let messageStart = 0;

  const flush = (): ParsedMessage | null => {
    if (state === 'before' || Object.keys(headers).length === 0) return null;
    return {
      headers,
      body: bodyLines.join('\n'),
      byteOffset: messageStart,
    };
  };

  for await (const line of rl) {
    // Track approximate byte position for citations (UTF-8 is a lower bound).
    const lineLen = Buffer.byteLength(line, 'utf8') + 1;

    if (line.startsWith('From ')) {
      // Start of a new message. Flush the previous one if any.
      const done = flush();
      if (done) yield done;
      state = 'headers';
      headers = {};
      bodyLines = [];
      lastHeaderName = null;
      messageStart = byteOffset;
      byteOffset += lineLen;
      continue;
    }

    if (state === 'before') {
      byteOffset += lineLen;
      continue;
    }

    if (state === 'headers') {
      if (line === '') {
        state = 'body';
        byteOffset += lineLen;
        continue;
      }
      // Continuation line: starts with whitespace.
      if (/^[ \t]/.test(line) && lastHeaderName) {
        headers[lastHeaderName] = `${headers[lastHeaderName]} ${line.trim()}`;
        byteOffset += lineLen;
        continue;
      }
      const colonIx = line.indexOf(':');
      if (colonIx > 0) {
        const name = line.slice(0, colonIx).toLowerCase();
        const value = line.slice(colonIx + 1).trim();
        headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
        lastHeaderName = name;
      }
      byteOffset += lineLen;
      continue;
    }

    // state === 'body'
    // Strip mbox's conventional `>From ` escape.
    bodyLines.push(line.startsWith('>From ') ? line.slice(1) : line);
    byteOffset += lineLen;
  }

  const final = flush();
  if (final) yield final;
}

// ─── Address extraction ─────────────────────────────────────────────────────

const ADDR_RE = /(?:"?([^"<]*)"?\s*)?<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/gi;

export interface ParsedAddress {
  name?: string;
  address: string;
}

/** Parse a comma-separated address list (`To`, `Cc`, `Bcc` headers). */
export function parseAddresses(header: string | undefined): ParsedAddress[] {
  if (!header) return [];
  const out: ParsedAddress[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = ADDR_RE.exec(header)) !== null) {
    const address = match[2]?.toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const name = match[1]?.trim();
    out.push(name ? { name, address } : { address });
  }
  ADDR_RE.lastIndex = 0;
  return out;
}

/** Parse message-id references (`In-Reply-To`, `References`). */
export function parseMessageIds(header: string | undefined): string[] {
  if (!header) return [];
  const re = /<([^>]+)>/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(header)) !== null) {
    const id = match[1];
    if (id) ids.push(id);
  }
  return ids;
}

/** Parse an RFC 822 date to ISO 8601. Falls back to the input if unparseable. */
export function parseDate(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const d = new Date(header);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
