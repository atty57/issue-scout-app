import { ApiError } from "./errors";
import { mockRequest, resetMock } from "./mock/server";
import type {
  Connection,
  DemoScenario,
  EmailSettings,
  EmailUpdate,
  Feedback,
  HistoryResponse,
  Job,
  Me,
  ModelSettings,
  ModelStageUpdate,
  Profile,
  ProfileChange,
  Project,
  RepositorySetup,
  Run,
  Schedule,
  ScheduleUpdate,
  ScoutSettings,
  Suggestion,
  SuggestionResponse,
} from "./types";

export const isMock = import.meta.env.VITE_API_MODE === "mock";

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
      typeof payload.retryAfter === "number" && Number.isFinite(payload.retryAfter) && payload.retryAfter > 0 ? payload.retryAfter : 0,
    );
  return payload as T;
}
export const api = {
  me: () => request<Me>("/api/me"),
  setupRepository: (setup: RepositorySetup) =>
    request<Me>("/api/repository", { method: "POST", body: JSON.stringify(setup) }),
  // Desktop: forget this computer's link to the Scout repository (nothing on GitHub changes), then set up again.
  disconnectRepository: () => request<Me>("/api/repository", { method: "DELETE" }),
  // Desktop: colors the window's title bar and its window controls to match the theme.
  windowTheme: (theme: "light" | "dark") =>
    request<void>("/api/window/theme", { method: "PUT", body: JSON.stringify({ theme }) }),
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
  models: () => request<ModelSettings>("/api/models"),
  saveModels: (models: { picker: ModelStageUpdate; solver: ModelStageUpdate }) =>
    request<ModelSettings>("/api/models", { method: "PUT", body: JSON.stringify(models) }),
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
  email: () => request<EmailSettings>("/api/email"),
  saveEmail: (email: EmailUpdate) =>
    request<EmailSettings>("/api/email", { method: "PUT", body: JSON.stringify(email) }),
  requestEmailCode: () => request<EmailSettings>("/api/email/verify", { method: "POST" }),
  confirmEmail: (code: string) =>
    request<EmailSettings>("/api/email/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  schedule: () => request<Schedule>("/api/schedule"),
  saveSchedule: (schedule: ScheduleUpdate) =>
    request<Schedule>("/api/schedule", { method: "PUT", body: JSON.stringify(schedule) }),
  runs: () => request<Run[]>("/api/runs"),
  run: (id: string) => request<Run>(`/api/runs/${encodeURIComponent(id)}`),
  // Desktop: main downloads the run's artifact and asks where to save the file; the page never gets a link.
  saveRunFile: (id: string, file: "report" | "patch") =>
    request<{ saved: boolean }>(`/api/runs/${encodeURIComponent(id)}/save`, {
      method: "POST",
      body: JSON.stringify({ file }),
    }),
  history: () => request<HistoryResponse>("/api/history"),
  startRun: (suggestionId?: string) =>
    // `pending` (desktop only): the start was sent but the run isn't listed yet. GitHub may not have confirmed it.
    request<Run | { pending: true }>("/api/runs", {
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
