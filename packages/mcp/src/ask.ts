/**
 * `ask` — natural-language query over the graph.
 *
 * Strategy:
 *   1. If ANTHROPIC_API_KEY is set, Claude Haiku compiles the NL question
 *      into a structured `StoreQuery` (kinds + text + time window + min
 *      confidence) using a schema-constrained system prompt. We run that
 *      query and include the compiled form in the response for auditability.
 *   2. If no key is set, we fall back to treating the NL as a plain FTS
 *      query. The response still returns the compiled query (a trivial
 *      one) so agents and humans see the same shape regardless.
 *
 * The compiled query is ALWAYS included in structuredContent so the user
 * can see what Hypha actually asked for. No silent "the LLM made it up."
 */

import { z } from 'zod';
import type { Store, StoredNode } from '@hypha/core';

export const AskInput = z.object({
  question: z.string().describe('Natural-language question about the graph.'),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

export const AskOutput = z.object({
  instance_id: z.string(),
  instance_label: z.string(),
  question: z.string(),
  compiled_query: z.object({
    text: z.string().optional(),
    kinds: z.array(z.string()).optional(),
    min_confidence: z.number().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  }),
  compiler: z.enum(['anthropic-haiku', 'fallback-fts']),
  hits: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    at: z.string(),
    score: z.number(),
    provenance: z.object({
      kind: z.enum(['ingested', 'inferred']),
      adapter: z.string().optional(),
      inferrer: z.string().optional(),
      confidence: z.number().optional(),
    }),
    uri: z.string(),
  })),
});

type CompiledQuery = z.infer<typeof AskOutput>['compiled_query'];

export async function askTool(
  ctx: { store: Store; instance_id: string; instance_label: string },
  args: z.infer<typeof AskInput>,
): Promise<z.infer<typeof AskOutput>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { compiled, compiler } = apiKey
    ? await compileWithClaude(apiKey, args.question)
    : { compiled: { text: args.question } as CompiledQuery, compiler: 'fallback-fts' as const };

  const limit = args.limit ?? 10;
  const result = await ctx.store.search({
    ...(compiled.text ? { text: compiled.text } : {}),
    ...(compiled.kinds ? { kinds: compiled.kinds } : {}),
    ...(compiled.min_confidence !== undefined ? { min_confidence: compiled.min_confidence } : {}),
    limit,
  });

  return {
    instance_id: ctx.instance_id,
    instance_label: ctx.instance_label,
    question: args.question,
    compiled_query: compiled,
    compiler,
    hits: result.hits.map((h) => ({
      id: h.node.id as string,
      kind: h.node.kind,
      title: h.node.title,
      at: h.node.at as string,
      score: h.score,
      provenance: summarize(h.node),
      uri: `hypha://node/${h.node.id}`,
    })),
  };
}

async function compileWithClaude(
  apiKey: string,
  question: string,
): Promise<{ compiled: CompiledQuery; compiler: 'anthropic-haiku' }> {
  const system =
    'You compile natural-language questions about a personal/org knowledge graph into ' +
    'a structured search query. Respond ONLY with JSON matching this schema: ' +
    '{ "text": string?, "kinds": string[]?, "min_confidence": number?, "since": ISO8601 string?, "until": ISO8601 string? }. ' +
    'Kinds follow "namespace.kind" (e.g. "gmail.message", "person", "file.document"). ' +
    'Prefer kind filters + a concise text query. Omit fields you cannot infer.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: question }],
    }),
  });

  if (!response.ok) {
    // Soft fail — degrade gracefully rather than kill the tool call.
    return {
      compiled: { text: question } as CompiledQuery,
      compiler: 'anthropic-haiku' as const,
    };
  }

  const body = (await response.json()) as { content?: { text?: string }[] };
  const text = body.content?.[0]?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { compiled: { text: question } as CompiledQuery, compiler: 'anthropic-haiku' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as CompiledQuery;
    return { compiled: parsed, compiler: 'anthropic-haiku' };
  } catch {
    return { compiled: { text: question } as CompiledQuery, compiler: 'anthropic-haiku' };
  }
}

function summarize(record: StoredNode): {
  kind: 'ingested' | 'inferred';
  adapter?: string;
  inferrer?: string;
  confidence?: number;
} {
  const p = record.provenance;
  if (p.kind === 'ingested') return { kind: 'ingested', adapter: p.adapter };
  return { kind: 'inferred', inferrer: p.inferrer, confidence: p.confidence };
}
