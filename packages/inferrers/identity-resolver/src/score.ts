/**
 * Pairwise identity scoring — a pragmatic Fellegi-Sunter-inspired approach
 * without the full EM calibration of Splink. For v1 personal-scale graphs
 * this yields sensible match/no-match/review bands; the full Splink port
 * lands in v1.x when we have labeled data to calibrate m/u-probabilities.
 *
 * Feature weights are additive (capped at 1.0). Each feature contributes
 * its weight only when it fires; absence is neutral, not negative.
 *
 *   same_local_part            +0.75   alice@example.com ↔ alice@work.example.com
 *   same_domain                +0.10   weak signal on its own
 *   display_name_jw ≥ 0.92     +0.35   "Alice Kim" ↔ "Alice K"
 *   display_name_jw ≥ 0.80     +0.15   weaker fuzzy-name match
 *   local_part_jw ≥ 0.92       +0.20   nkekana ↔ n.kekana (same domain implied for signal)
 *   name_contains_localpart    +0.20   "Alice Kim" ↔ alice@...
 *
 * Thresholds:
 *   confidence ≥ 0.80  → auto-match   (emit identity.same_as edge)
 *   0.30 ≤ conf < 0.80 → needs_review (emit edge with needs_review: true)
 *   confidence < 0.30  → drop
 */

import { jaroWinkler } from './jaro-winkler.ts';

export interface IdentityRecord {
  id: string;
  address: string;
  display_name: string | undefined;
  localPart: string;
  domain: string;
}

export function parseIdentity(id: string, address: string, display?: string): IdentityRecord {
  const at = address.lastIndexOf('@');
  const localPart = (at >= 0 ? address.slice(0, at) : address).toLowerCase();
  const domain = (at >= 0 ? address.slice(at + 1) : '').toLowerCase();
  return { id, address: address.toLowerCase(), display_name: display?.toLowerCase(), localPart, domain };
}

export interface PairScore {
  confidence: number;
  features: Record<string, number>;
}

export function scorePair(a: IdentityRecord, b: IdentityRecord): PairScore {
  const f: Record<string, number> = {};
  let score = 0;

  if (a.localPart && b.localPart && a.localPart === b.localPart) {
    f.same_local_part = 0.75;
    score += 0.75;
  }
  if (a.domain && b.domain && a.domain === b.domain) {
    f.same_domain = 0.1;
    score += 0.1;
  }

  if (a.display_name && b.display_name) {
    const jw = jaroWinkler(a.display_name, b.display_name);
    if (jw >= 0.92) { f.display_name_jw_high = 0.35; score += 0.35; }
    else if (jw >= 0.80) { f.display_name_jw_med = 0.15; score += 0.15; }
  }

  if (a.localPart && b.localPart) {
    const jw = jaroWinkler(a.localPart, b.localPart);
    if (jw >= 0.92 && f.same_local_part === undefined) {
      f.local_part_jw = 0.2;
      score += 0.2;
    }
  }

  // Does the display-name token set contain the other's local-part?
  // "Alice Kim" matched with alice@example.com would fire here.
  if (a.display_name && b.localPart && nameTokensInclude(a.display_name, b.localPart)) {
    f.name_contains_localpart_b = 0.2;
    score += 0.2;
  } else if (b.display_name && a.localPart && nameTokensInclude(b.display_name, a.localPart)) {
    f.name_contains_localpart_a = 0.2;
    score += 0.2;
  }

  return { confidence: Math.min(1, score), features: f };
}

function nameTokensInclude(name: string, needle: string): boolean {
  if (!name || !needle) return false;
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.includes(needle.toLowerCase());
}

export const MATCH_THRESHOLD = 0.8;
export const REVIEW_THRESHOLD = 0.3;
