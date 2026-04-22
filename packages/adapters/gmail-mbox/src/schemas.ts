import { z } from 'zod';

/**
 * Zod schemas for gmail-mbox facets. Validated on every emitted node by the
 * adapter-sdk runtime. Keep these loose; mbox archives contain everything from
 * perfectly-structured business email to malformed spam from 2006.
 */

export const GmailMessageFacets = z
  .object({
    message_id: z.string().optional(),
    subject: z.string().optional(),
    from: z.string().optional(),
    to: z.array(z.string()).default([]),
    cc: z.array(z.string()).default([]),
    bcc: z.array(z.string()).default([]),
    date: z.string().optional(),
    in_reply_to: z.string().optional(),
    references: z.array(z.string()).default([]),
    labels: z.array(z.string()).default([]),
    thread_id: z.string().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const GmailThreadFacets = z
  .object({
    thread_id: z.string(),
    message_count: z.number().int().positive().optional(),
    subject: z.string().optional(),
  })
  .passthrough();

export const IdentityEmailFacets = z
  .object({
    address: z.string(),
    display_name: z.string().optional(),
  })
  .passthrough();
