// GitHub sign-in (OAuth device flow) and REST calls. fetch and sleep are injectable for tests.
const GITHUB = "https://github.com";
const API = "https://api.github.com";
// ponytail: classic OAuth scopes reach every repository the user can access;
// a GitHub App could narrow this to the Scout repository only.
export const SCOPES = "repo workflow";

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

export async function waitForToken(clientId, device, { fetchImpl = fetch, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  let interval = device.interval ?? 5;
  for (;;) {
    await sleep(interval * 1000);
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
  const response = await fetchImpl(`${API}/user`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GitHub is unavailable (HTTP ${response.status}).`);
  return response.json();
}
