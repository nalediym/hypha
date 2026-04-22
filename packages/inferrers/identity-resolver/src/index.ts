/**
 * @hypha/inferrer-identity-resolver — v1 three-stage ER cascade.
 *
 * Block → Score → Cluster:
 *   1. Block: group identity.email nodes by domain (cheap linear pass).
 *   2. Score: brute-force pairwise in each block via scorePair() with the
 *      Fellegi-Sunter-inspired feature weighting in score.ts.
 *   3. Cluster: weakly-connected components over match edges at confidence
 *      ≥ 0.80. Each cluster becomes a `person` inferred node whose
 *      provenance.inputs are the identity.email node ids.
 *
 * Edges in the 0.30–0.80 band are persisted with `needs_review: true`; the
 * MCP `search({ needs_review: true })` surface returns them for human triage.
 *
 * LLM judge cascade tail (Claude Haiku on ambiguous pairs) is scaffolded via
 * the ctx.reasoner field but disabled in v1 pending Reasoner plumbing in
 * W7-8. When present, it will rescore pairs in [0.30, 0.75].
 *
 * ANN-backed blocking (sqlite-vec) is deferred until W5-6 sqlite-vec loading
 * is resolved; for personal-scale graphs the domain-bucket blocker keeps the
 * pairwise work tractable anyway.
 */

import { defineInferrer } from '@hypha/inferrer-sdk';
import {
  edgeId,
  inputsHash,
  now,
  nodeIdFromExternal,
  type Edge,
  type FactEdge,
  type FactNode,
  type Node,
  type NodeId,
  type StoredNode,
} from '@hypha/core';
import { MATCH_THRESHOLD, REVIEW_THRESHOLD, parseIdentity, scorePair } from './score.ts';
import { weaklyConnectedComponents } from './wcc.ts';

const INFERRER_ID = 'identity-resolver';
const INFERRER_VERSION = '0.1.0';

export const identityResolver = defineInferrer({
  id: INFERRER_ID,
  version: INFERRER_VERSION,
  reads: ['identity.email', 'identity.handle', 'identity.label'],
  writes: ['identity.same_as', 'person'],

  async run(store, ctx) {
    // ── Load candidates
    type Candidate = { node: StoredNode; parsed: ReturnType<typeof parseIdentity> };
    const identities: Candidate[] = [];
    for await (const r of store.scan(['identity.email'])) {
      if (r.kind !== 'identity.email') continue;
      const node = r as StoredNode;
      const address = (node.facets?.address as string | undefined) ?? node.external_id;
      const displayName = node.facets?.display_name as string | undefined;
      identities.push({
        node,
        parsed: parseIdentity(node.id as string, address, displayName ?? node.title),
      });
    }
    if (identities.length === 0) {
      ctx.logger.info('no identity.email nodes found — nothing to resolve');
      return { nodes: [], edges: [] };
    }
    ctx.logger.info(`loaded ${identities.length} identity.email candidates`);

    // ── Multi-block: each identity goes into several blocks. Pairs that
    // co-occur in ANY block get scored (union blocking). This catches
    // cross-domain matches (same person, gmail + work) that single-key
    // blocking would miss — which is the whole point of ER.
    const blocks = new Map<string, typeof identities>();
    const addToBlock = (key: string, record: (typeof identities)[number]): void => {
      if (!key) return;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key)!.push(record);
    };
    for (const i of identities) {
      addToBlock(`domain:${i.parsed.domain}`, i);
      addToBlock(`local:${i.parsed.localPart}`, i);
      for (const tok of nameTokens(i.parsed.display_name)) {
        addToBlock(`name:${tok}`, i);
      }
    }

    // ── Score pairs within each block, deduping at the pair level.
    const edges: FactEdge[] = [];
    let autoMatched = 0;
    let needsReviewCount = 0;
    const at = now();
    const scoredPairs = new Set<string>();

    for (const [, block] of blocks) {
      for (let i = 0; i < block.length; i++) {
        for (let j = i + 1; j < block.length; j++) {
          const a = block[i]!;
          const b = block[j]!;
          const pairKey = [a.node.id, b.node.id].sort().join('|');
          if (scoredPairs.has(pairKey)) continue;
          scoredPairs.add(pairKey);
          const score = scorePair(a.parsed, b.parsed);
          if (score.confidence < REVIEW_THRESHOLD) continue;

          const pair = [a.node.id, b.node.id].sort() as [NodeId, NodeId];
          const hash = inputsHash(INFERRER_ID, pair);
          const needsReview = score.confidence < MATCH_THRESHOLD;
          const edge: Edge = {
            id: edgeId('identity.same_as', pair[0], pair[1], at) as Edge['id'],
            kind: 'identity.same_as',
            from_id: pair[0],
            to_id: pair[1],
            at,
          };
          edges.push({
            ...edge,
            ...(needsReview ? { needs_review: true } : {}),
            provenance: {
              kind: 'inferred',
              inferrer: INFERRER_ID,
              inferrer_version: INFERRER_VERSION,
              inputs: pair,
              inputs_hash: hash,
              confidence: score.confidence,
              reason: Object.entries(score.features)
                .map(([k, v]) => `${k}=${v.toFixed(2)}`)
                .join(', '),
            },
          });
          if (needsReview) needsReviewCount++; else autoMatched++;
        }
      }
    }
    ctx.logger.info(
      `scored pairs → ${autoMatched} auto-match, ${needsReviewCount} needs-review`,
    );

    // ── Cluster identities via WCC on match edges
    const matchEdges = edges
      .filter((e) => !e.needs_review)
      .map((e) => ({ from: e.from_id as string, to: e.to_id as string }));
    const allIds = identities.map((i) => i.node.id as string);
    // Only emit person nodes for real multi-identity clusters — singletons are
    // trivially themselves and would double the node count for no gain.
    const clusters = weaklyConnectedComponents(allIds, matchEdges).filter((c) => c.length >= 2);

    // ── Emit person.* nodes (one per cluster)
    const personNodes: FactNode[] = [];
    for (const cluster of clusters) {
      const sortedIds = [...cluster].sort();
      const clusterHash = inputsHash(INFERRER_ID, sortedIds);
      const externalId = `person:${clusterHash}`;
      const id = nodeIdFromExternal(INFERRER_ID, 'person', externalId);

      // Pick the most-populated display name + surface every address.
      const members = cluster
        .map((cid) => identities.find((i) => i.node.id === cid)!)
        .filter(Boolean);
      const displayCandidates = members
        .map((m) => m.parsed.display_name)
        .filter((n): n is string => Boolean(n));
      const title = displayCandidates[0] ?? members[0]!.parsed.address;
      const addresses = [...new Set(members.map((m) => m.parsed.address))];

      const person: Node = {
        id,
        kind: 'person',
        at,
        ingested_at: at,
        adapter: '',
        external_id: externalId,
        title,
        facets: {
          addresses,
          member_ids: sortedIds,
          cluster_size: cluster.length,
          display_names: [...new Set(displayCandidates)],
        },
      };
      const avgConfidence = averageConfidenceForCluster(edges, cluster);
      personNodes.push({
        ...person,
        provenance: {
          kind: 'inferred',
          inferrer: INFERRER_ID,
          inferrer_version: INFERRER_VERSION,
          inputs: sortedIds as unknown as readonly NodeId[],
          inputs_hash: clusterHash,
          confidence: avgConfidence,
          reason: `${cluster.length} identity.email inputs`,
        },
      });
    }
    ctx.logger.info(`emitted ${personNodes.length} person nodes from ${identities.length} identities`);

    return { nodes: personNodes, edges };
  },
});

export default identityResolver;

function nameTokens(name: string | undefined): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 2);
}

function averageConfidenceForCluster(edges: FactEdge[], cluster: string[]): number {
  const memberSet = new Set(cluster);
  const inCluster = edges.filter(
    (e) =>
      !e.needs_review && memberSet.has(e.from_id as string) && memberSet.has(e.to_id as string),
  );
  if (inCluster.length === 0) return 0.8;
  const sum = inCluster.reduce(
    (acc, e) => acc + (e.provenance.kind === 'inferred' ? e.provenance.confidence : 0),
    0,
  );
  return sum / inCluster.length;
}
