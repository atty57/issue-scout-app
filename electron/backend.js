// Answers the web UI's backend routes inside the desktop app, so the React pages stay unchanged.
// Each handler returns [status, payload].
import { getUser, startDeviceFlow, waitForToken } from "./github.js";

const NOT_YET = [501, { error: "This part of Issue Scout isn't in the desktop app yet." }];

export function createBackend({ tokens, clientId, openExternal }) {
  let device;
  const routes = {
    "GET /api/me": async () => {
      const token = tokens.load();
      const user = token && (await getUser(token));
      if (!user) {
        tokens.clear();
        return [401, { error: "Sign in with GitHub." }];
      }
      return [200, { login: user.login, avatar_url: user.avatar_url, onboarding: "ready" }];
    },
    "POST /auth/device": async () => {
      if (!clientId) return [503, { error: "Set ISSUE_SCOUT_GITHUB_CLIENT_ID to the app's GitHub OAuth client ID." }];
      device = await startDeviceFlow(clientId);
      void openExternal(device.verification_uri);
      return [200, { user_code: device.user_code, verification_uri: device.verification_uri }];
    },
    "POST /auth/device/wait": async () => {
      if (!device) return [409, { error: "Start signing in first." }];
      const current = device;
      device = undefined;
      tokens.save(await waitForToken(clientId, current));
      return routes["GET /api/me"]();
    },
    "POST /auth/logout": async () => {
      tokens.clear();
      return [204];
    },
  };
  return async (path, method = "GET") => {
    const route = routes[`${method} ${path}`];
    if (!route) return NOT_YET;
    try {
      return await route();
    } catch (error) {
      return [502, { error: error instanceof Error ? error.message : "GitHub request failed." }];
    }
  };
}
