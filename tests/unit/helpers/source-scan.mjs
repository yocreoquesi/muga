/** MUGA: shared test helper — a small JS-source scanner (#1491 item 4)
 *
 * Several structural tests read production source as text and need to find
 * a real function or block boundary by matching `{` against its closing
 * `}`. The previous per-test implementations counted raw brace characters
 * one-by-one, which silently miscounts the moment a `{` or `}` appears
 * inside a string, a template literal, a comment, or a regex literal (e.g.
 * a log message containing a literal brace, or a `// {note}` comment).
 *
 * This module centralizes a single, once-audited boundary finder so every
 * test that needs one imports it instead of re-implementing the same raw
 * counting trick. It is a lightweight tokenizer, not a full parser — it
 * only needs to correctly SKIP non-code spans, not build an AST.
 */

// Keywords/operators after which a `/` starts a regex literal rather than
// division. Checked against the identifier word immediately preceding a
// candidate `/` (after skipping whitespace).
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "case", "delete", "void",
  "throw", "new", "yield", "do", "else", "await", "extends", "default",
]);

/**
 * Decides whether the `/` at `source[index]` can start a regex literal,
 * based on the last significant token before it. Division follows a value
 * (identifier, number, `)`, `]`); a regex follows an operator, an opening
 * bracket, a comma, or one of REGEX_PRECEDING_KEYWORDS.
 *
 * @param {string} source
 * @param {number} index - index of the candidate `/`.
 * @returns {boolean}
 */
function isRegexContext(source, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (j < 0) return true;
  const ch = source[j];
  if (ch === ")" || ch === "]") return false;
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) k--;
    const word = source.slice(k + 1, j + 1);
    if (/^[0-9]/.test(word)) return false; // number literal => division
    return REGEX_PRECEDING_KEYWORDS.has(word);
  }
  return true; // any other punctuation => regex-permissive
}

/**
 * Finds the index of the `}` that matches the `{` at `source[openIndex]`,
 * skipping braces that appear inside string/template literals, line/block
 * comments, or regex literals. Template-literal `${...}` interpolation is
 * handled by recursing into this same function, so nested braces inside an
 * interpolated expression are matched correctly too.
 *
 * @param {string} source - full source text.
 * @param {number} openIndex - index of the opening `{`.
 * @returns {number} index of the matching closing `}` (inclusive).
 * @throws {Error} if `source[openIndex]` is not `{`, or no match is found.
 */
export function findMatchingBrace(source, openIndex) {
  if (source[openIndex] !== "{") {
    throw new Error(
      `findMatchingBrace: source[${openIndex}] is ${JSON.stringify(source[openIndex])}, not "{"`
    );
  }
  let depth = 0;
  let i = openIndex;
  for (; i < source.length; i++) {
    const ch = source[i];

    // Line comment
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = (nl === -1 ? source.length : nl) - 1;
      continue;
    }
    // Block comment
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length - 1 : end + 1;
      continue;
    }
    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i++;
        i++;
      }
      continue;
    }
    // Template literal (with ${...} interpolation)
    if (ch === "`") {
      i++;
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "$" && source[i + 1] === "{") {
          const exprOpen = i + 1;
          i = findMatchingBrace(source, exprOpen);
        }
        i++;
      }
      continue;
    }
    // Regex literal
    if (ch === "/" && isRegexContext(source, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length && source[j] !== "\n") {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        i = j;
        while (i + 1 < source.length && /[a-z]/i.test(source[i + 1])) i++;
        continue;
      }
      // Unterminated on this line: not actually a regex, fall through and
      // treat "/" as an ordinary character (division operator).
    }

    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
      continue;
    }
  }
  throw new Error(
    `findMatchingBrace: reached end of source (from index ${openIndex}) without closing the opening brace`
  );
}

/**
 * Slices out the source span from `startIndex` (which must point at a `{`)
 * through its matching `}`, inclusive.
 *
 * @param {string} source
 * @param {number} startIndex - index of the opening `{`.
 * @returns {string}
 */
export function extractBraceBlock(source, startIndex) {
  const end = findMatchingBrace(source, startIndex);
  return source.slice(startIndex, end + 1);
}

/**
 * Strips `//` line comments and `/* *\/` block comments from JS source,
 * leaving string/template literal contents untouched (so a comment marker
 * inside a string survives) and preserving line numbers (a line comment is
 * blanked up to, but not including, its trailing newline).
 *
 * @param {string} source
 * @returns {string}
 */
export function stripJsComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      out += source.slice(start, i);
      continue;
    }
    if (ch === "`") {
      const start = i;
      i++;
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "$" && source[i + 1] === "{") {
          i = findMatchingBrace(source, i + 1) + 1;
          continue;
        }
        i++;
      }
      i++;
      out += source.slice(start, i);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
