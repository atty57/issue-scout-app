import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import ScheduleSettings from "../pages/ScheduleSettings";
import type { Schedule } from "../types";

const off: Schedule = { revision: "42:main:a", enabled: false, custom: false, time: "09:30", timezone: "America/New_York", setup_required: false };
beforeEach(() => {
  vi.spyOn(api, "schedule").mockResolvedValue(structuredClone(off));
});

it("turns on daily runs at a local time and time zone", async () => {
  const save = vi.spyOn(api, "saveSchedule").mockResolvedValue({ ...off, revision: "42:main:b", enabled: true, time: "07:15", timezone: "Europe/Berlin" });
  render(<ScheduleSettings />);
  const time = await screen.findByLabelText("Daily run time");
  expect(time).toBeDisabled(); // nothing to set while daily runs are off
  fireEvent.click(screen.getByRole("checkbox", { name: "Run my scout automatically every day" }));
  fireEvent.change(time, { target: { value: "07:15" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Time zone" }), { target: { value: "Europe/Berlin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ revision: "42:main:a", enabled: true, time: "07:15", timezone: "Europe/Berlin" }));
  expect(await screen.findByRole("status")).toHaveTextContent("GitHub starts your scout at 07:15 (Europe/Berlin) every day");
});

it("turns daily runs off", async () => {
  vi.spyOn(api, "schedule").mockResolvedValue({ ...off, enabled: true });
  const save = vi.spyOn(api, "saveSchedule").mockResolvedValue(off);
  render(<ScheduleSettings />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Run my scout automatically every day" }));
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  expect(await screen.findByRole("status")).toHaveTextContent("Daily runs are off");
});

it("offers to reload after daily.yml changed on GitHub", async () => {
  vi.spyOn(api, "saveSchedule").mockRejectedValue(new ApiError(409, "daily.yml changed on GitHub. Reload the latest version before saving again."));
  render(<ScheduleSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Save schedule" }));
  expect(await screen.findByText(/daily.yml changed on GitHub/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(api.schedule).toHaveBeenCalledTimes(2));
});

it("shows daylight saving notes for a time a clock change skips", async () => {
  vi.spyOn(api, "schedule").mockResolvedValue({ ...off, enabled: true, time: "02:30" });
  render(<ScheduleSettings />);
  expect(await screen.findByText(/Daylight saving: .*02:30 doesn't happen that day/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Daily run time"), { target: { value: "09:30" } });
  expect(screen.queryByText(/Daylight saving:/)).not.toBeInTheDocument();
});

it("explains that daily runs wait for setup, and warns when they're already on", async () => {
  vi.spyOn(api, "schedule").mockResolvedValue({ ...off, setup_required: true });
  const { unmount } = render(<ScheduleSettings />);
  expect(await screen.findByText(/Finish setup first/)).toBeInTheDocument();
  unmount();
  vi.spyOn(api, "schedule").mockResolvedValue({ ...off, enabled: true, setup_required: true });
  render(<ScheduleSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent("each scheduled run stops at once");
});

it("flags a hand-written schedule it can't show before replacing it", async () => {
  vi.spyOn(api, "schedule").mockResolvedValue({ ...off, enabled: true, custom: true });
  render(<ScheduleSettings />);
  expect(await screen.findByText(/Saving here replaces it/)).toBeInTheDocument();
});
