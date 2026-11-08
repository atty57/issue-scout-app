// Answers the web UI's backend routes inside the desktop app.
// Each handler returns [status, payload]; credentials never leave main.
import {
  getUser, startDeviceFlow, waitForToken, githubRequest, GitHubError,
  readScoutRepository, validRepositoryName, validRepository, SCOUT_TEMPLATE,
} from "./github.js";
import { createProfileRoutes } from "./profile.js";

const NOT_YET = [501, { error: "This part of Issue Scout isn't in the desktop app yet." }];

export function createBackend({ tokens, repositories, clientId, openExternal, fetchImpl = fetch, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  let device;
  let session = 0;
  let repositoryBusy = false;

  // The signed-in user for this session and token, so routes don't repeat GET /user.
  // ponytail: login and avatar changes on GitHub show after the next sign-in.
  let known;

  async function signedIn() {
    const token = tokens.load();
    const version = session;
    // Every token change bumps `session`, so comparing it is enough; no re-decrypting the token.
    const assertCurrent = () => {
      if (version !== session) throw new GitHubError(401, "Your sign-in changed. Please sign in again.");
    };
    let user = token && known?.version === version && known.token === token ? known.user : undefined;
    if (!user && token) user = await getUser(token, fetchImpl);
    assertCurrent();
    if (!user) {
      if (token) { session++; tokens.clear(); }
      throw new GitHubError(401, "Sign in with GitHub.");
    }
    known = { version, token, user };
    return { token, user, assertCurrent };
  }

  // The saved Scout repository can't be used any more; `reconnect` tells the app to reopen repository setup.
  const reconnect = (message) => Object.assign(new GitHubError(422, message), { reconnect: true });

  async function repositoryContext() {
    const context = await signedIn();
    const saved = repositories.get(context.user.id);
    if (!saved) throw reconnect("Connect your private Scout repository first.");
    let repo;
    try {
      repo = await readScoutRepository(context.token, saved.full_name, context.user.id, fetchImpl, { files: false });
    } catch (error) {
      context.assertCurrent();
      // Same cases /api/me treats as a lost connection; rate limits (429) and outages are not.
      throw [403, 404, 422].includes(error.status) ? reconnect(error.message) : error;
    }
    context.assertCurrent();
    if (repo.id !== saved.id) throw reconnect("Your saved repository has moved or been replaced. Connect your Scout copy again.");
    return { ...context, repo };
  }

  const account = (user, repository, repositoryError) => ({
    login: user.login, avatar_url: user.avatar_url,
    onboarding: repository ? "ready" : "needs_repository",
    ...(repository ? { repository } : {}),
    ...(repositoryError ? { repository_error: repositoryError } : {}),
  });

  const routes = {
    ...createProfileRoutes({ repositoryContext, fetchImpl }),
    "GET /api/me": async () => {
      const { token, user, assertCurrent } = await signedIn();
      const saved = repositories.get(user.id);
      if (!saved) return [200, account(user)];
      try {
        const repo = await readScoutRepository(token, saved.full_name, user.id, fetchImpl);
        assertCurrent();
        if (repo.id !== saved.id) throw new GitHubError(422, "Your saved repository has moved or been replaced. Please connect your Scout copy again.");
        return [200, account(user, repo)];
      } catch (error) {
        assertCurrent();
        if ([403, 404, 422].includes(error.status)) return [200, account(user, undefined, error.message)];
        throw error;
      }
    },
    "POST /api/repository": async (body) => {
      const { token, user, assertCurrent } = await signedIn();
      if (repositoryBusy) throw new GitHubError(409, "Repository setup is already in progress. Please wait.");
      if (!body || !["create", "connect"].includes(body.mode)) throw new GitHubError(422, "Choose whether to create or connect a Scout repository.");
      const creating = body.mode === "create";
      const name = creating && typeof body.name === "string" ? body.name.trim() : "";
      const fullName = creating ? `${user.login}/${name}` : typeof body.repo === "string" ? body.repo.trim() : "";
      if ((creating && !validRepositoryName(name)) || !validRepository(fullName) || fullName.split("/")[0].toLowerCase() !== user.login.toLowerCase())
        throw new GitHubError(422, creating ? "Use a repository name of 1–100 letters, numbers, dots, underscores or dashes." : `Use ${user.login}/repository for a private Scout copy in your account.`);
      repositoryBusy = true;
      try {
        let target = fullName;
        if (creating) {
          const created = await githubRequest(token, `/repos/${SCOUT_TEMPLATE}/generate`, {
            method: "POST", fetchImpl,
            body: { owner: user.login, name, private: true, include_all_branches: false },
            messages: { 422: "GitHub could not create that repository. If the name is already in use, connect the existing Scout copy or choose another name." },
          });
          // Follow the repository GitHub actually created; its name can differ from the one requested.
          if (validRepository(created?.full_name)) target = created.full_name;
        }
        // Template generation can finish before its files become readable. Never repeat the POST.
        for (let attempt = 0; ; attempt++) {
          assertCurrent();
          try {
            const repo = await readScoutRepository(token, target, user.id, fetchImpl);
            assertCurrent();
            repositories.set(user.id, { id: repo.id, full_name: repo.full_name });
            return [200, account(user, repo)];
          } catch (error) {
            if (!creating || ![404, 409].includes(error.status)) throw error;
            // ponytail: a template missing Scout files also lands here; connecting it then shows the real error.
            if (attempt === 5) throw new GitHubError(409, `GitHub created ${target}, but its Scout files aren't readable yet. Wait a minute, then choose "Connect existing repository" and enter ${target}.`);
            await sleep(1000);
          }
        }
      } finally {
        repositoryBusy = false;
      }
    },
    "POST /auth/device": async () => {
      if (!clientId) return [503, { error: "GitHub sign-in isn't configured in this build. Please contact the app maintainer." }];
      const version = ++session;
      device = undefined;
      const next = await startDeviceFlow(clientId, fetchImpl);
      if (version !== session) throw new GitHubError(409, "Sign-in was cancelled. Please try again.");
      device = next;
      void openExternal(device.verification_uri);
      return [200, { user_code: device.user_code, verification_uri: device.verification_uri }];
    },
    "POST /auth/device/wait": async () => {
      if (!device) return [409, { error: "Start signing in first." }];
      const current = device;
      const version = session;
      device = undefined;
      const token = await waitForToken(clientId, current, { fetchImpl, sleep, cancelled: () => version !== session });
      if (version !== session) throw new GitHubError(409, "Sign-in was cancelled. Please try again.");
      session++;
      tokens.save(token);
      return routes["GET /api/me"]();
    },
    "POST /auth/logout": async () => {
      session++;
      device = undefined;
      tokens.clear();
      return [204];
    },
  };
  return async (path, method = "GET", body) => {
    const route = routes[`${method} ${path}`];
    if (!route) return NOT_YET;
    try {
      return await route(body);
    } catch (error) {
      if (error?.status === 401) known = undefined; // a revoked token is re-checked (and cleared) on the next request
      return [error instanceof GitHubError ? error.status : 502, {
        error: error instanceof Error ? error.message : "GitHub request failed.",
        ...(error instanceof GitHubError && error.fields ? { fields: error.fields } : {}),
        ...(error instanceof GitHubError && error.reconnect ? { reconnect: true } : {}),
      }];
    }
  };
}
