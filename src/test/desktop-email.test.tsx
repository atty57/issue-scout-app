import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import EmailSettings from "../pages/EmailSettings";
import Runs from "../pages/Runs";
import type { EmailSettings as Email, Run } from "../types";

vi.mock("../api", async (original) => ({ ...(await original<typeof import("../api")>()), isMock: false }));

const blank: Email = { available: true, ready: true, revision: "42:main:a", email: "", enabled: false, confirmed: false, code_sent: false };
beforeEach(() => {
  vi.spyOn(api, "email").mockResolvedValue(structuredClone(blank));
});

it("shows nothing in a build without an email relay", async () => {
  vi.spyOn(api, "email").mockResolvedValue({ available: false });
  const { container } = render(<EmailSettings />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

// A promise the test settles, to see an action's loading state.
function later<T>() {
  let settle!: (value: T) => void;
  return { promise: new Promise<T>((done) => { settle = done; }), settle };
}
const toggle = () => screen.getByRole("checkbox", { name: "Email me each run’s report" });

it("walks through saving, confirming and turning on an address, explaining what each step needs", async () => {
  const saved = { ...blank, revision: "42:main:b", email: "dev@example.com" };
  const save = vi.spyOn(api, "saveEmail").mockResolvedValueOnce(saved);
  const code = later<Email>();
  vi.spyOn(api, "requestEmailCode").mockReturnValue(code.promise);
  const confirmed = later<Email>();
  const confirm = vi.spyOn(api, "confirmEmail").mockReturnValue(confirmed.promise);
  render(<EmailSettings />);
  await screen.findByLabelText(/^Email address/);
  // Nothing goes to an unconfirmed address, and the switch says what comes first.
  expect(toggle()).toBeDisabled();
  expect(toggle()).toHaveAccessibleDescription(/Enter your email address first/);

  fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: "dev@example.com" } });
  expect(toggle()).toHaveAccessibleDescription(/Send a confirmation code to this address/);
  fireEvent.click(screen.getByRole("button", { name: "Save address and send a code" }));
  expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
  await waitFor(() => expect(save).toHaveBeenCalledWith({ revision: "42:main:a", email: "dev@example.com", enabled: false }));
  await act(async () => code.settle({ ...saved, code_sent: true }));
  expect(screen.getByRole("status")).toHaveTextContent("emailing a 6-digit code to dev@example.com");
  expect(toggle()).toBeDisabled();
  expect(toggle()).toHaveAccessibleDescription(/Enter the 6-digit code from the email/);

  expect(screen.getByRole("button", { name: "Confirm address" })).toBeDisabled(); // until six digits are typed
  fireEvent.change(screen.getByLabelText(/^Confirmation code/), { target: { value: "123 456" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm address" }));
  expect(await screen.findByRole("button", { name: "Confirming…" })).toBeDisabled();
  expect(confirm).toHaveBeenCalledWith("123 456");
  await act(async () => confirmed.settle({ ...saved, confirmed: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Address confirmed");
  expect(screen.getByText("Confirmed.")).toBeInTheDocument();
  // Confirming never turns email on by itself.
  expect(toggle()).toBeEnabled();
  expect(toggle()).not.toBeChecked();
  expect(toggle()).toHaveAccessibleDescription(/Turn this on and save/);

  const on = later<Email>();
  save.mockReturnValueOnce(on.promise);
  fireEvent.click(toggle());
  expect(toggle()).toHaveAccessibleDescription(/Save email settings to start/);
  fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
  expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(save).toHaveBeenLastCalledWith({ revision: "42:main:b", email: "dev@example.com", enabled: true });
  await act(async () => on.settle({ ...saved, revision: "42:main:c", enabled: true, confirmed: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Email reports are on");
  expect(toggle()).toBeChecked();
  expect(toggle()).not.toHaveAccessibleDescription(/./);
});

it("shows each action's error next to the control that failed", async () => {
  vi.spyOn(api, "email").mockResolvedValue({ ...blank, email: "dev@example.com" });
  vi.spyOn(api, "requestEmailCode").mockRejectedValue(new ApiError(503, "Issue Scout's email service didn't answer. Try again in a minute."));
  render(<EmailSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Send a confirmation code" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("email service didn't answer");
  // Between the code buttons and the switch, not in the save bar at the bottom.
  expect(alert.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send a confirmation code" })).toBeEnabled();
  expect(toggle()).toBeDisabled();
});

it("turns email reports off, and a changed address needs confirming again", async () => {
  const on = { ...blank, email: "dev@example.com", enabled: true, confirmed: true };
  vi.spyOn(api, "email").mockResolvedValue(on);
  const save = vi.spyOn(api, "saveEmail").mockResolvedValue({ ...on, enabled: false });
  render(<EmailSettings />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Email me each run’s report" }));
  expect(toggle()).toHaveAccessibleDescription(/Save email settings to stop/);
  fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ revision: "42:main:a", email: "dev@example.com", enabled: false }));
  expect(await screen.findByRole("status")).toHaveTextContent("Email reports are off");
  fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: "new@example.com" } });
  expect(toggle()).toBeDisabled();
  expect(toggle()).toHaveAccessibleDescription(/Send a confirmation code to this address/);
  expect(screen.getByRole("button", { name: "Save address and send a code" })).toBeInTheDocument();
});

it("shows a wrong code next to the code field", async () => {
  vi.spyOn(api, "email").mockResolvedValue({ ...blank, email: "dev@example.com", code_sent: true });
  vi.spyOn(api, "confirmEmail").mockRejectedValue(new ApiError(422, "That code isn't right.", { code: "That code isn't right. 2 tries left." }));
  render(<EmailSettings />);
  fireEvent.change(await screen.findByLabelText(/^Confirmation code/), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm address" }));
  expect(await screen.findByText("That code isn't right. 2 tries left.")).toBeInTheDocument();
});

it("explains that an older Scout repository can't use email", async () => {
  vi.spyOn(api, "email").mockResolvedValue({ ...blank, ready: false });
  render(<EmailSettings />);
  expect(await screen.findByText(/created before email reports existed/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Email address/)).not.toBeInTheDocument();
});

const finished = (delivery: Run["delivery"]): Run => ({
  id: "3", status: "completed", stage: "notify", started_at: "2026-11-08T12:00:05Z", events: [], delivery,
  html_url: "https://github.com/octocat/scout/actions/runs/3",
});

it("shows a run's email outcome and sends the saved report again only when that can help", async () => {
  const resending = finished({ status: "resending", message: "Sending the saved report again." });
  vi.spyOn(api, "run")
    .mockResolvedValueOnce(finished({ status: "failed", reason: "quota", message: "Issue Scout's shared email quota is used up for now." }))
    .mockResolvedValue(resending); // the page checks again after asking
  const retry = vi.spyOn(api, "retryDelivery").mockResolvedValue(resending);
  const { unmount } = render(<Runs id="3" />);
  expect(await screen.findByText("Issue Scout's shared email quota is used up for now.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Email this report again" }));
  await waitFor(() => expect(retry).toHaveBeenCalledWith("3"));
  expect(await screen.findByText("sending again")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Email this report again" })).not.toBeInTheDocument();
  unmount();
  vi.spyOn(api, "run").mockResolvedValue(finished({ status: "failed", reason: "rejected", message: "The email service rejected the message." }));
  render(<Runs id="3" />);
  expect(await screen.findByText("The email service rejected the message.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Email this report again" })).not.toBeInTheDocument();
});
