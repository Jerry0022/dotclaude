import { describe, test, expect } from "vitest";
import {
  DEFAULT_OUT_OF_BAND_GLOBS,
  globToRegExp,
  detectOutOfBandDeploys,
} from "./infra-deploy.js";

describe("globToRegExp", () => {
  test("**/migrations/** matches a nested migration under any prefix", () => {
    const re = globToRegExp("**/migrations/**");
    expect(re.test("supabase/migrations/20260708_add_col.sql")).toBe(true);
    expect(re.test("db/migrations/001.sql")).toBe(true);
  });

  test("**/migrations/** matches a root-level migrations dir (zero prefix segments)", () => {
    expect(globToRegExp("**/migrations/**").test("migrations/001.sql")).toBe(true);
  });

  test("supabase/functions/** matches a function file but not a sibling", () => {
    const re = globToRegExp("supabase/functions/**");
    expect(re.test("supabase/functions/desktop-latest/index.ts")).toBe(true);
    expect(re.test("supabase/config.toml")).toBe(false);
  });

  test("single * stays within a segment", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/app.ts")).toBe(true);
    expect(re.test("src/nested/app.ts")).toBe(false);
  });

  test("regex metacharacters in the glob are escaped", () => {
    const re = globToRegExp("a.b/c+d/**");
    expect(re.test("a.b/c+d/x")).toBe(true);
    expect(re.test("aXb/cYd/x")).toBe(false);
  });
});

describe("detectOutOfBandDeploys — defaults", () => {
  test("plain code diff → not detected", () => {
    const r = detectOutOfBandDeploys(["src/app.ts", "README.md", "package.json"]);
    expect(r.detected).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.kinds).toEqual([]);
  });

  test("migration + edge function → detected, categorized, first-match glob recorded", () => {
    const r = detectOutOfBandDeploys([
      "src/app.ts",
      "supabase/migrations/20260708_token_revoked.sql",
      "supabase/functions/desktop-latest/index.ts",
    ]);
    expect(r.detected).toBe(true);
    expect(r.files).toEqual([
      "supabase/migrations/20260708_token_revoked.sql",
      "supabase/functions/desktop-latest/index.ts",
    ]);
    expect(r.kinds.sort()).toEqual(["function", "migration"]);
  });

  test("a path is counted once even if two globs would match it", () => {
    const r = detectOutOfBandDeploys(["supabase/migrations/1.sql"]);
    expect(r.matched).toHaveLength(1);
  });

  test("empty / non-array input is safe", () => {
    expect(detectOutOfBandDeploys([]).detected).toBe(false);
    expect(detectOutOfBandDeploys(undefined).detected).toBe(false);
    expect(detectOutOfBandDeploys(null).detected).toBe(false);
  });
});

describe("detectOutOfBandDeploys — override globs", () => {
  test("custom globs replace the defaults", () => {
    const r = detectOutOfBandDeploys(
      ["infra/terraform/main.tf", "supabase/migrations/1.sql"],
      ["infra/**"]
    );
    expect(r.files).toEqual(["infra/terraform/main.tf"]);
    expect(r.globs).toEqual(["infra/**"]);
  });

  test("empty override array falls back to defaults", () => {
    const r = detectOutOfBandDeploys(["supabase/migrations/1.sql"], []);
    expect(r.detected).toBe(true);
    expect(r.globs).toEqual(DEFAULT_OUT_OF_BAND_GLOBS);
  });
});
