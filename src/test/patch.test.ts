// @vitest-environment node
import { expect, it } from "vitest";
import { sideLines, splitPatch, type SplitPatch } from "../patch";

// Real `git diff --cached -M` output, generated once in a scratch repository (git 2.x, core.quotepath on) and kept
// byte for byte (.gitattributes: -text). See docs/evidence-walkthrough.md, "Patch handling".
const raw = import.meta.glob("./patches/*.patch", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const fixture = (name: string) => {
  const text = raw[`./patches/${name}.patch`];
  if (!text) throw new Error(`missing fixture ${name}`);
  return text;
};
const split = (name: string): SplitPatch => {
  const result = splitPatch(fixture(name));
  if (!result) throw new Error(`${name} was not split`);
  return result;
};
const summary = (name: string) =>
  split(name).files.map(({ path, oldPath, status, binary, hunks }) => ({ path, oldPath, status, binary, hunks: hunks.length }));
const text = (result: SplitPatch, range: { start: number; end: number }) => result.lines.slice(range.start, range.end).join("\n");

it("has all twelve fixtures, with their bytes intact", () => {
  expect(Object.keys(raw)).toHaveLength(12);
  expect(fixture("crlf")).toContain("+R2\r\n");
  expect(fixture("multi-hunk")).not.toContain("\r");
});

it.each(Object.keys(raw))("%s: ranges tile the original patch exactly", (key) => {
  const original = raw[key];
  const result = splitPatch(original)!;
  expect(result).not.toBeNull();
  expect(result.lines.join("\n") + "\n").toBe(original);
  let at = 0;
  for (const file of result.files) {
    expect(file.start).toBe(at);
    expect(result.lines[file.start]).toMatch(/^diff --git /);
    let inner = file.hunks[0]?.start ?? file.end;
    for (const hunk of file.hunks) {
      expect(hunk.start).toBe(inner);
      expect(result.lines[hunk.start]).toMatch(/^@@ -\d/);
      inner = hunk.end;
    }
    expect(inner).toBe(file.end);
    at = file.end;
  }
  expect(at).toBe(result.lines.length);
});

it("points each hunk of a modified file at its own change", () => {
  const result = split("multi-hunk");
  expect(summary("multi-hunk")).toEqual([{ path: "multi.txt", oldPath: undefined, status: "modified", binary: false, hunks: 3 }]);
  const [first, second, third] = result.files[0].hunks.map((hunk) => text(result, hunk));
  expect(first).toContain("+line three");
  expect(first).not.toContain("thirty");
  expect(second).toContain("+line thirty");
  expect(second).not.toContain("three");
  expect(third).toContain("+line fifty-eight");
  expect(result.lines[result.files[0].hunks[1].start]).toMatch(/^@@ -27,7 \+27,7 @@/);
});

it("names added, deleted and renamed files", () => {
  expect(summary("new-file")).toEqual([{ path: "added.txt", oldPath: undefined, status: "added", binary: false, hunks: 1 }]);
  expect(summary("deleted-file")).toEqual([{ path: "deleted.txt", oldPath: undefined, status: "deleted", binary: false, hunks: 1 }]);
  expect(summary("rename-pure")).toEqual([{ path: "new-name.txt", oldPath: "old-name.txt", status: "renamed", binary: false, hunks: 0 }]);
  expect(summary("rename-changed")).toEqual([{ path: "moved-to.txt", oldPath: "moved-from.txt", status: "renamed", binary: false, hunks: 1 }]);
});

it("reads quoted and spaced paths as the real file names", () => {
  expect(summary("quoted-paths").map((file) => file.path)).toEqual(["naïve.txt", "with space.txt"]);
});

it("lists binary and mode-only changes without hunks", () => {
  expect(summary("binary")).toEqual([{ path: "blob.bin", oldPath: undefined, status: "modified", binary: true, hunks: 0 }]);
  expect(summary("mode-only")).toEqual([{ path: "run.sh", oldPath: undefined, status: "modified", binary: false, hunks: 0 }]);
});

it("keeps 'No newline at end of file' markers and CRLF content inside their hunk", () => {
  const nonl = split("no-final-newline");
  expect(text(nonl, nonl.files[0].hunks[0]).split("\n").slice(-4)).toEqual(["-two", "\\ No newline at end of file", "+TWO", "\\ No newline at end of file"]);
  const crlf = split("crlf");
  expect(text(crlf, crlf.files[0].hunks[0])).toContain("-r2\r\n+R2\r");
});

it("splits several files, each range starting at that file's own header", () => {
  expect(summary("two-files").map((file) => [file.path, file.hunks])).toEqual([["multi.txt", 3], ["second.txt", 1]]);
  const all = split("everything");
  expect(all.files.map((file) => file.path)).toEqual([
    "added.txt", "blob.bin", "crlf.txt", "deleted.txt", "moved-to.txt", "multi.txt", "naïve.txt", "new-name.txt",
    "nonl.txt", "run.sh", "second.txt", "with space.txt",
  ]);
  for (const file of all.files) expect(all.lines[file.start]).toContain(file.oldPath ?? (file.path === "naïve.txt" ? "na\\303\\257ve" : file.path));
});

it("isn't fooled by removed lines that look like headers", () => {
  const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,2 @@\n keep\n--- a/not-a-header\n-@@ -9,9 +9,9 @@\n+diff --git a/y b/y\n";
  const result = splitPatch(patch)!;
  expect(result.files).toHaveLength(1);
  expect(result.files[0]).toMatchObject({ path: "x", hunks: [{ start: 3, end: 8 }] });
});

it("accepts a patch without a final newline", () => {
  expect(splitPatch(fixture("new-file").replace(/\n$/, ""))?.files[0].path).toBe("added.txt");
});

it.each([
  ["an empty patch", ""],
  ["text before the first file", "From: someone\n" + "diff --git a/x b/x\nold mode 100644\nnew mode 100755\n"],
  ["a hunk cut short", "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n"],
  ["a hunk with more lines than its header counts", "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n+c\n"],
  ["a line that is neither context nor change", "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\nstray\n+b\n"],
  ["an unknown header line", "diff --git a/x b/y\ncopy from x\ncopy to y\n"],
  ["a binary body", "diff --git a/x b/x\nindex 1..2 100644\nGIT binary patch\nliteral 3\nKcmZQzWMT#Y01f~L\n"],
  ["names without a/ and b/ prefixes", "diff --git x x\n--- x\n+++ x\n@@ -1 +1 @@\n-a\n+b\n"],
  ["a broken quoted name", 'diff --git "a/x\\q" "b/x\\q"\nold mode 100644\nnew mode 100755\n'],
  ["CRLF header lines", "diff --git a/x b/x\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n"],
])("falls back to the unsplit patch for %s", (_name, patch) => {
  expect(splitPatch(patch)).toBeNull();
});

it("splits the engine's own saved patch or falls back, never throws", async () => {
  const modules = ["../../electron/artifacts.js", "../../electron/zip-fixture.js"];
  const { artifactView } = await import(/* @vite-ignore */ modules[0]);
  const { engineFiles } = await import(/* @vite-ignore */ modules[1]);
  const patch: string = artifactView(engineFiles("fix_verified")).report.patch;
  const result = splitPatch(patch);
  if (result) expect(result.lines.join("\n")).toBe(patch.replace(/\n$/, ""));
});

it("gives each side's shown lines their real line numbers", () => {
  const multi = split("multi-hunk");
  const [file] = multi.files;
  expect(file.hunks.map((hunk) => [hunk.oldStart, hunk.newStart])).toEqual([[1, 1], [27, 27], [55, 55]]);
  const original = sideLines(multi, file, "original"), patched = sideLines(multi, file, "patched");
  expect(original.get(30)).toEqual({ text: "line 30", changed: true });
  expect(patched.get(30)).toEqual({ text: "line thirty", changed: true });
  expect(original.get(29)).toEqual({ text: "line 29", changed: false });
  expect(original.get(15)).toBeUndefined(); // between hunks: the patch doesn't show it

  // Added lines shift what follows: line 2 originally is line 3 once a line is added above it.
  const shifted = splitPatch("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n a\n+new\n b\n")!;
  expect(sideLines(shifted, shifted.files[0], "original").get(2)).toEqual({ text: "b", changed: false });
  expect(sideLines(shifted, shifted.files[0], "patched").get(3)).toEqual({ text: "b", changed: false });

  const nonl = split("no-final-newline");
  expect([...sideLines(nonl, nonl.files[0], "patched")]).toEqual([[1, { text: "one", changed: false }], [2, { text: "TWO", changed: true }]]);
  const added = split("new-file");
  expect(sideLines(added, added.files[0], "original").size).toBe(0);
});
