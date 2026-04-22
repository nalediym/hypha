/**
 * Regex pattern bank for DLP / PII detection.
 *
 * Each pattern returns {kind, confidence, detector, validate?} — `validate`
 * is an optional post-filter (e.g. Luhn check on credit-card candidates).
 *
 * These are deliberately narrow to keep false positives low at ingest.
 * Presidio NER via Python sidecar (deferred) catches the looser cases
 * (PERSON, ORG, LOCATION, DATE_TIME, NRP).
 */

export interface PatternSpec {
  kind: string;
  detector: string;
  re: RegExp;
  confidence: number;
  validate?: (match: string) => boolean;
}

export const PATTERNS: readonly PatternSpec[] = [
  {
    kind: 'ssn',
    detector: 'regex.ssn',
    re: /\b(?!000|666|9\d{2})\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g,
    confidence: 0.95,
  },
  {
    kind: 'email',
    detector: 'regex.email',
    re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    confidence: 0.98,
  },
  {
    kind: 'phone.us',
    detector: 'regex.phone.us',
    // (XXX) XXX-XXXX, XXX-XXX-XXXX, +1 XXX XXX XXXX, etc.
    re: /(?:\+?1[-. ]?)?(?:\(\d{3}\)|\d{3})[-. ]\d{3}[-. ]\d{4}\b/g,
    confidence: 0.85,
  },
  {
    kind: 'credit_card',
    detector: 'regex.credit_card+luhn',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    confidence: 0.95,
    validate: (match) => luhnValid(match.replace(/[^\d]/g, '')),
  },
  {
    kind: 'bank.routing.us',
    detector: 'regex.bank.routing.us',
    // 9-digit US routing number; ABA checksum for safety
    re: /\b\d{9}\b/g,
    confidence: 0.6, // weak on its own — co-occurrence with account-number lifts it
    validate: (match) => abaRoutingValid(match),
  },
  {
    kind: 'iban',
    detector: 'regex.iban',
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    confidence: 0.9,
  },
  {
    kind: 'dob',
    detector: 'regex.dob',
    // Very narrow — requires "DOB" or "date of birth" label to fire.
    re: /\b(?:DOB|date[- ]of[- ]birth)[:\s]+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    confidence: 0.92,
  },
];

// ─── Validators ─────────────────────────────────────────────────────────────

function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i] ?? '0', 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function abaRoutingValid(digits: string): boolean {
  if (digits.length !== 9) return false;
  const d = digits.split('').map((c) => parseInt(c, 10));
  if (d.some((x) => Number.isNaN(x))) return false;
  const checksum =
    3 * (d[0]! + d[3]! + d[6]!) +
    7 * (d[1]! + d[4]! + d[7]!) +
    (d[2]! + d[5]! + d[8]!);
  return checksum % 10 === 0;
}

export interface Finding {
  kind: string;
  detector: string;
  confidence: number;
  span_start: number;
  span_end: number;
  match: string;
}

/**
 * Scan a single string for PII. Returns all non-overlapping findings
 * across the pattern bank, sorted by start offset.
 */
export function scanString(text: string): Finding[] {
  if (!text) return [];
  const findings: Finding[] = [];
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(text)) !== null) {
      const raw = match[0];
      if (pattern.validate && !pattern.validate(raw)) continue;
      findings.push({
        kind: pattern.kind,
        detector: pattern.detector,
        confidence: pattern.confidence,
        span_start: match.index,
        span_end: match.index + raw.length,
        match: raw,
      });
    }
    pattern.re.lastIndex = 0;
  }
  // Dedupe overlapping hits — prefer higher confidence.
  findings.sort((a, b) => a.span_start - b.span_start);
  const deduped: Finding[] = [];
  for (const f of findings) {
    const prev = deduped[deduped.length - 1];
    if (prev && f.span_start < prev.span_end) {
      if (f.confidence > prev.confidence) deduped[deduped.length - 1] = f;
      continue;
    }
    deduped.push(f);
  }
  return deduped;
}
