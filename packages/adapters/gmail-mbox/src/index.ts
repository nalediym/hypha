import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineAdapter, type AdapterEvent } from '@hypha/adapter-sdk';
import {
  edgeId,
  now as isoNow,
  nodeIdFromContent,
  nodeIdFromExternal,
  type Node,
  type NodeId,
} from '@hypha/core';
import { parseAddresses, parseDate, parseMbox, parseMessageIds, type ParsedMessage } from './parser.ts';
import {
  GmailMessageFacets,
  GmailThreadFacets,
  IdentityEmailFacets,
} from './schemas.ts';

export interface GmailMboxInputs {
  mbox_path: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(join(__dirname, '..', 'adapter.yaml'));

const ADAPTER_ID = 'gmail-mbox';

export const gmailMboxAdapter = defineAdapter<GmailMboxInputs>({
  manifestPath: MANIFEST_PATH,
  facetSchemas: {
    'gmail.message': GmailMessageFacets,
    'gmail.thread': GmailThreadFacets,
    'identity.email': IdentityEmailFacets,
  },
  async *ingest({ mbox_path }, ctx) {
    let scanned = 0;
    let emitted = 0;
    const seenIdentities = new Set<NodeId>();
    const seenThreads = new Set<NodeId>();

    for await (const parsed of parseMbox(mbox_path)) {
      scanned++;
      const events = [...emitMessage(parsed, seenIdentities, seenThreads)];
      for (const event of events) yield event;
      emitted += events.filter((e) => e.type === 'node').length;
      if (scanned % 100 === 0) {
        yield { type: 'progress', stream: 'messages', scanned, emitted };
      }
    }

    ctx.logger.info(`gmail-mbox: ingested ${scanned} messages → ${emitted} nodes`);
  },
});

export default gmailMboxAdapter;

// ─── Message → events ────────────────────────────────────────────────────────

function* emitMessage(
  msg: ParsedMessage,
  seenIdentities: Set<NodeId>,
  seenThreads: Set<NodeId>,
): Generator<AdapterEvent> {
  const messageId = msg.headers['message-id'] ?? `<synth-${msg.byteOffset}@hypha.local>`;
  const subject = msg.headers['subject'] ?? '(no subject)';
  const date = parseDate(msg.headers['date']) ?? isoNow();
  const from = parseAddresses(msg.headers['from']);
  const to = parseAddresses(msg.headers['to']);
  const cc = parseAddresses(msg.headers['cc']);
  const bcc = parseAddresses(msg.headers['bcc']);
  const inReplyTo = parseMessageIds(msg.headers['in-reply-to']);
  const references = parseMessageIds(msg.headers['references']);
  const threadHdr = msg.headers['x-gm-thrid'] ?? msg.headers['thread-index'] ?? null;
  const labels = (msg.headers['x-gmail-labels'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const messageNodeId = nodeIdFromContent(
    ADAPTER_ID,
    'gmail.message',
    `${messageId}|${subject}|${date}|${msg.body.slice(0, 512)}`,
  );

  const messageNode: Omit<Node, 'ingested_at'> = {
    id: messageNodeId,
    kind: 'gmail.message',
    at: date as Node['at'],
adapter: ADAPTER_ID,
    external_id: messageId,
    title: subject,
    body: msg.body,
    facets: {
      message_id: messageId,
      subject,
      from: from[0]?.address,
      to: to.map((a) => a.address),
      cc: cc.map((a) => a.address),
      bcc: bcc.map((a) => a.address),
      date,
      in_reply_to: inReplyTo[0],
      references,
      labels,
      thread_id: threadHdr ?? undefined,
      size_bytes: Buffer.byteLength(msg.body, 'utf8'),
    },
  };
  yield { type: 'node', node: messageNode };

  // identity.email nodes — use the address itself as the natural id.
  for (const addr of [...from, ...to, ...cc, ...bcc]) {
    const identityId = nodeIdFromExternal(ADAPTER_ID, 'identity.email', addr.address);
    if (!seenIdentities.has(identityId)) {
      seenIdentities.add(identityId);
      yield {
        type: 'node',
        node: {
          id: identityId,
          kind: 'identity.email',
          at: date as Node['at'],
            adapter: ADAPTER_ID,
          external_id: addr.address,
          title: addr.name ?? addr.address,
          facets: addr.name
            ? { address: addr.address, display_name: addr.name }
            : { address: addr.address },
        },
      };
    }
  }

  // sent_to / cc / bcc edges
  for (const addr of to) {
    yield makeEdge('sent_to', messageNodeId, addr.address, date);
  }
  for (const addr of cc) {
    yield makeEdge('cc', messageNodeId, addr.address, date);
  }
  for (const addr of bcc) {
    yield makeEdge('bcc', messageNodeId, addr.address, date);
  }

  // gmail.thread synthesis (single-message threads only if no explicit thrid).
  const threadExternal = threadHdr ?? messageId;
  const threadNodeId = nodeIdFromExternal(ADAPTER_ID, 'gmail.thread', threadExternal);
  if (!seenThreads.has(threadNodeId)) {
    seenThreads.add(threadNodeId);
    yield {
      type: 'node',
      node: {
        id: threadNodeId,
        kind: 'gmail.thread',
        at: date as Node['at'],
        adapter: ADAPTER_ID,
        external_id: threadExternal,
        title: subject,
        facets: { thread_id: threadExternal, subject },
      },
    };
  }
  yield {
    type: 'edge',
    edge: {
      id: edgeId('part_of_thread', messageNodeId, threadNodeId, date),
      kind: 'part_of_thread',
      from_id: messageNodeId,
      to_id: threadNodeId,
      at: date as Node['at'],
    },
  };

  // replied_to: message_id → parent via In-Reply-To
  if (inReplyTo[0]) {
    // We emit an edge pointing to a message id we may not have seen yet.
    // The runtime tolerates dangling edges; target resolution is lazy.
    const parentMessageId = inReplyTo[0];
    const parentNodeId = nodeIdFromContent(
      ADAPTER_ID,
      'gmail.message',
      `${parentMessageId}|?|?|?`, // best-effort; may not match the real parent node's hash
    );
    // Best-effort edge — real parent may differ. This is a known v1 limitation;
    // full thread-graph resolution lands in a later inferrer.
    yield {
      type: 'edge',
      edge: {
        id: edgeId('replied_to', messageNodeId, parentNodeId, date),
        kind: 'replied_to',
        from_id: messageNodeId,
        to_id: parentNodeId,
        at: date as Node['at'],
      },
    };
  }

  // Future: references → part_of_thread for all refs, attachments as blobs.
  void references;
}

function makeEdge(kind: string, from: NodeId, targetAddress: string, at: string): AdapterEvent {
  const to = nodeIdFromExternal(ADAPTER_ID, 'identity.email', targetAddress);
  return {
    type: 'edge',
    edge: {
      id: edgeId(kind, from, to, at),
      kind,
      from_id: from,
      to_id: to,
      at: at as Node['at'],
    },
  };
}
