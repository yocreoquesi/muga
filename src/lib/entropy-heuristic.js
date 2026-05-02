/**
 * MUGA: Entropy Heuristic
 *
 * Identifies URL parameters that look like opaque tracking identifiers
 * (click IDs, fingerprints, session correlators) by combining three
 * signals over the parameter's VALUE:
 *
 *   1. Length          — long values are more likely to be IDs.
 *   2. Shannon entropy — random-looking values have high entropy per
 *                        character.
 *   3. Charset density — values that are predominantly alphanumeric
 *                        with no spaces or punctuation look ID-like.
 *
 * The heuristic is INFORMATIONAL, not a stripper. It returns a list of
 * suspicious params with their score and the reasons each scored above
 * threshold. The cleaner pipeline does NOT auto-strip on the basis of
 * this output — auto-stripping unknown params is exactly the failure
 * mode that breaks creator referrals (#160). Surfacing them to the
 * user via the popup lets the maintainer make an informed decision.
 *
 * Pure module — no DOM, no network, no clock. Deterministic over its
 * inputs.
 *
 * ── Tunable thresholds (exported as constants) ────────────────────────
 *
 *   ENTROPY_THRESHOLD       4.0  bits/char — typical for random alphanumerics
 *   LENGTH_THRESHOLD          20 chars     — short values rarely encode IDs
 *   ALNUM_DENSITY_THRESHOLD 0.85  fraction — values that are mostly [A-Za-z0-9]
 *   SCORE_THRESHOLD            3 points    — combined score required to flag
 *
 * Score weights:
 *   length above LENGTH_THRESHOLD          : +1
 *   entropy above ENTROPY_THRESHOLD        : +2
 *   alnum density above threshold (≥16ch)  : +1
 *
 * A click ID like a 30-char hex string typically scores 1+2+1=4 → flagged.
 * A search query like "hello world" scores 0 → not flagged.
 */

export const ENTROPY_THRESHOLD = 4.0;
export const LENGTH_THRESHOLD = 20;
export const ALNUM_DENSITY_THRESHOLD = 0.85;
export const SCORE_THRESHOLD = 3;
const ALNUM_LENGTH_MIN = 16;

/**
 * Shannon entropy in bits per character. Returns 0 for empty strings.
 * @param {string} s
 * @returns {number}
 */
export function shannonEntropy(s) {
  if (!s) return 0;
  const freq = new Map();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  const len = s.length;
  let entropy = 0;
  for (const f of freq.values()) {
    const p = f / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Fraction of characters in [A-Za-z0-9]. Returns 0 for empty strings.
 * @param {string} s
 * @returns {number}
 */
export function alnumDensity(s) {
  if (!s) return 0;
  let alnum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      alnum++;
    }
  }
  return alnum / s.length;
}

/**
 * Scores a single (paramName, value) pair against the heuristic signals.
 * @param {string} _paramName
 * @param {string} value
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreParam(_paramName, value) {
  const reasons = [];
  let score = 0;

  if (!value) return { score: 0, reasons };

  if (value.length >= LENGTH_THRESHOLD) {
    score += 1;
    reasons.push(`length-${value.length}`);
  }

  const entropy = shannonEntropy(value);
  if (entropy >= ENTROPY_THRESHOLD) {
    score += 2;
    reasons.push(`entropy-${entropy.toFixed(2)}`);
  }

  if (value.length >= ALNUM_LENGTH_MIN) {
    const density = alnumDensity(value);
    if (density >= ALNUM_DENSITY_THRESHOLD) {
      score += 1;
      reasons.push(`alnum-density-${density.toFixed(2)}`);
    }
  }

  return { score, reasons };
}

/**
 * Returns the list of URL parameters whose values score above SCORE_THRESHOLD.
 *
 * @param {string} rawUrl
 * @returns {Array<{ param: string, score: number, reasons: string[] }>}
 *   Empty array when the URL is invalid, has no params, or no params
 *   exceed the threshold. Ordered by URL position.
 */
export function findSuspiciousParams(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return [];
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];

  const out = [];
  parsed.searchParams.forEach((value, name) => {
    const { score, reasons } = scoreParam(name, value);
    if (score >= SCORE_THRESHOLD) {
      out.push({ param: name, score, reasons });
    }
  });
  return out;
}
