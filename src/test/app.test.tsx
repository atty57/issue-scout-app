import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { resetMock } from "../mock/server";

async function tick(ms = 220) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function boot() {
  await tick();
  await tick();
}
async function route(path: string) {
  await act(async () => {
    window.location.hash = path;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await tick();
}
beforeEach(() => {
  vi.useFakeTimers();
  resetMock();
  window.location.hash = "/";
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("public frontend journeys", () => {
  it("navigates through every personalized workspace", async () => {
    render(<App />);
    await boot();
    expect(
      screen.getByRole("heading", {
        name: /Your next contribution starts here/,
      }),
    ).toBeInTheDocument();
    await route("/projects");
    expect(
      screen.getByRole("heading", { name: /Your projects tell a story/ }),
    ).toBeInTheDocument();
    await route("/profile");
    expect(
      screen.getByRole("heading", { name: /Your profile, in your hands/ }),
    ).toBeInTheDocument();
    await route("/history");
    expect(
      screen.getByRole("heading", { name: /A little history/ }),
    ).toBeInTheDocument();
    await route("/scout-settings");
    expect(
      screen.getByRole("heading", { name: /A scout that works your way/ }),
    ).toBeInTheDocument();
    await route("/settings");
    expect(
      screen.getByRole("heading", { name: /Keep things up to date/ }),
    ).toBeInTheDocument();
    await route("/runs");
    expect(
      screen.getByRole("button", { name: "Run full scout" }),
    ).toBeInTheDocument();
  });
  it("starts from a suggestion and opens the completed patch and validation evidence", async () => {
    render(<App />);
    await boot();
    fireEvent.click(screen.getAllByRole("button", { name: "Draft a fix" })[0]);
    await tick(500);
    expect(
      screen.getByRole("heading", { name: "Your scout is on the trail." }),
    ).toBeInTheDocument();
    await tick(20000);
    expect(
      screen.getByRole("heading", { name: "A draft worth a closer look." }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Patch" }));
    expect(
      screen.getByText(/diff --git a\/src\/exporter.py/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Validation" }));
    expect(
      screen.getByRole("heading", { name: "Validation evidence" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/SCOUT_REGRESSION:101/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Review brief report.txt/ }),
    ).toBeInTheDocument();
  });
  it("switches to a signed-out demo and completes GitHub-only onboarding", async () => {
    render(<App />);
    await boot();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Preview scenario" }),
      { target: { value: "signed_out" } },
    );
    await tick();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    );
    await tick();
    expect(
      screen.getByRole("heading", { name: "Bring your experience along." }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Skip for now, use GitHub only/ }),
    );
    await tick(450);
    expect(
      screen.getByRole("heading", { name: "Getting to know your strengths" }),
    ).toBeInTheDocument();
    await tick(10000);
    await tick(500);
    await tick();
    expect(
      screen.getByRole("heading", {
        name: /Your next contribution starts here/,
      }),
    ).toBeInTheDocument();
  });
  it("removes account data rather than only logging out", async () => {
    await act(async () => {
      const deletion = api.deleteAccount();
      await vi.advanceTimersByTimeAsync(200);
      await deletion;
    });
    await act(async () => {
      const login = api.demoLogin();
      await vi.advanceTimersByTimeAsync(200);
      await login;
    });
    let projectCount = -1;
    let runCount = -1;
    await act(async () => {
      const projects = api.projects();
      const runs = api.runs();
      await vi.advanceTimersByTimeAsync(200);
      projectCount = (await projects).length;
      runCount = (await runs).length;
    });
    expect(projectCount).toBe(0);
    expect(runCount).toBe(0);
  });
});
