// Splits a saved `git diff` into files and hunks for the evidence walkthrough (docs/evidence-walkthrough.md).
// The patch string itself is never rebuilt: `lines` is the original split on "\n" and every file and hunk is a
// range of line indexes into it (end exclusive). Anything this reader can't account for returns null, and the
// caller shows the patch unsplit. File names come from the patch and are untrusted text.

export type PatchFile = {
  path: string;
  /** The previous path, for renames only. */
  oldPath?: string;
  status: "modified" | "added" | "deleted" | "renamed";
  /** Git recorded "Binary files differ": there are no hunks to show. */
  binary: boolean;
  start: number;
  end: number;
  /** `oldStart` and `newStart` are the file line numbers its header gives for the first line on each side. */
  hunks: { start: number; end: number; oldStart: number; newStart: number }[];
};
export type SplitPatch = { lines: string[]; files: PatchFile[] };

/** The lines of one side of a file that the patch shows, by line number in that version of the file. A diff
 *  carries only a few lines of context, so most of a file is absent here; absent is unknown, not wrong. */
export function sideLines(split: SplitPatch, file: PatchFile, side: "original" | "patched") {
  const shown = new Map<number, { text: string; changed: boolean }>();
  const own = side === "original" ? "-" : "+";
  for (const hunk of file.hunks) {
    let number = side === "original" ? hunk.oldStart : hunk.newStart;
    for (const line of split.lines.slice(hunk.start + 1, hunk.end))
      if (line[0] === " " || line[0] === own) shown.set(number++, { text: line.slice(1), changed: line[0] === own });
  }
  return shown;
}

export function splitPatch(patch: string): SplitPatch | null {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const files: PatchFile[] = [];
  for (let at = 0; at < lines.length; ) {
    const file = readFile(lines, at);
    if (!file) return null;
    files.push(file);
    at = file.end;
  }
  return files.length ? { lines, files } : null;
}

const IGNORED = /^(?:(?:old|new) mode \d{6}|index [0-9a-f]+\.\.[0-9a-f]+(?: \d{6})?|(?:dis)?similarity index \d+%)$/;

function readFile(lines: string[], start: number): PatchFile | null {
  if (!lines[start].startsWith("diff --git ")) return null;
  let status: PatchFile["status"] = "modified";
  let binary = false;
  let from: string | undefined, to: string | undefined, minus: string | undefined, plus: string | undefined;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("@@ ") || line.startsWith("diff --git ")) break;
    if (IGNORED.test(line)) continue;
    if (/^new file mode \d{6}$/.test(line)) status = "added";
    else if (/^deleted file mode \d{6}$/.test(line)) status = "deleted";
    else if (/^Binary files .* differ$/.test(line)) binary = true;
    else {
      // ponytail: copies and `GIT binary patch` bodies fall through to null (unsplit); add when the engine emits them.
      const [, key, text] = /^(rename from|rename to|---|\+\+\+) (.*)$/.exec(line) ?? [];
      if (!key) return null;
      const name = key.startsWith("rename") ? unquote(text) : side(text, key === "---" ? "a/" : "b/");
      if (name === null) return null;
      if (key === "rename from") from = name;
      else if (key === "rename to") to = name;
      else if (key === "---") minus = name;
      else plus = name;
    }
  }
  if (from !== undefined && to !== undefined) status = "renamed";

  const hunks: PatchFile["hunks"] = [];
  while (i < lines.length && lines[i].startsWith("@@ ")) {
    const counts = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!counts) return null;
    let before = Number(counts[2] ?? 1);
    let after = Number(counts[4] ?? 1);
    const hunkStart = i++;
    // Counting the body, not looking for the next header: a removed line may itself start with "-- " or "@@".
    while (before > 0 || after > 0) {
      const mark = lines[i]?.[0];
      if (mark === " ") { before--; after--; }
      else if (mark === "-") before--;
      else if (mark === "+") after--;
      else if (mark !== "\\") return null;
      i++;
    }
    if (before < 0 || after < 0) return null;
    while (lines[i]?.startsWith("\\")) i++;
    hunks.push({ start: hunkStart, end: i, oldStart: Number(counts[1]), newStart: Number(counts[3]) });
  }

  const path = to || plus || minus || sameName(lines[start]);
  if (!path) return null;
  return { path, ...(status === "renamed" ? { oldPath: from } : {}), status, binary, start, end: i, hunks };
}

/** A `---`/`+++` name without its a/ or b/ prefix; "" for /dev/null; null when it isn't in that form. */
function side(text: string, prefix: string): string | null {
  const name = unquote(text.replace(/\t$/, "")); // git ends names that contain spaces with a tab
  if (name === "/dev/null") return "";
  return name && name.startsWith(prefix) && name.length > 2 ? name.slice(2) : null;
}

/** The path from `diff --git a/P b/P`, the only source for mode-only and binary changes (both names are equal). */
function sameName(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  const quoted = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(rest);
  const middle = (rest.length - 1) / 2;
  const [a, b] = quoted ? [unquote(quoted[1]), unquote(quoted[2])] : [rest.slice(0, middle), rest.slice(middle + 1)];
  if (!quoted && rest[middle] !== " ") return null;
  if (!a || !b || !a.startsWith("a/") || !b.startsWith("b/") || a.slice(2) !== b.slice(2)) return null;
  return a.slice(2) || null;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Undoes git's C-style quoting ("na\303\257ve.txt"); unquoted names pass through; null when malformed. */
function unquote(text: string): string | null {
  if (!text.startsWith('"')) return text;
  if (text.length < 2 || !text.endsWith('"')) return null;
  const bytes: number[] = [];
  const token = /\\([0-7]{3})|\\(.)|([^\\"]+)/y;
  const body = text.slice(1, -1);
  let at = 0;
  for (let match; at < body.length && (match = token.exec(body)); at = token.lastIndex) {
    if (match[1]) bytes.push(parseInt(match[1], 8) & 255);
    else if (match[2]) {
      if (!(match[2] in ESCAPES)) return null;
      bytes.push(ESCAPES[match[2]]);
    } else bytes.push(...new TextEncoder().encode(match[3]));
  }
  if (at < body.length) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
