// A scout run's saved artifact (scout-result-<run>-<attempt>), read in main only: downloaded with the
// GitHub token, unpacked in memory, and checked against the template's result contract
// (reports/result.json, schema_version 1; see save_result in the template's scout.py).
import { crc32, inflateRawSync } from "node:zlib";
import { GitHubError } from "./github.js";

const API = "https://api.github.com";
export const LIMITS = { archive: 8 * 2 ** 20, file: 4 * 2 ** 20, total: 16 * 2 ** 20, files: 64 };
export const FILES = ["result.json", "report.txt", "change.patch"];
export const MESSAGES = {
  missing: "This run saved no report on GitHub.",
  expired: "GitHub keeps a run's saved report for 14 days, and this one has expired.",
  older: "This run was saved by an older Scout engine, so the app can't show its outcome or validation details. Its saved report is below.",
  unavailable: "GitHub didn't send this run's saved report. Try again in a minute.",
};

// The artifact itself can't be trusted: anything wrong with it is reported as unreadable, never guessed around.
export class ArchiveError extends Error {}
export const unreadable = (why) => new ArchiveError(`This run's saved report can't be read: ${why}.`);
const fail = (why) => { throw unreadable(why); };

// Downloads an artifact's zip. GitHub answers with a redirect to signed storage, which is followed once and
// without the GitHub token (the signed address authorizes itself). Reading stops past the size limit.
export async function downloadArtifact(token, route, { fetchImpl = fetch, limit = LIMITS.archive } = {}) {
  const response = await fetchImpl(`${API}${route}`, {
    redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (response.status === 410) throw new GitHubError(410, MESSAGES.expired);
  if (response.ok) return readLimited(response, limit);
  if (![301, 302, 303, 307, 308].includes(response.status))
    throw new GitHubError(response.status, response.status === 401 ? "Your GitHub sign-in expired. Please sign in again." : MESSAGES.unavailable);
  let target;
  try {
    target = new URL(response.headers.get("location"));
  } catch {
    target = undefined;
  }
  if (target?.protocol !== "https:" || target.username || target.password) throw new GitHubError(502, MESSAGES.unavailable);
  const stored = await fetchImpl(target.href, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30000) });
  if (!stored.ok) throw new GitHubError(502, MESSAGES.unavailable);
  return readLimited(stored, limit);
}

async function readLimited(response, limit) {
  const tooLarge = () => fail(`it is larger than the ${limit / 2 ** 20} MB the app reads`);
  if (Number(response.headers?.get("content-length")) > limit) tooLarge();
  const reader = response.body?.getReader();
  if (!reader) fail("GitHub sent an empty download");
  const chunks = [];
  for (let size = 0; ;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      tooLarge();
    }
    chunks.push(value);
  }
}

// A relative path of plain segments: no absolute or drive paths, backslashes, "." or ".." parts, or control characters.
const safePath = (name) => name.length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f\\:]/.test(name) && !name.startsWith("/")
  && name.replace(/\/$/, "").split("/").every((part) => part && part !== "." && part !== "..");

// Reads the `wanted` files from a zip in memory. Only stored and deflated entries; no ZIP64, split or
// encrypted archives. Every name is checked, sizes are bounded before inflating, and CRCs must match.
export function readZip(buffer, wanted = FILES, limits = LIMITS) {
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 0xffff); at--)
    if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  if (end < 0) fail("it isn't a zip archive");
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), offset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count) fail("it is a split archive");
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) fail("it uses an unsupported zip format");
  if (count > limits.files) fail("it holds too many files");
  if (offset + size > end) fail("it is damaged");
  const files = {};
  const names = new Set();
  let total = 0;
  for (let at = offset, index = 0; index < count; index++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) fail("it is damaged");
    const flags = buffer.readUInt16LE(at + 8), method = buffer.readUInt16LE(at + 10), crc = buffer.readUInt32LE(at + 16);
    const packed = buffer.readUInt32LE(at + 20), length = buffer.readUInt32LE(at + 24), local = buffer.readUInt32LE(at + 42);
    const nameEnd = at + 46 + buffer.readUInt16LE(at + 28);
    const name = buffer.toString("utf8", at + 46, Math.min(nameEnd, end));
    at = nameEnd + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (at > end) fail("it is damaged");
    if (!safePath(name)) fail("it contains an unsafe file path");
    if (names.has(name)) fail("it contains a file twice");
    names.add(name);
    if (flags & 1) fail("it is encrypted");
    if (name.endsWith("/")) continue;
    total += length;
    if (length > limits.file || total > limits.total) fail("its files are too large");
    if (!wanted.includes(name)) continue;
    if (local + 30 > offset || buffer.readUInt32LE(local) !== 0x04034b50) fail("it is damaged");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + packed > offset) fail("it is damaged");
    const data = buffer.subarray(start, start + packed);
    let content;
    if (method === 0) content = data;
    else if (method === 8) {
      try {
        content = inflateRawSync(data, { maxOutputLength: limits.file });
      } catch {
        fail("it is damaged");
      }
    } else fail("it uses an unsupported compression method");
    if (content.length !== length || crc32(content) !== crc) fail("it is damaged");
    files[name] = content.toString("utf8");
  }
  return files;
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string";
const texts = (value) => Array.isArray(value) && value.every(text);
const commands = (value) => Array.isArray(value) && value.every(texts);
const flag = (value) => typeof value === "boolean";
const whole = (value) => Number.isSafeInteger(value) && value >= 0;
const amount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const or = (check) => (value) => value === null || value === undefined || check(value);
const OUTCOMES = ["fix_verified", "fix_not_verified", "no_fix", "no_pick"];
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*$/;
const BRIEF = ["root_cause", "approach", "risks", "not_verified", "claim_comment", "commit_message", "pr_title", "pr_body"];
const DELIVERY = ["sent", "disabled", "failed", "pending"];

function issueOf(value) {
  // The URL is only checked for shape: an issue can be transferred, and its repository renamed, after Scout read it.
  if (!object(value) || !text(value.url) || !ISSUE_URL.test(value.url) || !text(value.repo) || !whole(value.number) || !text(value.title)
      || !or(texts)(value.labels) || !or(whole)(value.repo_stars) || !or(text)(value.updated_at) || !or(text)(value.body_excerpt)
      || !or(text)(value.why) || !or(text)(value.work_type) || !or(text)(value.language) || !or(text)(value.feasibility)
      || !or((policy) => object(policy) && or(text)(policy.status) && or(text)(policy.quote))(value.ai_policy))
    fail("its issue details are incomplete");
  return {
    url: value.url, repo: value.repo, number: value.number, title: value.title, labels: value.labels ?? [],
    repo_stars: value.repo_stars ?? null, updated_at: value.updated_at ?? null, body_excerpt: value.body_excerpt ?? "",
    why: value.why ?? "", work_type: value.work_type ?? null, language: value.language ?? null, feasibility: value.feasibility ?? null,
    ai_policy: value.ai_policy?.status ? { status: value.ai_policy.status, quote: value.ai_policy.quote ?? "" } : null,
  };
}

function fixOf(value) {
  if (!object(value) || !flag(value.tests_passed) || !or(flag)(value.regression_reproduced) || !flag(value.documentation_verified)
      || !or(text)(value.runtime) || !commands(value.setup_commands) || !commands(value.test_commands)
      || !text(value.validation_log) || !text(value.regression_log) || !or(amount)(value.cost_estimate)
      || !or(whole)(value.fix_attempts) || !or(text)(value.provider) || !BRIEF.every((key) => or(text)(value[key]))
      || !or(texts)(value.maintainer_questions) || !or(texts)(value.checklist))
    fail("its validation details are incomplete");
  return value;
}

const notificationOf = (value) => {
  const optional = (field) => field === undefined || text(field);
  if (!object(value) || !DELIVERY.includes(value.status) || !whole(value.attempts) || !optional(value.reason) || !optional(value.error))
    fail("its email outcome is incomplete");
  return { status: value.status, attempts: value.attempts, ...(value.reason ? { reason: value.reason } : {}), ...(value.error ? { error: value.error } : {}) };
};

// Checks result.json and every claim it makes against the other files. Nothing missing is filled in.
export function parseResult(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    fail("its result file isn't valid JSON");
  }
  if (!object(data)) fail("its result file has an unknown format");
  if (data.schema_version !== 1)
    fail(Number.isSafeInteger(data.schema_version) && data.schema_version > 1
      ? "it was saved by a newer Scout engine. Update Issue Scout to read it"
      : "its result file has an unknown format");
  if (!OUTCOMES.includes(data.outcome) || !text(data.reason)) fail("its outcome is missing");
  const picked = data.outcome !== "no_pick", fixed = picked && data.outcome !== "no_fix";
  if (!picked && [data.issue, data.fix, data.report_file, data.patch_file, data.notification].some((value) => value !== null))
    fail("it describes a fix for a run that picked no issue");
  if (picked && data.report_file !== "report.txt") fail("its report file isn't named");
  if (!or((name) => name === "change.patch")(data.patch_file) || !or(text)(data.patch_withheld_reason)) fail("its patch details are incomplete");
  if (!fixed && (data.fix !== null || data.patch_file !== null)) fail("it describes a fix for a run that drafted none");
  // change.patch is saved only when it passed the engine's secret checks, so a withheld patch never has one.
  if (data.patch_file && data.patch_withheld_reason != null) fail("it names a patch that was also withheld");
  const issue = picked ? issueOf(data.issue) : null;
  const fix = fixed ? fixOf(data.fix) : null;
  if (fix) {
    // As the engine's solve() sets them: documentation checks stand in for the regression check, and a code
    // fix's regression check runs only once its tests pass. Any other work type is code to the engine.
    const documentation = issue.work_type === "documentation";
    if (documentation ? fix.regression_reproduced !== null || fix.documentation_verified !== fix.tests_passed
      : fix.documentation_verified || (fix.regression_reproduced === null) === fix.tests_passed)
      fail("its validation results don't match the issue's work type");
    if (data.outcome === "fix_verified" && !(fix.tests_passed && data.patch_file && (documentation || fix.regression_reproduced === true)))
      fail("it claims a verified fix without passing checks and a patch");
  }
  return {
    outcome: data.outcome, reason: data.reason, issue, fix,
    patch_file: data.patch_file, patch_withheld_reason: data.patch_withheld_reason ?? null,
    notification: picked ? notificationOf(data.notification) : null,
  };
}

// What the app shows for an artifact's files: the run's outcome, issue and report (RunReport in src/types.ts).
export function artifactView(files) {
  const reportText = files["report.txt"], patch = files["change.patch"];
  if (files["result.json"] === undefined)
    return { artifact: { status: "older", message: MESSAGES.older, ...(reportText ? { report_text: reportText } : {}), ...(patch ? { patch } : {}) } };
  const result = parseResult(files["result.json"]);
  if (result.issue && reportText === undefined) fail("its report file is missing");
  if (result.patch_file && patch === undefined) fail("its patch file is missing");
  const view = { outcome: result.outcome, outcome_reason: result.reason, artifact: { status: "available", message: "" } };
  if (result.issue) view.issue = result.issue;
  if (!result.fix) {
    if (reportText) view.artifact.report_text = reportText; // a pick without a fix still has its report
    return view;
  }
  const { fix } = result;
  view.report = {
    ...Object.fromEntries(BRIEF.map((key) => [key, fix[key] ?? ""])),
    maintainer_questions: fix.maintainer_questions ?? [], checklist: fix.checklist ?? [],
    work_type: result.issue.work_type === "documentation" ? "documentation" : "code",
    runtime: fix.runtime, setup_commands: fix.setup_commands, test_commands: fix.test_commands,
    tests_passed: fix.tests_passed, regression_reproduced: fix.regression_reproduced, documentation_verified: fix.documentation_verified,
    validation_log: fix.validation_log, regression_log: fix.regression_log,
    cost_estimate: fix.cost_estimate, attempts: fix.fix_attempts, provider: fix.provider,
    patch: result.patch_file ? patch : null,
    ...(result.patch_withheld_reason ? { patch_withheld_reason: result.patch_withheld_reason } : {}),
    report_text: reportText, notification: result.notification,
  };
  return view;
}
