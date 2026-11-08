import { ApiError } from "./errors";
import { mockRequest, resetMock } from "./mock/server";
import type {
  Connection,
  DemoScenario,
  Feedback,
  Job,
  Me,
  Profile,
  ProfileChange,
  Project,
  RepositorySetup,
  Run,
  ScoutSettings,
  Suggestion,
  SuggestionResponse,
} from "./types";

export const isMock = import.meta.env.VITE_API_MODE === "mock";
const base = "";

// The desktop app's main process (electron/backend.js) answers these routes.
// Mock transport is explicitly enabled only for tests.
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isMock) return mockRequest<T>(path, options);
  const body =
    typeof options.body === "string" ? JSON.parse(options.body) : undefined;
  const [status, payload = {}] = await window.scout.request(
    path,
    options.method || "GET",
    body,
  );
  if (status === 204) return undefined as T;
  // The Scout repository was renamed, moved or replaced: reload the account so the app reopens repository setup.
  if (status >= 400 && payload.reconnect)
    window.dispatchEvent(new Event("issue-scout:account-changed"));
  if (status >= 400)
    throw new ApiError(
      status,
      payload.error || "The request could not be completed.",
      payload.fields,
    );
  return payload as T;
}
export const api = {
  me: () => request<Me>("/api/me"),
  setupRepository: (setup: RepositorySetup) =>
    request<Me>("/api/repository", { method: "POST", body: JSON.stringify(setup) }),
  startLogin: () =>
    request<{ user_code: string; verification_uri: string }>("/auth/device", {
      method: "POST",
    }),
  finishLogin: () => request<Me>("/auth/device/wait", { method: "POST" }),
  demoLogin: () => request<Me>("/auth/github/login"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  deleteAccount: () => request<void>("/api/me", { method: "DELETE" }),
  upload: (file?: File) => {
    const body = new FormData();
    if (file) body.append("file", file);
    return request<{ job_id: string }>("/api/resume", { method: "POST", body });
  },
  job: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  profile: () => request<Profile>("/api/profile"),
  saveProfile: (profile: Profile) =>
    request<Profile>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    }),
  profileHistory: () => request<ProfileChange[]>("/api/profile/history"),
  suggestions: (status: "active" | "past" = "active") =>
    request<SuggestionResponse>(`/api/suggestions?status=${status}`),
  feedback: (id: string, feedback: Feedback) =>
    request<Suggestion>(`/api/suggestions/${encodeURIComponent(id)}/feedback`, {
      method: "POST",
      body: JSON.stringify(feedback),
    }),
  undoFeedback: (id: string) =>
    request<Suggestion>(`/api/suggestions/${encodeURIComponent(id)}/feedback`, {
      method: "DELETE",
    }),
  refresh: () =>
    request<{ job_id: string }>("/api/suggestions/refresh", { method: "POST" }),
  projects: () => request<Project[]>("/api/projects"),
  saveProjects: (projects: Project[]) =>
    request<Project[]>("/api/projects", {
      method: "PUT",
      body: JSON.stringify(projects),
    }).then((value) => {
      if (!isMock)
        window.dispatchEvent(new Event("issue-scout:account-changed"));
      return value;
    }),
  scoutSettings: () => request<ScoutSettings>("/api/scout/settings"),
  saveScoutSettings: (settings: ScoutSettings) =>
    request<ScoutSettings>("/api/scout/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  connections: () => request<Connection[]>("/api/connections"),
  demoToggleConnection: (id: string) =>
    request<Connection>(`/api/connections/${encodeURIComponent(id)}`, {
      method: "POST",
    }),
  runs: () => request<Run[]>("/api/runs"),
  run: (id: string) => request<Run>(`/api/runs/${encodeURIComponent(id)}`),
  // Authenticated download streamed from the artifact store (object storage in prod).
  artifactUrl: (id: string, kind: "report" | "patch" | "log") =>
    `${base}/api/runs/${encodeURIComponent(id)}/artifacts/${kind}`,
  startRun: (suggestionId?: string) =>
    request<Run>("/api/runs", {
      method: "POST",
      body: JSON.stringify(suggestionId ? { suggestion_id: suggestionId } : {}),
    }),
  cancelRun: (id: string) =>
    request<Run>(`/api/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  retryDelivery: (id: string) =>
    request<Run>(`/api/runs/${encodeURIComponent(id)}/retry-delivery`, {
      method: "POST",
    }),
  setDemo: (scenario: DemoScenario) => resetMock(scenario),
};
