/**
 * MUGA — source-scan test helper (#1491 item 4)
 *
 * Pins findMatchingBrace()/stripJsComments() against exactly the defect
 * class the old per-test "count raw { and } characters" trick had: a brace
 * character sitting inside a string, a comment, or a regex literal must
 * never be mistaken for real block structure.
 *
 * The first test in each pair below also runs the OLD raw-counting logic
 * inline to prove it actually breaks on that input (red), before asserting
 * the new helper gets it right (green) — evidence that this is a real fix,
 * not just a differently-shaped test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findMatchingBrace, extractBraceBlock, stripJsComments } from "./source-scan.mjs";

/** The retired trick: count `{`/`}` characters with no awareness of
 *  strings, comments, or regexes. Used only to demonstrate the defect. */
function rawBraceCount(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1; // never closes
}

describe("findMatchingBrace — brace inside a string literal", () => {
  const src = 'function f() { const s = "a } b { c"; return 1; }\nconst tail = 1;';
  const openIndex = src.indexOf("{");

  test("red: raw brace counting closes early on the brace inside the string", () => {
    const closeIndex = rawBraceCount(src, openIndex);
    // The stray "}" inside the string closes depth 1 -> 0 long before the
    // real function body ends, proving the old trick is unsound here.
    assert.notEqual(closeIndex, src.lastIndexOf("}"), "sanity: raw counting must NOT find the real close");
  });

  test("green: findMatchingBrace ignores the brace inside the string", () => {
    const closeIndex = findMatchingBrace(src, openIndex);
    assert.equal(closeIndex, src.lastIndexOf("}"));
  });
});

describe("findMatchingBrace — brace inside a line comment", () => {
  const src = "function f() {\n  // a stray } here should not count\n  return 1;\n}\nconst tail = 1;";
  const openIndex = src.indexOf("{");

  test("red: raw brace counting closes on the commented-out brace", () => {
    const closeIndex = rawBraceCount(src, openIndex);
    assert.notEqual(closeIndex, src.lastIndexOf("}"));
  });

  test("green: findMatchingBrace skips the line comment entirely", () => {
    const closeIndex = findMatchingBrace(src, openIndex);
    assert.equal(closeIndex, src.lastIndexOf("}"));
  });
});

describe("findMatchingBrace — brace inside a block comment", () => {
  const src = "function f() {\n  /* stray } inside a block comment */\n  return 1;\n}\nconst tail = 1;";
  const openIndex = src.indexOf("{");

  test("red: raw brace counting closes on the block-commented brace", () => {
    const closeIndex = rawBraceCount(src, openIndex);
    assert.notEqual(closeIndex, src.lastIndexOf("}"));
  });

  test("green: findMatchingBrace skips the block comment entirely", () => {
    const closeIndex = findMatchingBrace(src, openIndex);
    assert.equal(closeIndex, src.lastIndexOf("}"));
  });
});

describe("findMatchingBrace — brace inside a regex literal", () => {
  const src = 'function f() {\n  const re = /^[a-z}]+$/;\n  return re;\n}\nconst tail = 1;';
  const openIndex = src.indexOf("{");

  test("red: raw brace counting closes on the brace inside the regex character class", () => {
    const closeIndex = rawBraceCount(src, openIndex);
    assert.notEqual(closeIndex, src.lastIndexOf("}"));
  });

  test("green: findMatchingBrace skips the regex literal entirely", () => {
    const closeIndex = findMatchingBrace(src, openIndex);
    assert.equal(closeIndex, src.lastIndexOf("}"));
  });
});

describe("findMatchingBrace — template literal with nested ${} interpolation", () => {
  const src = "function f() {\n  const s = `x ${ { a: 1 } } y`;\n  return s;\n}\nconst tail = 1;";
  const openIndex = src.indexOf("{");

  test("green: nested object-literal braces inside ${...} do not unbalance the outer match", () => {
    const closeIndex = findMatchingBrace(src, openIndex);
    assert.equal(closeIndex, src.lastIndexOf("}"));
  });
});

describe("findMatchingBrace — division is not mistaken for a regex literal", () => {
  const src = "function f() {\n  const x = a / b / c;\n  return { x };\n}\nconst tail = 1;";
  const openIndex = src.indexOf("{");

  test("green: `a / b / c` (division, not regex) does not swallow the rest of the function", () => {
    const closeIndex = findMatchingBrace(src, openIndex);
    assert.equal(closeIndex, src.lastIndexOf("}"));
  });
});

describe("findMatchingBrace — error handling", () => {
  test("throws when the given index is not an opening brace", () => {
    assert.throws(() => findMatchingBrace("const x = 1;", 0), /not "\{"/);
  });

  test("throws when the opening brace is never closed", () => {
    assert.throws(() => findMatchingBrace("function f() { return 1;", 13), /without closing/);
  });
});

describe("extractBraceBlock", () => {
  test("returns the block text including both braces", () => {
    const src = "function f() { return 1; }\nconst tail = 1;";
    const block = extractBraceBlock(src, src.indexOf("{"));
    assert.equal(block, "{ return 1; }");
  });
});

describe("stripJsComments", () => {
  test("blanks a line comment but keeps the newline (line numbers stable)", () => {
    const src = "const a = 1; // note\nconst b = 2;";
    const stripped = stripJsComments(src);
    assert.equal(stripped, "const a = 1; \nconst b = 2;");
  });

  test("blanks a block comment", () => {
    const src = "const a = /* mid */ 1;";
    const stripped = stripJsComments(src);
    assert.equal(stripped, "const a =  1;");
  });

  test("leaves comment-like text inside a string untouched", () => {
    const src = 'const a = "// not a comment";';
    const stripped = stripJsComments(src);
    assert.equal(stripped, src);
  });

  test("leaves comment-like text inside a template literal untouched", () => {
    const src = "const a = `// not a comment ${1 + 1}`;";
    const stripped = stripJsComments(src);
    assert.equal(stripped, src);
  });
});
