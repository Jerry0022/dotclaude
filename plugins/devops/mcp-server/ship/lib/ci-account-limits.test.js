import { describe, test, expect } from "vitest";
import { classifyAnnotations, classifyFailedChecks, jobIdFromLink } from "./ci-account-limits.js";

const QUOTA = "Failed to CreateArtifact: Artifact storage quota has been hit. Unable to upload any new artifacts.";
const MINUTES = "The job was not started because recent account payments have failed or your spending limit needs to be increased.";
const EXIT = "Process completed with exit code 1.";

describe("classifyAnnotations", () => {
  test("artifact quota alone → artifact-quota", () => {
    expect(classifyAnnotations([
      { annotation_level: "warning", message: "Node.js 20 is deprecated" },
      { annotation_level: "failure", message: QUOTA },
    ])).toBe("artifact-quota");
  });

  test("job never started → actions-minutes", () => {
    expect(classifyAnnotations([{ annotation_level: "failure", message: MINUTES }])).toBe("actions-minutes");
  });

  test("a real failure next to the quota hit is NOT a limit", () => {
    expect(classifyAnnotations([
      { annotation_level: "failure", message: EXIT },
      { annotation_level: "failure", message: QUOTA },
    ])).toBeNull();
  });

  test("no failure annotation → null (fail-closed)", () => {
    expect(classifyAnnotations([{ annotation_level: "notice", message: "x" }])).toBeNull();
    expect(classifyAnnotations(undefined)).toBeNull();
  });

  test("minutes lock outranks a quota hit", () => {
    expect(classifyAnnotations([
      { annotation_level: "failure", message: QUOTA },
      { annotation_level: "failure", message: MINUTES },
    ])).toBe("actions-minutes");
  });
});

describe("jobIdFromLink", () => {
  test("reads the job id from an Actions job link", () => {
    expect(jobIdFromLink("https://github.com/o/r/actions/runs/39300816321/job/123456")).toBe("123456");
  });
  test("returns null for an external status link", () => {
    expect(jobIdFromLink("https://vercel.com/o/r/abc")).toBeNull();
  });
});

describe("classifyFailedChecks", () => {
  const link = (id) => `https://github.com/o/r/actions/runs/1/job/${id}`;

  test("limited only when every failed check is limited", () => {
    const fetchAnnotations = (id) => (id === "1"
      ? [{ annotation_level: "failure", message: QUOTA }]
      : [{ annotation_level: "failure", message: EXIT }]);
    const both = classifyFailedChecks([{ name: "a", link: link(1) }, { name: "b", link: link(2) }], {}, { fetchAnnotations });
    expect(both.limited).toBe(false);
    const one = classifyFailedChecks([{ name: "a", link: link(1) }], {}, { fetchAnnotations });
    expect(one).toEqual({ limited: true, kinds: ["artifact-quota"], checks: [{ name: "a", kind: "artifact-quota" }] });
  });

  test("an unreadable annotation or a non-Actions check keeps the gate closed", () => {
    const fetchAnnotations = () => { throw new Error("HTTP 403"); };
    expect(classifyFailedChecks([{ name: "a", link: link(1) }], {}, { fetchAnnotations }).limited).toBe(false);
    expect(classifyFailedChecks([{ name: "vercel", link: "https://vercel.com/x" }], {}, { fetchAnnotations }).limited).toBe(false);
    expect(classifyFailedChecks([], {}, { fetchAnnotations }).limited).toBe(false);
  });
});
