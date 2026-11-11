// GitHub sign-in (OAuth device flow) and REST calls. fetch and sleep are injectable for tests.
const GITHUB = "https://github.com";
const API = "https://api.github.com";
// ponytail: classic OAuth scopes reach every repository the user can access;
// a GitHub App could narrow this to the Scout repository only.
export const SCOPES = "repo workflow";
export const SCOUT_TEMPLATE = "atty57/issue-scout-template";

export class GitHubError extends Error {
  constructor(status, message, fields, detail, retryAfter) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

// Seconds until another request is allowed. Preserve both limits if GitHub supplies both.
function rateLimitDelay(response) {
  const retry = response.headers?.get("retry-after") ?? "";
  const seconds = /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) : 0;
  const reset = response.headers?.get("x-ratelimit-remaining") === "0"
    ? Number(response.headers?.get("x-ratelimit-reset")) - Date.now() / 1000 : 0;
  const delays = [seconds, reset].filter(value => Number.isFinite(value) && value > 0);
  return delays.length ? Math.ceil(Math.max(...delays)) : 60;
}

// Only call fixed GitHub API routes built by main; never follow an authenticated redirect.
// `messages` lets a caller explain a status that means something specific for its route.
export async function githubRequest(token, route, { method = "GET", body, fetchImpl = fetch, messages = {} } = {}) {
  const response = await fetchImpl(`${API}${route}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if ([301, 302, 307, 308].includes(response.status))
    throw new GitHubError(422, "This repository has moved. Connect it again using its current owner/repository name.");
  if (!response.ok) {
    const limited = response.status === 403 && (response.headers?.get("x-ratelimit-remaining") === "0" || response.headers?.has("retry-after"));
    const status = limited ? 429 : response.status;
    // GitHub's own reason, such as "Repository rule violations found"; only ever shown as text.
    const detail = await Promise.resolve()
      .then(() => response.json())
      .then((data) => (typeof data?.message === "string" ? data.message.replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, 300) : ""), () => "");
    const known = {
      401: "Your GitHub sign-in expired. Please sign in again.",
      403: "GitHub denied access. Check your repository permissions or sign in again.",
      404: "The repository or a required Scout file could not be found. Check the name and access to your private Scout copy.",
      429: "GitHub's request limit was reached. Please try again later.",
      ...messages,
    };
    const fallback = status >= 500 ? `GitHub is unavailable (HTTP ${status}).` : `GitHub refused the request (HTTP ${status})${detail ? `: ${detail}` : ""}.`;
    throw new GitHubError(status, known[status] || fallback, undefined, detail, status === 429 ? rateLimitDelay(response) : undefined);
  }
  // Variable and secret writes, run starts and cancels answer 201, 202 or 204 with an empty body.
  if ([201, 202, 204].includes(response.status)) return response.json().catch(() => null);
  return response.json();
}

export const validRepositoryName = (name) => typeof name === "string" && /^[\w.-]{1,100}$/.test(name) && name !== "." && name !== "..";
export const validRepository = (name) => typeof name === "string" && /^[a-z\d-]+\/[\w.-]+$/i.test(name) && validRepositoryName(name.split("/")[1]);

// `files: false` skips the Scout file checks; they matter when connecting and at startup, not on every edit.
export async function readScoutRepository(token, fullName, userId, fetchImpl = fetch, { files = true } = {}) {
  if (!validRepository(fullName)) throw new GitHubError(422, "Use owner/repository for your Scout copy.");
  const route = `/repos/${fullName}`;
  const repo = await githubRequest(token, route, { fetchImpl });
  if (!repo.private || repo.owner?.id !== userId || !repo.permissions?.admin || repo.archived || repo.disabled)
    throw new GitHubError(422, "Choose an active private Scout repository owned by your GitHub account with admin access.");
  if (!Number.isSafeInteger(repo.id) || !validRepository(repo.full_name) || !repo.default_branch)
    throw new GitHubError(502, "GitHub returned incomplete repository information. Please try again.");
  if (files) {
    const results = await Promise.all(["profile.json", "scout.py", ".github/workflows/daily.yml"].map((file) =>
      githubRequest(token, `${route}/contents/${file}?ref=${encodeURIComponent(repo.default_branch)}`, { fetchImpl })));
    if (results.some((result) => result.type !== "file")) throw new GitHubError(422, "This repository is missing the required Scout files. Choose a copy of the Issue Scout template.");
  }
  return { id: repo.id, full_name: repo.full_name, html_url: `https://github.com/${repo.full_name}`, default_branch: repo.default_branch };
}

const MESSAGES = {
  expired_token: "The sign-in code expired. Please sign in again.",
  access_denied: "Sign-in was cancelled on GitHub.",
};

async function postForm(fetchImpl, url, params) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) throw new Error(`GitHub sign-in failed (HTTP ${response.status}).`);
  return response.json();
}

export function startDeviceFlow(clientId, fetchImpl = fetch) {
  return postForm(fetchImpl, `${GITHUB}/login/device/code`, { client_id: clientId, scope: SCOPES });
}

// `cancelled` is checked before every poll, so signing out stops polling GitHub at once.
export async function waitForToken(clientId, device, { fetchImpl = fetch, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), cancelled = () => false } = {}) {
  let interval = device.interval ?? 5;
  for (;;) {
    await sleep(interval * 1000);
    if (cancelled()) throw new GitHubError(409, "Sign-in was cancelled. Please try again.");
    const result = await postForm(fetchImpl, `${GITHUB}/login/oauth/access_token`, {
      client_id: clientId,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (result.access_token) return result.access_token;
    if (result.error === "authorization_pending") continue;
    if (result.error === "slow_down") {
      interval = result.interval ?? interval + 5;
      continue;
    }
    throw new Error(MESSAGES[result.error] ?? `GitHub sign-in failed: ${result.error_description ?? result.error}.`);
  }
}

/** GET the signed-in user, or null when GitHub no longer accepts the token. */
export async function getUser(token, fetchImpl = fetch) {
  try {
    return await githubRequest(token, "/user", { fetchImpl });
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}
