import { describe, expect, it, vi } from "vitest";
import { ArchiveError, artifactView, downloadArtifact, readZip } from "./artifacts.js";
import { GitHubError } from "./github.js";
import { engineArchive, engineFiles, streamed, zip } from "./zip-fixture.js";

const small = { archive: 4096, file: 100, total: 150, files: 3 };
const unreadable = (run) => expect(run).toThrow(ArchiveError);

describe("reading a run's archive", () => {
  it("reads the engine's files from deflated or stored entries and ignores the rest", () => {
    const files = readZip(zip([
      { name: "result.json", content: '{"a":1}' },
      { name: "report.txt", content: "Report", method: 0 },
      { name: "message.eml", content: "Subject: not needed" },
      { name: "nested/", content: "" },
    ]));
    expect(files).toEqual({ "result.json": '{"a":1}', "report.txt": "Report" });
    expect(readZip(engineArchive("fix_verified"))).toEqual(engineFiles("fix_verified"));
  });

  it.each(["../result.json", "/result.json", "C:/result.json", "reports\\result.json", "a/../result.json", "./result.json",
    "a//result.json", "result\u0000.json"])("rejects the whole archive for the unsafe path %j", (name) => {
    expect(() => readZip(zip([{ name: "report.txt", content: "ok" }, { name, content: "x" }]))).toThrow(/unsafe file path/);
  });

  it("bounds sizes before inflating, and rejects damaged, encrypted or unusual archives", () => {
    const tooLarge = /too large/;
    expect(() => readZip(zip([{ name: "report.txt", content: "x".repeat(101) }]), undefined, small)).toThrow(tooLarge);
    // An unwanted entry still counts towards the total, without being inflated.
    expect(() => readZip(zip([{ name: "report.txt", content: "x".repeat(90) }, { name: "other.bin", content: "y".repeat(90) }]), undefined, small)).toThrow(tooLarge);
    expect(() => readZip(zip([1, 2, 3, 4].map((n) => ({ name: `f${n}`, content: "" }))), undefined, small)).toThrow(/too many files/);
    // A bomb that declares a small size but inflates past the per-file limit.
    expect(() => readZip(zip([{ name: "report.txt", content: "z".repeat(5000), length: 10 }]), undefined, small)).toThrow(/damaged/);
    expect(() => readZip(zip([{ name: "report.txt", content: "Report", crc: 1 }]))).toThrow(/damaged/);
    expect(() => readZip(zip([{ name: "report.txt", content: "Report", flags: 1 }]))).toThrow(/encrypted/);
    expect(() => readZip(zip([{ name: "report.txt", content: "Report", method: 12 }]))).toThrow(/compression/);
    expect(() => readZip(Buffer.from("not a zip at all"))).toThrow(/isn't a zip/);
    const archive = engineArchive("no_fix");
    unreadable(() => readZip(archive.subarray(0, archive.length - 30)));
  });
});

describe("downloading a run's archive", () => {
  const archive = engineArchive("no_pick");
  const stored = (body = archive, headers = {}) => ({ ok: true, status: 200, headers: new Headers(headers), body: streamed(body, 64) });
  const redirect = (location) => ({ ok: false, status: 302, headers: new Headers({ location }) });

  it("asks GitHub with the token, then follows its storage redirect once without it", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect("https://storage.example.net/a.zip?sig=signed")).mockResolvedValueOnce(stored());
    expect(await downloadArtifact("private-token", "/repos/octocat/scout/actions/artifacts/5/zip", { fetchImpl })).toEqual(archive);
    const [[api, first], [storage, second]] = fetchImpl.mock.calls;
    expect(api).toBe("https://api.github.com/repos/octocat/scout/actions/artifacts/5/zip");
    expect(first).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer private-token" } });
    expect(storage).toBe("https://storage.example.net/a.zip?sig=signed");
    expect(second.headers).toBeUndefined();
    expect(JSON.stringify(second)).not.toContain("private-token");
    expect(second.redirect).toBe("error"); // storage can't bounce the request anywhere else
  });

  it.each(["http://storage.example.net/a.zip", "https://user:pass@storage.example.net/a.zip", "not a url", ""])(
    "won't follow the redirect %j", async (location) => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(redirect(location));
      await expect(downloadArtifact("t", "/zip", { fetchImpl })).rejects.toBeInstanceOf(GitHubError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

  it("stops at the size limit, whether declared or only seen while reading", async () => {
    const limit = archive.length - 1;
    let fetchImpl = vi.fn().mockResolvedValueOnce(stored(archive, { "content-length": String(archive.length) }));
    await expect(downloadArtifact("t", "/zip", { fetchImpl, limit })).rejects.toThrow(/larger than/);
    fetchImpl = vi.fn().mockResolvedValueOnce(redirect("https://storage.example.net/a.zip")).mockResolvedValueOnce(stored());
    await expect(downloadArtifact("t", "/zip", { fetchImpl, limit })).rejects.toThrow(/larger than/);
  });

  it("says when GitHub has expired the archive or storage refuses it", async () => {
    let fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 410, headers: new Headers() });
    await expect(downloadArtifact("t", "/zip", { fetchImpl })).rejects.toMatchObject({ status: 410, message: expect.stringContaining("expired") });
    fetchImpl = vi.fn().mockResolvedValueOnce(redirect("https://storage.example.net/a.zip")).mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() });
    await expect(downloadArtifact("t", "/zip", { fetchImpl })).rejects.toMatchObject({ status: 502 });
  });
});

describe("the engine's result contract", () => {
  const view = (outcome, changes = {}, extra = {}) => {
    const files = engineFiles(outcome);
    files["result.json"] = JSON.stringify({ ...JSON.parse(files["result.json"]), ...changes });
    return artifactView({ ...files, ...extra });
  };

  it("reads each outcome the engine writes, without filling anything in", () => {
    const verified = artifactView(engineFiles("fix_verified"));
    expect(verified).toMatchObject({ outcome: "fix_verified", issue: { repo: "acme/core", number: 3, repo_stars: null }, artifact: { status: "available" } });
    expect(verified.report).toMatchObject({ tests_passed: true, regression_reproduced: true, cost_estimate: null, attempts: 1, runtime: "python312" });
    expect(verified.report.patch).toBe(engineFiles("fix_verified")["change.patch"]);
    const unproven = artifactView(engineFiles("fix_not_verified"));
    expect(unproven).toMatchObject({ outcome: "fix_not_verified", report: { tests_passed: true, regression_reproduced: false } });
    expect(unproven.outcome_reason).toContain("didn't fail on the unfixed code");
    const failed = artifactView(engineFiles("no_fix"));
    expect(failed).toMatchObject({ outcome: "no_fix", issue: { number: 2 }, artifact: { report_text: expect.stringContaining("No fix this time") } });
    expect(failed.report).toBeUndefined(); // no brief, validation or patch is invented for a failed fix step
    expect(artifactView(engineFiles("no_pick"))).toEqual({
      outcome: "no_pick", outcome_reason: expect.stringContaining("No issue was picked"), artifact: { status: "available", message: "" } });
  });

  it("reads a documentation fix and a code fix whose tests failed, each with its work type", () => {
    expect(artifactView(engineFiles("docs_verified"))).toMatchObject({
      outcome: "fix_verified", report: { work_type: "documentation", tests_passed: true, regression_reproduced: null, documentation_verified: true } });
    // The regression check only runs once a code fix's tests pass, so it has no verdict here.
    expect(artifactView(engineFiles("tests_failed"))).toMatchObject({
      outcome: "fix_not_verified", report: { work_type: "code", tests_passed: false, regression_reproduced: null, documentation_verified: false } });
    expect(artifactView(engineFiles("fix_verified")).report.work_type).toBe("code");
  });

  it("treats an archive from an older engine as older, showing only its saved files", () => {
    const { "result.json": _, ...files } = engineFiles("fix_verified");
    expect(artifactView(files)).toEqual({ artifact: { status: "older", message: expect.stringContaining("older Scout engine"), report_text: files["report.txt"], patch: files["change.patch"] } });
  });

  it.each([
    ["a verified claim without passing tests", "fix_verified", (r) => ({ fix: { ...r.fix, tests_passed: false, regression_reproduced: null } }), /verified fix without passing/],
    ["a verified claim without a reproduced regression", "fix_verified", (r) => ({ fix: { ...r.fix, regression_reproduced: false } }), /verified fix without passing/],
    ["a fix for a run that picked nothing", "no_pick", () => ({ fix: JSON.parse(engineFiles("fix_verified")["result.json"]).fix }), /picked no issue/],
    ["a fix for a failed fix step", "no_fix", () => ({ fix: JSON.parse(engineFiles("fix_verified")["result.json"]).fix }), /drafted none/],
    ["a newer schema", "fix_verified", () => ({ schema_version: 2 }), /newer Scout engine/],
    ["an unknown outcome", "fix_verified", () => ({ outcome: "fixed" }), /outcome is missing/],
    ["a text cost", "fix_verified", (r) => ({ fix: { ...r.fix, cost_estimate: "0.10" } }), /validation details/],
    ["a non-issue link", "fix_verified", (r) => ({ issue: { ...r.issue, url: "https://example.com/acme/core/issues/3" } }), /issue details/],
    ["a named patch that was also withheld", "fix_not_verified", () => ({ patch_withheld_reason: "github token matched in the output." }), /also withheld/],
    ["a code fix verified only by a documentation flag", "fix_verified", (r) => ({ fix: { ...r.fix, regression_reproduced: false, documentation_verified: true } }), /work type/],
    ["a code regression verdict without passing tests", "tests_failed", (r) => ({ fix: { ...r.fix, regression_reproduced: true } }), /work type/],
    ["a documentation fix with a regression verdict", "docs_verified", (r) => ({ fix: { ...r.fix, regression_reproduced: true } }), /work type/],
    ["a documentation fix verified without its checks", "docs_verified", (r) => ({ fix: { ...r.fix, documentation_verified: false } }), /work type/],
  ])("rejects %s", (_, outcome, change, message) => {
    expect(() => view(outcome, change(JSON.parse(engineFiles(outcome)["result.json"])))).toThrow(message);
  });

  it("rejects a result whose named files are missing, or that isn't JSON", () => {
    const files = engineFiles("fix_verified");
    expect(() => artifactView({ ...files, "change.patch": undefined })).toThrow(/patch file is missing/);
    expect(() => artifactView({ ...files, "report.txt": undefined })).toThrow(/report file is missing/);
    expect(() => artifactView({ "result.json": "{not json" })).toThrow(/isn't valid JSON/);
  });
});
