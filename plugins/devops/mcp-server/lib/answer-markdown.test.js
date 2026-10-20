import { describe, test, expect } from "vitest";
import { answerHtml, normalizeAnswer, ANSWER_MAX } from "./answer-markdown.js";

// #757: the answer above the card is markdown rendered without HTML injection.
describe("answerHtml", () => {
  test("empty or non-string → ''", () => {
    expect(answerHtml("")).toBe("");
    expect(answerHtml("   ")).toBe("");
    expect(answerHtml(undefined)).toBe("");
    expect(answerHtml(42)).toBe("");
  });

  test("raw HTML is escaped, never injected", () => {
    const h = answerHtml('<img src=x onerror="alert(1)"> & <script>x</script>');
    expect(h).not.toMatch(/<img|<script/);
    expect(h).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;");
  });

  test("links: http(s) only, quotes cannot break out of href", () => {
    expect(answerHtml("[PR](https://github.com/o/r/pull/1)")).toContain('<a href="https://github.com/o/r/pull/1" target="_blank" rel="noopener noreferrer">PR</a>');
    expect(answerHtml("[x](javascript:alert(1))")).not.toContain("<a ");
    const h = answerHtml('[x](https://e.com/"onmouseover="a)');
    expect(h).not.toMatch(/href="[^"]*"onmouseover/);
  });

  test("headings, lists, code, emphasis, paragraphs", () => {
    const h = answerHtml("# Titel\n\n- eins\n- **zwei**\n\n1. a\n2. b\n\nText `a<b` und *kursiv*\nneue Zeile\n\n```\nif (a < b) {}\n```");
    expect(h).toContain("<h4>Titel</h4>");
    expect(h).toContain("<ul><li>eins</li><li><strong>zwei</strong></li></ul>");
    expect(h).toContain("<ol><li>a</li><li>b</li></ol>");
    expect(h).toContain("<code>a&lt;b</code>");
    expect(h).toContain("<em>kursiv</em>");
    expect(h).toContain("<br>neue Zeile");
    expect(h).toContain("<pre><code>if (a &lt; b) {}</code></pre>");
    expect(h.startsWith('<div class="dc-answer"')).toBe(true);
  });

  test("an oversized answer is capped", () => {
    expect(normalizeAnswer("x".repeat(ANSWER_MAX + 50)).length).toBe(ANSWER_MAX + 1);
  });
});
