import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import { GitHubError, githubRequest } from "./github.js";

// The daily schedule lives in the template's workflow as `on.schedule` with GitHub's own `timezone` key, so
// GitHub keeps the run at the same local time through daylight saving changes (no UTC conversion here).
const PATH = ".github/workflows/daily.yml";
const MAX_BYTES = 100_000;
const DEFAULT_TIME = "09:30"; // GitHub delays more scheduled runs on the hour
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ZONE = /^(UTC|[A-Z][A-Za-z_+-]*(\/[A-Z][A-Za-z0-9_+-]*){1,2})$/;
const validSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// An IANA name as GitHub expects it (canonical case), that this machine's time zone data knows.
export function validZone(zone) {
  if (typeof zone !== "string" || !ZONE.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const unsupported = () => new GitHubError(422, "Your daily.yml lays out its triggers (`on:`) in a way the app can't edit. Add the schedule on GitHub instead (see the template README).");
const blank = (line) => /^[ \t]*(#.*)?\r?$/.test(line);
const indentOf = (line) => line.match(/^ */)[0].length;

// The workflow as GitHub reads it. This decides whether a schedule exists, so no comment, quoting or
// indentation style can hide one. The yaml package reads YAML 1.2, where `on` is a plain key, and rejects duplicate keys.
function workflow(text) {
  let value;
  try {
    value = parseYaml(text);
  } catch {
    throw new GitHubError(422, "Your daily.yml isn't valid YAML. Fix it on GitHub before changing the schedule.");
  }
  if (!object(value) || !object(value.on)) throw unsupported();
  return value;
}

// One daily cron and an optional time zone: what the app writes, and the template README's hand-written form.
export function readSchedule(text) {
  const schedule = workflow(text).on.schedule;
  if (schedule === undefined) return { enabled: false, custom: false };
  const entry = Array.isArray(schedule) && schedule.length === 1 && object(schedule[0]) ? schedule[0] : {};
  const cron = typeof entry.cron === "string" ? /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(entry.cron) : null;
  const [minute, hour] = cron ? [Number(cron[1]), Number(cron[2])] : [];
  const simple = cron && minute <= 59 && hour <= 23 && Object.keys(entry).every((key) => key === "cron" || key === "timezone")
    && (entry.timezone === undefined || typeof entry.timezone === "string");
  if (!simple) return { enabled: true, custom: true };
  return { enabled: true, custom: false, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, timezone: entry.timezone ?? "UTC" };
}

const KEY = (name) => new RegExp(`^ *(${name}|"${name}"|'${name}')[ \\t]*:([ \\t]|\\r?$)`);

// Finds the `schedule:` entry's lines inside the top-level `on:` mapping, so only those lines are rewritten and
// every other line, comment and line ending stays byte for byte. writeSchedule checks the result with a real parse.
function locate(text) {
  const lines = text.split("\n");
  const on = lines.findIndex((line) => /^(on|"on"|'on')[ \t]*:[ \t]*(#.*)?\r?$/.test(line));
  if (on < 0) throw unsupported();
  // The mapping runs until the next top-level key; comments at any column don't end it.
  let end = on + 1;
  while (end < lines.length && (blank(lines[end]) || /^[ \t]/.test(lines[end]))) end++;
  while (end > on + 1 && blank(lines[end - 1])) end--; // trailing blank lines and comments go with the next section
  const first = lines.slice(on + 1, end).find((line) => !blank(line));
  if (!first || /^\t/.test(first)) throw unsupported();
  const indent = indentOf(first);
  const start = lines.findIndex((line, index) => index > on && index < end && indentOf(line) === indent && KEY("schedule").test(line));
  let stop = start + 1;
  if (start >= 0) {
    // Its value: deeper lines, and list items YAML allows at the key's own indentation.
    while (stop < end && (blank(lines[stop]) || indentOf(lines[stop]) > indent || /^ *-([ \t]|\r?$)/.test(lines[stop]))) stop++;
    while (stop > start + 1 && blank(lines[stop - 1])) stop--;
  }
  return { lines, end, indent, start, stop };
}

const refused = () => new GitHubError(422, "The app can't change the schedule in your daily.yml without touching anything else. Edit the schedule on GitHub instead (see the template README).");

export function writeSchedule(text, { enabled, time, timezone }) {
  const before = workflow(text);
  const { lines, end, indent, start, stop } = locate(text);
  const cr = text.includes("\r\n") ? "\r" : "";
  const pad = " ".repeat(indent);
  const [hour, minute] = enabled ? time.split(":").map(Number) : [];
  const cron = `${minute} ${hour} * * *`;
  const block = enabled ? [
    `${pad}schedule:   # set by the Issue Scout app`,
    `${pad}  - cron: "${cron}"`,
    `${pad}    timezone: "${timezone}"`,
  ].map((line) => line + cr) : [];
  if (start >= 0) lines.splice(start, stop - start, ...block);
  else lines.splice(end, 0, ...block);
  const next = lines.join("\n");
  // The edited file must read exactly as before, apart from on.schedule. Anything else (a schedule this
  // text edit couldn't find, a duplicate key, broken YAML) is refused rather than saved.
  const expected = structuredClone(before);
  if (enabled) expected.on.schedule = [{ cron, timezone }];
  else delete expected.on.schedule;
  let after;
  try {
    after = workflow(next);
  } catch {
    throw refused();
  }
  if (!isDeepStrictEqual(after, expected)) throw refused();
  return next;
}

export function createScheduleRoutes({ repositoryContext, readProfile, fetchImpl }) {
  // Bind edits to the repository, its default branch and daily.yml's blob (as profile.js does for profile.json).
  const editRevision = (context, sha) => `${context.repo.id}:${encodeURIComponent(context.repo.default_branch)}:${sha}`;
  const request = (context, route, options = {}) => githubRequest(context.token, `/repos/${context.repo.full_name}${route}`, { ...options, fetchImpl });
  // The last daily.yml this app wrote, keyed by its edit revision: GitHub can serve the older file for a few
  // seconds after a write, which would make a quick second save look like a conflict.
  let written;

  async function read(context) {
    const file = await request(context, `/contents/${PATH}?ref=${encodeURIComponent(context.repo.default_branch)}`, {
      messages: { 404: "Your Scout repository has no .github/workflows/daily.yml. Restore it from the template, then try again." },
    });
    let text;
    try {
      if (file?.type !== "file" || file.encoding !== "base64" || !validSha(file.sha) || typeof file.content !== "string") throw new Error();
      const bytes = Buffer.from(file.content, "base64");
      if (bytes.length > MAX_BYTES) throw new Error();
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new GitHubError(502, "GitHub returned an unreadable daily.yml. Review it on GitHub before changing the schedule.");
    }
    context.assertCurrent();
    return { text, sha: file.sha };
  }

  async function view(context, file) {
    const setupRequired = Boolean((await readProfile(context)).setup_required);
    const schedule = readSchedule(file.text);
    return {
      revision: editRevision(context, file.sha),
      enabled: schedule.enabled,
      custom: schedule.custom,
      time: schedule.time ?? DEFAULT_TIME,
      timezone: schedule.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      setup_required: setupRequired,
    };
  }

  function validate(body) {
    if (!object(body) || typeof body.revision !== "string") throw new GitHubError(409, "Reload the schedule before saving.");
    if (typeof body.enabled !== "boolean") throw new GitHubError(422, "Choose whether Scout runs every day.", { enabled: "Turn daily runs on or off." });
    if (!body.enabled) return;
    const fields = {};
    if (typeof body.time !== "string" || !TIME.test(body.time)) fields.time = "Choose a time between 00:00 and 23:59.";
    if (!validZone(body.timezone)) fields.timezone = "Choose a time zone from the list, such as America/New_York.";
    if (Object.keys(fields).length) throw new GitHubError(422, "Check the highlighted schedule settings.", fields);
  }

  return {
    "GET /api/schedule": async () => {
      const context = await repositoryContext();
      return [200, await view(context, await read(context))];
    },
    "PUT /api/schedule": async (body) => {
      validate(body);
      const context = await repositoryContext();
      const previous = written?.key === body.revision ? written : await read(context);
      if (editRevision(context, previous.sha) !== body.revision)
        throw new GitHubError(409, "Your schedule or repository selection changed on GitHub. Reload the latest version before saving.");
      // The engine stops at once while setup is unfinished, so don't have GitHub start it every day for nothing.
      if (body.enabled && (await readProfile(context)).setup_required)
        throw new GitHubError(409, "Finish setup first: save a model and key for both stages in Models, then turn on daily runs.");
      const text = writeSchedule(previous.text, body);
      if (text === previous.text) return [200, await view(context, previous)];
      context.assertCurrent();
      let result;
      try {
        result = await request(context, `/contents/${PATH}`, {
          method: "PUT",
          body: {
            message: body.enabled ? `Issue Scout: run daily at ${body.time} ${body.timezone}` : "Issue Scout: turn off daily runs",
            branch: context.repo.default_branch, sha: previous.sha, content: Buffer.from(text, "utf8").toString("base64"),
          },
        });
      } catch (error) {
        if (![409, 422].includes(error.status)) throw error;
        // GitHub answers 409 both for a newer file and for branch rules; only a newer file is fixed by reloading.
        const latest = error.status === 409 ? await read(context).catch(() => undefined) : undefined;
        if (latest && latest.sha !== previous.sha) throw new GitHubError(409, "daily.yml changed on GitHub. Reload the latest version before saving again.");
        throw new GitHubError(422, `GitHub refused to save daily.yml${error.detail ? `: ${error.detail}` : ""}. Check this repository's branch rules and that your sign-in can edit workflows.`);
      }
      context.assertCurrent();
      if (!validSha(result?.content?.sha)) throw new GitHubError(502, "GitHub saved daily.yml but returned incomplete information. Reload before saving again.");
      written = { key: editRevision(context, result.content.sha), text, sha: result.content.sha };
      return [200, await view(context, written)];
    },
  };
}
