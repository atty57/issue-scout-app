import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import { resetMock } from "../mock/server";
import { fileError, safeHttps } from "../utils";
import type { Run } from "../types";

// The demo server always returns the started run; only the desktop app can answer `pending`.
const startRun = (suggestionId?: string) => api.startRun(suggestionId) as Promise<Run>;

async function settle<T>(promise: Promise<T>): Promise<T> {
  const observed = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(200);
  const result = await observed;
  if ("error" in result) throw result.error;
  return result.value;
}
beforeEach(() => {
  vi.useFakeTimers();
  resetMock();
});
afterEach(() => vi.useRealTimers());

describe("full scout contract", () => {
  it("progresses through the full workflow and saves a report and patch", async () => {
    const started = await settle(startRun("sg_01"));
    const stages = [];
    let run = started;
    for (let count = 0; count < 9; count++) {
      run = await settle(api.run(started.id));
      stages.push(run.stage);
    }
    expect(stages.slice(0, 8)).toEqual([
      "discover",
      "shortlist",
      "gate",
      "pick",
      "revalidate",
      "solve",
      "validate",
      "notify",
    ]);
    expect(run.status).toBe("completed");
    expect(run.report?.patch).toContain("diff --git");
    expect(run.report?.regression_reproduced).toBe(true);
    expect(run.report?.notification.status).toBe("disabled");
    expect(run.report?.report_text).toContain("SAMPLE DATA");
  });
  it("prevents overlapping runs for the same account", async () => {
    await settle(startRun());
    const error = await settle(startRun()).catch((error) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
  });
  it("stops an active run without generating a report", async () => {
    const run = await settle(startRun());
    await settle(api.cancelRun(run.id));
    const result = await settle(api.run(run.id));
    expect(result.status).toBe("cancelled");
    expect(result.report).toBeUndefined();
  });
  it("abstains before drafting when no issue qualifies", async () => {
    resetMock("abstained");
    const started = await settle(startRun());
    let run = started;
    for (let count = 0; count < 4; count++) run = await settle(api.run(run.id));
    expect(run.status).toBe("abstained");
    expect(run.report).toBeUndefined();
    expect(run.events.map((event) => event.stage)).not.toContain("solve");
  });
  it("retries only delivery while preserving the saved patch and run events", async () => {
    resetMock("delivery_failure");
    const before = await settle(api.run("run_example"));
    expect(before.report?.notification.status).toBe("failed");
    const after = await settle(api.retryDelivery(before.id));
    expect(after.report?.notification.status).toBe("sent");
    expect(after.report?.patch).toBe(before.report?.patch);
    expect(after.events).toEqual(before.events);
  });
  it("supports discovery-only runs without drafting or validation", async () => {
    const settings = await settle(api.scoutSettings());
    await settle(api.saveScoutSettings({ ...settings, draft_fixes: false }));
    let run = await settle(startRun());
    for (let count = 0; count < 7; count++) run = await settle(api.run(run.id));
    expect(run.status).toBe("completed");
    expect(run.report).toBeUndefined();
    expect(run.events.map((event) => event.stage)).not.toContain("solve");
    expect(run.events.map((event) => event.stage)).not.toContain("validate");
  });
  it("keeps failed validation distinct from a passing regression result", async () => {
    resetMock("run_failure");
    let run = await settle(startRun());
    for (let count = 0; count < 8; count++) run = await settle(api.run(run.id));
    expect(run.status).toBe("failed");
    expect(run.report).toBeUndefined();
    expect(run.error).toMatch(/setup/);
  });
});

describe("account personalization", () => {
  it("saves the projects selected as profile evidence", async () => {
    const projects = await settle(api.projects());
    projects[0].use_as_evidence = false;
    await settle(api.saveProjects(projects));
    expect((await settle(api.projects()))[0].use_as_evidence).toBe(false);
  });
  it("returns inline field errors for invalid scout settings", async () => {
    const settings = await settle(api.scoutSettings());
    const error = await settle(
      api.saveScoutSettings({
        ...settings,
        candidate_limit: 0,
        min_confidence: 2,
      }),
    ).catch((error) => error);
    expect(error.status).toBe(422);
    expect(error.fields).toHaveProperty("candidate_limit");
    expect(error.fields).toHaveProperty("min_confidence");
  });
  it("requires a connected provider before enabling email", async () => {
    const settings = await settle(api.scoutSettings());
    const error = await settle(
      api.saveScoutSettings({
        ...settings,
        email_enabled: true,
        email: "dev@example.com",
      }),
    ).catch((error) => error);
    expect(error.fields).toHaveProperty("email");
    await settle(api.demoToggleConnection("email"));
    const saved = await settle(
      api.saveScoutSettings({
        ...settings,
        email_enabled: true,
        email: "dev@example.com",
      }),
    );
    expect(saved.email_enabled).toBe(true);
  });
  it("requires sign-in for profile and run endpoints", async () => {
    await settle(api.logout());
    const profileError = await settle(api.profile()).catch((error) => error);
    const runError = await settle(api.runs()).catch((error) => error);
    expect(profileError.status).toBe(401);
    expect(runError.status).toBe(401);
  });
});

describe("client safety boundaries", () => {
  it("rejects malformed, insecure and credential-bearing URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://github.com",
      "//github.com",
      "https://",
      "https://user:password@github.com",
      "HTTPS://github.com",
    ])
      expect(safeHttps(url)).toBeUndefined();
    expect(safeHttps("https://github.com/a/b")).toBe("https://github.com/a/b");
  });
  it("checks both the file extension and MIME type", () => {
    expect(
      fileError(new File(["x"], "resume.pdf", { type: "text/html" })),
    ).toMatch(/PDF or DOCX/);
    expect(
      fileError(new File(["x"], "resume.PDF", { type: "application/pdf" })),
    ).toBeUndefined();
  });
});
