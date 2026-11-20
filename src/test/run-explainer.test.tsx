import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import { api } from "../api";
import Runs from "../pages/Runs";
import { SAMPLES } from "../samples/explanations";
import type { Run } from "../types";

vi.mock("../api", async (original) => ({ ...(await original<typeof import("../api")>()), isMock: false }));
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
const saved = (): Run => {
  const run = structuredClone(SAMPLES[0].run);
  run.id = "12345";
  run.report!.explanation = { ...(structuredClone(SAMPLES[0].explanation) as object), sample: false, format_version: 1, code_checked: true };
  return run;
};

it("opens an engine-checked diagram on the actual run detail page, preserving the recorded outcome", async () => {
  vi.spyOn(api, "run").mockResolvedValue(saved());
  render(<Runs id="12345" />);
  expect(await screen.findByRole("button", { name: "Explain" })).toBeInTheDocument();
  expect(await screen.findByRole("tab", { name: "Before" })).toBeInTheDocument();
  expect(screen.queryByText(/Sample explanation, written by hand/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "After" }));
  expect(screen.getByRole("region", { name: "Steps as text" })).toHaveTextContent("Are there any results?");
  fireEvent.click(screen.getByRole("button", { name: "Review brief" }));
  expect(await screen.findByRole("heading", { name: "Root cause" })).toBeInTheDocument();
});

it("opens on Explain only when the run saved a diagram", async () => {
  vi.spyOn(api, "run").mockResolvedValue(saved());
  const { unmount } = render(<Runs id="12345" />);
  expect(await screen.findByRole("button", { name: "Explain" })).toHaveAttribute("aria-pressed", "true");
  unmount();
  const old = saved();
  delete old.report!.explanation;
  vi.spyOn(api, "run").mockResolvedValue(old);
  render(<Runs id="12345" />);
  expect(await screen.findByRole("button", { name: "Review brief" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Explain" })).toHaveAttribute("aria-pressed", "false");
  expect(await screen.findByRole("heading", { name: "Root cause" })).toBeInTheDocument();
});

it("keeps old runs readable and explains why they have no diagram", async () => {
  const run = saved();
  delete run.report!.explanation;
  vi.spyOn(api, "run").mockResolvedValue(run);
  render(<Runs id="12345" />);
  fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
  expect(await screen.findByText(/didn’t save a step-by-step diagram/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Reasoning behind the fix" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Before" })).not.toBeInTheDocument();
});

it("does not expose a withheld patch through the diagram", async () => {
  const run = saved();
  run.report!.patch_withheld_reason = "Credential-shaped output";
  run.report!.patch = null;
  run.outcome = "fix_not_verified";
  vi.spyOn(api, "run").mockResolvedValue(run);
  const { container } = render(<Runs id="12345" />);
  fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
  expect(await screen.findByText(/patch was withheld.*no diagram/i)).toBeInTheDocument();
  expect(container.querySelector(".react-flow")).toBeNull();
  expect(container).not.toHaveTextContent("EMPTY_STATE");
});

it("refuses sample diagrams attached to real runs without hiding the report", async () => {
  const run = saved();
  (run.report!.explanation as { sample: boolean }).sample = true;
  vi.spyOn(api, "run").mockResolvedValue(run);
  render(<Runs id="12345" />);
  await screen.findByRole("button", { name: "Explain" });
  expect(await screen.findByText(/sample.*not.*real run/i)).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Before" })).not.toBeInTheDocument();
});
