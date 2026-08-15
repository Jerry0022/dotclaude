import { describe, test, expect } from "vitest";
import {
  segmentize,
  commandHead,
  classifySegment,
  isFreeOfContextCost,
  matchCostlyFiles,
} from "./bash-context-cost.js";

const BIG = [{ path: "docs/concepts/big.html", estimatedTokens: 49557 }];
const hits = (cmd, opts) => matchCostlyFiles(cmd, BIG, opts).map(f => f.path);

describe("segmentize", () => {
  test("splits on &&, ;, |, || and newlines", () => {
    expect(segmentize("a && b ; c | d || e\nf")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  test("lifts command substitutions into their own segments", () => {
    expect(segmentize('echo "$(cat big.html)"')).toContain("cat big.html");
  });

  test("lifts backtick substitutions too", () => {
    expect(segmentize("echo `cat big.html`")).toContain("cat big.html");
  });

  test("handles nested substitutions", () => {
    expect(segmentize('echo "$(head -1 $(ls big.html))"')).toEqual(
      expect.arrayContaining(["ls big.html"])
    );
  });
});

describe("commandHead", () => {
  test("strips a directory and a .exe suffix", () => {
    expect(commandHead("/usr/bin/cat f").head).toBe("cat");
    expect(commandHead("C:/Python/python.exe s.py").head).toBe("python");
  });

  test("skips leading env assignments", () => {
    expect(commandHead("FOO=1 BAR=2 cat f").head).toBe("cat");
  });

  test("looks through wrappers and their flags", () => {
    expect(commandHead("sudo cat f").head).toBe("cat");
    expect(commandHead("timeout -k 2 30 cat f").head).toBe("cat");
  });
});

describe("classifySegment", () => {
  test.each(["cat f", "grep x f", "jq . f", "sed -n 1p f", "Get-Content f"])(
    "%s → reader",
    seg => expect(classifySegment(seg)).toBe("reader")
  );

  test.each(["ls -la f", "echo f", "mv a b", "touch f", "git add f", "gh pr create"])(
    "%s → passer",
    seg => expect(classifySegment(seg)).toBe("passer")
  );

  test.each(["python server.py --html f", "node dump.js f", "./mytool f"])(
    "%s → unknown (fail safe)",
    seg => expect(classifySegment(seg)).toBe("unknown")
  );

  test("an interpreter with inline code is a reader", () => {
    expect(classifySegment(`python -c "print(open('f').read())"`)).toBe("reader");
    expect(classifySegment("node -e \"console.log(require('fs').readFileSync('f'))\"")).toBe("reader");
  });

  // git and gh are known content emitters — that is why their subcommands are
  // allowlisted. Anything outside the allowlist is `reader`, not `unknown`, so
  // backgrounding cannot free it.
  test("git subcommands that emit file content are readers", () => {
    expect(classifySegment("git show HEAD:f")).toBe("reader");
    expect(classifySegment("git diff f")).toBe("reader");
    expect(classifySegment("git log")).toBe("reader");
    expect(classifySegment("git add -p f")).toBe("reader");
  });

  test("an empty head after a wrapper is a parse failure, not an unknown command", () => {
    expect(classifySegment("sudo")).toBe("reader");
    expect(classifySegment("timeout 30")).toBe("reader");
    expect(classifySegment("sudo -u root cat f")).toBe("reader");
  });
});

describe("isFreeOfContextCost", () => {
  test("all-passer commands are free", () => {
    expect(isFreeOfContextCost("git add docs/concepts/big.html && git commit -m x")).toBe(true);
    expect(isFreeOfContextCost("ls -la docs/concepts/big.html")).toBe(true);
  });

  test("one costly segment disqualifies the whole command", () => {
    expect(isFreeOfContextCost("ls f && cat docs/concepts/big.html")).toBe(false);
  });

  test("does not use the background exemption (verbose detection must still run)", () => {
    expect(isFreeOfContextCost("git log")).toBe(false);
  });
});

describe("matchCostlyFiles", () => {
  test("a reader consuming the path costs context", () => {
    expect(hits("cat docs/concepts/big.html")).toEqual(["docs/concepts/big.html"]);
  });

  test("merely passing the path as an argument is free", () => {
    expect(hits("ls -la docs/concepts/big.html")).toEqual([]);
    expect(hits('echo "wrote docs/concepts/big.html"')).toEqual([]);
    expect(hits("mv docs/concepts/big.html docs/concepts/old.html")).toEqual([]);
  });

  test("a detached non-reader (server start) is free — the reported bug", () => {
    const cmd = "python scripts/concept-server.py 8883 . --html docs/concepts/big.html";
    expect(hits(cmd, { runInBackground: true })).toEqual([]);
    expect(hits(cmd)).toEqual(["docs/concepts/big.html"]); // foreground stays safe
  });

  test("backgrounding a READER does not buy an exemption", () => {
    expect(hits("cat docs/concepts/big.html", { runInBackground: true }))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("a read hidden in a command substitution still counts", () => {
    expect(hits('echo "$(cat docs/concepts/big.html)"')).toEqual(["docs/concepts/big.html"]);
  });

  test("a read behind a pipe still counts", () => {
    expect(hits("cat docs/concepts/big.html | head -5")).toEqual(["docs/concepts/big.html"]);
  });

  test("an unknown foreground command head stays costly", () => {
    expect(hits("./weird-tool docs/concepts/big.html")).toEqual(["docs/concepts/big.html"]);
  });

  test("unrelated commands match nothing", () => {
    expect(hits("cat package.json")).toEqual([]);
  });

  test("a malformed expensiveFiles config does not throw", () => {
    expect(matchCostlyFiles("cat x", null)).toEqual([]);
    expect(matchCostlyFiles("cat x", "nope")).toEqual([]);
    expect(matchCostlyFiles("cat x", [null, {}, { path: "" }])).toEqual([]);
  });
});

// Every case below was raised by the red-team pass on this change. Each one is
// a way the classifier could end up WEAKER than the substring match it
// replaced — the invariant stated in the module header.
describe("matchCostlyFiles — fail-safe invariant", () => {
  test("a path parked in a variable is still costly (assignment-only segment)", () => {
    expect(hits("FILE=docs/concepts/big.html && cat $FILE"))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("a literal paren inside quotes does not truncate the substitution", () => {
    expect(hits(`echo "$(grep ')' docs/concepts/big.html)"`))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("a shell handed inline code is a reader, background or not", () => {
    const cmd = `bash -c "cat docs/concepts/big.html"`;
    expect(hits(cmd)).toEqual(["docs/concepts/big.html"]);
    expect(hits(cmd, { runInBackground: true })).toEqual(["docs/concepts/big.html"]);
    expect(hits(`cmd /c type docs/concepts/big.html`)).toEqual(["docs/concepts/big.html"]);
  });

  test("git patch mode emits content and is not a passer", () => {
    expect(hits("git stash show -p docs/concepts/big.html")).toEqual(["docs/concepts/big.html"]);
    expect(hits("git add -p docs/concepts/big.html")).toEqual(["docs/concepts/big.html"]);
    expect(classifySegment("git show HEAD:docs/concepts/big.html")).toBe("reader");
  });

  test("gh is allowlisted per verb, and `gh api` never is", () => {
    expect(hits("gh api repos/o/r/contents/docs/concepts/big.html"))
      .toEqual(["docs/concepts/big.html"]);
    expect(classifySegment("gh pr diff")).toBe("reader");
    expect(classifySegment("gh run view --log")).toBe("reader");
    expect(classifySegment("gh release view")).toBe("reader");
    expect(classifySegment("gh pr create --title x")).toBe("passer");
  });

  test("writing to a stdout sink defeats the passer head", () => {
    expect(hits("cp docs/concepts/big.html /dev/stdout")).toEqual(["docs/concepts/big.html"]);
  });

  test("a Windows-style path matches the forward-slash config entry", () => {
    expect(hits("type docs\\concepts\\big.html")).toEqual(["docs/concepts/big.html"]);
  });

  test("a read hidden past the substitution cap is kept, not dropped", () => {
    const noise = "$(true) ".repeat(2100);
    expect(hits(`echo ${noise}$(cat docs/concepts/big.html)`))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("an apostrophe inside double quotes does not swallow later substitutions", () => {
    // A ' inside "..." is literal. Treating it as an opening single quote hid
    // every following $(...) and let the whole file through.
    expect(hits(`gh pr create --title "Claude's fix" --body "$(cat docs/concepts/big.html)"`))
      .toEqual(["docs/concepts/big.html"]);
    expect(hits(`echo "it's done: $(cat docs/concepts/big.html)"`))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("a path piped from a passer into a reader still counts", () => {
    expect(hits("echo docs/concepts/big.html | xargs cat"))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("the overflow sentinel really classifies as reader", () => {
    expect(classifySegment("__unparsed__ cat docs/concepts/big.html")).toBe("reader");
  });

  test("a quoted stdout sink and stderr sinks are caught too", () => {
    expect(hits(`cp docs/concepts/big.html "/dev/stdout"`)).toEqual(["docs/concepts/big.html"]);
    expect(hits("cp docs/concepts/big.html /dev/stderr")).toEqual(["docs/concepts/big.html"]);
  });

  test("gh global flags before the noun do not break verb resolution", () => {
    expect(classifySegment("gh --repo o/r pr create --fill")).toBe("passer");
    expect(classifySegment("gh --repo o/r pr diff")).toBe("reader");
  });

  test("the whole-command fallback is deliberately over-inclusive", () => {
    // Once anything reads, the whole command is the haystack, so a path only a
    // PASSER touches is still counted. Pinned so the trade-off is a decision:
    // it is a subset of the pre-0.9 behaviour, but wider than per-segment.
    expect(hits("ls docs/concepts/big.html && cat other.txt"))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("the character budget trips independently of the pass budget", () => {
    // One segment, one pass — only MAX_CHARS can end this.
    const padding = "x".repeat(250_000);
    expect(hits(`./tool ${padding} docs/concepts/big.html`))
      .toEqual(["docs/concepts/big.html"]);
  });
});

// `unknown` is the only verdict the background exemption may free. Every
// fail-safe verdict must be `reader`, or backgrounding defeats it.
describe("fail-safe verdicts survive run_in_background", () => {
  const bg = { runInBackground: true };

  test("assignment-only segment", () => {
    expect(hits("FILE=docs/concepts/big.html && cat $FILE", bg))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("overflow tail", () => {
    const noise = "$(true) ".repeat(2100);
    expect(hits(`echo ${noise}$(cat docs/concepts/big.html)`, bg))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("stdout sink", () => {
    expect(hits("cp docs/concepts/big.html /dev/stdout", bg))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("shell with inline code", () => {
    expect(hits(`sh -c "cat docs/concepts/big.html"`, bg))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("git and gh forms outside their allowlists", () => {
    expect(hits("git diff docs/concepts/big.html", bg)).toEqual(["docs/concepts/big.html"]);
    expect(hits("git add -p docs/concepts/big.html", bg)).toEqual(["docs/concepts/big.html"]);
    expect(hits("gh api repos/o/r/contents/docs/concepts/big.html", bg))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("a reader hidden behind a wrapper flag that takes a value", () => {
    expect(hits("sudo -u root cat docs/concepts/big.html", bg))
      .toEqual(["docs/concepts/big.html"]);
  });

  test("a package manager outside its allowlist", () => {
    expect(hits("npm exec -- cat docs/concepts/big.html", bg))
      .toEqual(["docs/concepts/big.html"]);
    expect(classifySegment("npm publish")).toBe("passer");
  });

  test("but a genuinely unrecognised head is still freed — the accepted hole", () => {
    expect(hits("python scripts/serve.py --html docs/concepts/big.html", bg)).toEqual([]);
  });

  test("…including a detached server behind a wrapper (only a FLAG derails a head)", () => {
    expect(hits("nohup ./concept-server --html docs/concepts/big.html", bg)).toEqual([]);
    expect(hits("timeout 3600 ./concept-server --html docs/concepts/big.html", bg)).toEqual([]);
  });
});

describe("git head resolution", () => {
  test("global flags that take a value do not hide the subcommand", () => {
    expect(classifySegment("git -C docs status")).toBe("passer");
    expect(classifySegment("git -c user.name=x commit -m y")).toBe("passer");
    expect(classifySegment("git --no-pager status")).toBe("passer");
  });

  test("…and still resolve content-emitting subcommands correctly", () => {
    expect(classifySegment("git -C docs diff")).toBe("reader");
  });
});

// The v0.8 hook exempted these via `noTokenCostPattern`. Consumers rely on it,
// so the classifier must not start blocking them.
describe("parity with the removed noTokenCostPattern", () => {
  const BIGP = "docs/concepts/big.html";
  test.each([
    "cd docs/concepts",
    `rm ${BIGP}`,
    "mkdir docs/new",
    `cp ${BIGP} docs/copy.html`,
    `mv ${BIGP} docs/old.html`,
    "npm publish",
    `git add ${BIGP}`,
    'git commit -m "x"',
    "git push origin main",
    "git branch -d old",
    "git checkout main",
    "gh pr create --fill",
    "gh issue close 1",
  ])("%s stays exempt", cmd => {
    expect(isFreeOfContextCost(cmd)).toBe(true);
    expect(hits(cmd)).toEqual([]);
  });

  test("multi-segment combinations stay exempt", () => {
    expect(isFreeOfContextCost(`git add ${BIGP} && git commit -m x && git push`)).toBe(true);
  });

  test("`gh api` is a DELIBERATE parity break — it can return file contents", () => {
    expect(isFreeOfContextCost("gh api repos/o/r/pulls")).toBe(false);
    // …but without an expensive path in it, the outcome for the user is unchanged.
    expect(hits("gh api repos/o/r/pulls")).toEqual([]);
  });

  test("verbose-output commands must not be swallowed by the early exit", () => {
    for (const cmd of ["git log", "npm ls", "find .", "docker logs web"]) {
      expect(isFreeOfContextCost(cmd)).toBe(false);
    }
  });
});
