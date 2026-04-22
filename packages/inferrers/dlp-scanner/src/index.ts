/**
 * @hypha/inferrer-dlp-scanner — regex-based DLP/PII pre-pass.
 *
 * Scans every node with a `body`. For each detected PII span, emits a
 * `dlp.finding` node linked to the source via a `dlp_finding_for` edge.
 * Findings carry confidence + detector + span offsets so downstream tools
 * (Cedar policy, redaction views) can reason about them.
 *
 * This is the fast tier. Presidio NER sidecar (loose-case PERSON/ORG/
 * LOCATION detection) and an LLM fallback for ambiguous spans land when
 * that plumbing is wired up — the Inferrer contract stays the same.
 */

import { defineInferrer } from '@hypha/inferrer-sdk';
import {
  edgeId,
  inputsHash,
  now,
  nodeIdFromContent,
  type Edge,
  type FactEdge,
  type FactNode,
  type Node,
  type NodeId,
  type StoredNode,
} from '@hypha/core';
import { scanString } from './patterns.ts';

const INFERRER_ID = 'dlp-scanner';
const INFERRER_VERSION = '0.1.0';

export const dlpScanner = defineInferrer({
  id: INFERRER_ID,
  version: INFERRER_VERSION,
  reads: ['*'],
  writes: ['dlp.finding', 'dlp_finding_for'],

  async run(store, ctx) {
    const nodes: FactNode[] = [];
    const edges: FactEdge[] = [];
    const at = now();
    let scanned = 0;
    let findingsTotal = 0;

    for await (const record of store.scan(['*'])) {
      if (!('title' in record)) continue; // edges don't carry bodies
      const node = record as StoredNode;
      if (!node.body) continue;
      // Don't re-scan dlp.finding bodies.
      if (node.kind === 'dlp.finding') continue;
      scanned++;

      const findings = scanString(node.body);
      for (const finding of findings) {
        findingsTotal++;
        const findingKey = `${node.id}|${finding.span_start}|${finding.span_end}|${finding.kind}`;
        const findingId = nodeIdFromContent(INFERRER_ID, 'dlp.finding', findingKey);
        const hash = inputsHash(INFERRER_ID, [node.id, `${finding.span_start}-${finding.span_end}`, finding.kind]);

        const findingNode: Node = {
          id: findingId,
          kind: 'dlp.finding',
          at: at as Node['at'],
          ingested_at: at,
          adapter: '',
          external_id: findingKey,
          title: `${finding.kind} in ${node.title}`,
          facets: {
            target_id: node.id,
            pii_kind: finding.kind,
            detector: finding.detector,
            confidence: finding.confidence,
            span_start: finding.span_start,
            span_end: finding.span_end,
            // Note: we do NOT store the matched substring to avoid
            // making findings their own PII vector. Offsets + kind are enough.
          },
        };
        nodes.push({
          ...findingNode,
          provenance: {
            kind: 'inferred',
            inferrer: INFERRER_ID,
            inferrer_version: INFERRER_VERSION,
            inputs: [node.id as NodeId],
            inputs_hash: hash,
            confidence: finding.confidence,
            reason: `${finding.detector} at [${finding.span_start}, ${finding.span_end}]`,
          },
        });
        edges.push({
          id: `${INFERRER_ID}:dlp_finding_for:${hash.slice(0, 16)}` as Edge['id'],
          kind: 'dlp_finding_for',
          from_id: findingId,
          to_id: node.id as NodeId,
          at: at as Node['at'],
          provenance: {
            kind: 'inferred',
            inferrer: INFERRER_ID,
            inferrer_version: INFERRER_VERSION,
            inputs: [findingId, node.id as NodeId],
            inputs_hash: `${hash}e`,
            confidence: finding.confidence,
          },
        });
      }
    }

    ctx.logger.info(`scanned ${scanned} nodes, ${findingsTotal} PII findings emitted`);
    return { nodes, edges };
  },
});

export default dlpScanner;
export { scanString, PATTERNS } from './patterns.ts';
