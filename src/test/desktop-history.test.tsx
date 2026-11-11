import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import History from "../pages/History";
import type { HistoryItem } from "../types";

vi.mock("../api", async (original) => ({ ...(await original<typeof import("../api")>()), isMock: false }));

const records: HistoryItem[] = [
  { url: "https://github.com/acme/core/issues/2", repo: "acme/core", number: 2, status: "failed", attempted_at: "2026-11-09T23:30:34Z",
    attempts: 1, tests_passed: false, reproduces: false, why: "Focused regression fix", retry_after: "2026-11-16T23:30:34Z",
    reason: "RuntimeError: claude-code failed; check CLI authentication", notification: { status: "disabled" } },
  { url: "https://github.com/acme/core/issues/3", repo: "acme/core", number: 3, status: "notified", attempted_at: "2026-11-09T23:30:33Z",
    attempts: 1, tests_passed: true, reproduces: true, why: "Small validation fix", reason: "verified patch", notification: { status: "sent" } },
  { url: "https://github.com/acme/web/issues/9", repo: "acme/web", number: 9, status: "notified", legacy: true },
];

it("lists the engine's own records, with only the checks that passed", async () => {
  vi.spyOn(api, "history").mockResolvedValue({ items: records, skipped: 1 });
  render(<History />);
  expect(await screen.findByText("acme/core #2")).toBeInTheDocument();
  expect(screen.getByText("no verified fix")).toBeInTheDocument();
  expect(screen.getByText("Result: RuntimeError: claude-code failed; check CLI authentication")).toBeInTheDocument();
  expect(screen.getByText(/Scout may try this issue again after/)).toBeInTheDocument();
  expect(screen.getByText("verified, emailed")).toBeInTheDocument();
  expect(screen.getByText(/tests passed · regression reproduced/)).toBeInTheDocument();
  // A failed attempt's tests may never have run, so nothing says they failed.
  expect(screen.queryByText(/tests failed/)).not.toBeInTheDocument();
  expect(screen.getByText("delivered")).toBeInTheDocument();
  expect(screen.getByText(/only the issue’s address was kept/)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 record in your Scout history couldn’t be read");
  expect(screen.getAllByRole("link", { name: /Open issue/ }).map((link) => link.getAttribute("href"))).toEqual(records.map((item) => item.url));
  fireEvent.click(screen.getByRole("button", { name: "Verified fixes" }));
  expect(screen.queryByText("acme/core #2")).not.toBeInTheDocument();
  expect(screen.getByText("acme/core #3")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Not verified" }));
  expect(screen.getByText("acme/core #2")).toBeInTheDocument();
  expect(screen.queryByText("acme/core #3")).not.toBeInTheDocument();
});

it("starts empty before the first attempt, and says when the history can't be read", async () => {
  vi.spyOn(api, "history").mockResolvedValueOnce({ items: [], skipped: 0 });
  const { unmount } = render(<History />);
  expect(await screen.findByText("Your contribution trail starts here.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to your runs" })).toHaveAttribute("href", "#/runs");
  unmount();
  vi.spyOn(api, "history").mockRejectedValueOnce(new ApiError(502, "Your Scout history (state/seen.json) can't be read, so Scout won't run until it is fixed."));
  render(<History />);
  expect(await screen.findByText(/can't be read, so Scout won't run/)).toBeInTheDocument();
});
