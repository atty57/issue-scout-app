// History: the engine's own record of every issue it attempted (state/seen.json in the Scout repository,
// written by notify() in the template's scout.py). Only fields that are present are shown; nothing is filled in.
import { GitHubError, githubRequest } from "./github.js";

const ISSUE = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)\/?$/i;
const STATUSES = ["notified", "completed", "failed"]; // notified: verified and delivered; completed: verified, email not sent
const MAX_BYTES = 1_000_000; // the contents API returns files inline up to 1 MB
const UNREADABLE = "Your Scout history (state/seen.json) can't be read, so Scout won't run until it is fixed. Review it on GitHub.";
const text = (value) => typeof value === "string" && value.length <= 4000;
const FIELDS = {
  attempted_at: text, retry_after: text, why: text, reason: text, work_type: text, language: text,
  attempts: (value) => Number.isSafeInteger(value) && value >= 0,
  score: (value) => typeof value === "number" && Number.isFinite(value),
  tests_passed: (value) => typeof value === "boolean",
  documentation_verified: (value) => typeof value === "boolean",
  reproduces: (value) => value === null || typeof value === "boolean",
  notification: (value) => value !== null && typeof value === "object" && text(value.status)
    && [value.reason, value.error].every((field) => field === undefined || text(field)),
};

function item(url, record) {
  const match = typeof url === "string" ? ISSUE.exec(url) : null;
  if (!match) return null;
  const base = { url: `https://github.com/${match[1]}/issues/${match[2]}`, repo: match[1], number: Number(match[2]) };
  if (record === undefined) return { ...base, status: "notified", legacy: true }; // the old URL-only file listed delivered issues
  if (record === null || typeof record !== "object" || !STATUSES.includes(record.status)) return null;
  const known = Object.entries(FIELDS).filter(([key, valid]) => valid(record[key])).map(([key]) => [key,
    key === "notification" ? { status: record.notification.status, ...(record.notification.reason ? { reason: record.notification.reason } : {}),
      ...(record.notification.error ? { error: record.notification.error } : {}) } : record[key]]);
  return { ...base, status: record.status, ...Object.fromEntries(known) };
}

// -> { items, skipped }: newest attempt first; `skipped` counts records that weren't valid engine records.
export function historyItems(json) {
  let data;
  try {
    data = JSON.parse(json.replace(/^﻿/, ""));
  } catch {
    throw new GitHubError(502, UNREADABLE);
  }
  const entries = Array.isArray(data) ? data.map((url) => [url, undefined])
    : data && typeof data === "object" ? Object.entries(data) : null;
  if (!entries) throw new GitHubError(502, UNREADABLE);
  const items = entries.map(([url, record]) => item(url, record)).filter(Boolean);
  const time = (value) => Date.parse(value.attempted_at ?? "") || 0;
  return { items: items.sort((a, b) => time(b) - time(a)), skipped: entries.length - items.length };
}

export function createHistoryRoutes({ repositoryContext, fetchImpl }) {
  return {
    "GET /api/history": async () => {
      const context = await repositoryContext();
      let file;
      try {
        file = await githubRequest(context.token,
          `/repos/${context.repo.full_name}/contents/state/seen.json?ref=${encodeURIComponent(context.repo.default_branch)}`, { fetchImpl });
      } catch (error) {
        if (error.status === 404) return [200, { items: [], skipped: 0 }]; // no issue attempted yet
        throw error;
      }
      context.assertCurrent();
      if (file?.type !== "file") throw new GitHubError(502, UNREADABLE);
      if (!(file.size <= MAX_BYTES) || file.encoding !== "base64" || typeof file.content !== "string")
        throw new GitHubError(413, "Your Scout history (state/seen.json) is over 1 MB, more than the app shows. It's still in your Scout repository.");
      return [200, historyItems(Buffer.from(file.content, "base64").toString("utf8"))];
    },
  };
}
