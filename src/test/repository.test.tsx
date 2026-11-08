import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import App from "../App";
import RepositoryOnboarding from "../pages/RepositoryOnboarding";
import type { Me } from "../types";

const me: Me = { login: "octocat", avatar_url: "", onboarding: "needs_repository" };
const connected: Me = { ...me, onboarding: "ready", repository: { id: 42, full_name: "octocat/scout", html_url: "https://github.com/octocat/scout" } };

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.location.hash = "/";
});

it("routes a real account needing a repository to repository onboarding", async () => {
  vi.spyOn(api, "me").mockResolvedValue(me);
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Set up your Scout repository." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Browse files" })).not.toBeInTheDocument();
});

it("creates a private workspace and hands the verified account back to the app", async () => {
  const setup = vi.spyOn(api, "setupRepository").mockResolvedValue(connected);
  const onConnected = vi.fn();
  render(<RepositoryOnboarding me={me} onConnected={onConnected} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Repository name" }), { target: { value: " scout " } });
  fireEvent.click(screen.getByRole("button", { name: "Create private repository" }));
  await waitFor(() => expect(onConnected).toHaveBeenCalledWith(connected));
  expect(setup).toHaveBeenCalledWith({ mode: "create", name: "scout" });
});

it("preserves input on an error and lets the user connect the existing copy", async () => {
  const setup = vi.spyOn(api, "setupRepository").mockRejectedValueOnce(new Error("This name is already in use.")).mockResolvedValueOnce(connected);
  const onConnected = vi.fn();
  render(<RepositoryOnboarding me={me} onConnected={onConnected} />);
  fireEvent.click(screen.getByRole("button", { name: "Create private repository" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already in use");
  expect(screen.getByRole("textbox", { name: "Repository name" })).toHaveValue("issue-scout");
  fireEvent.click(screen.getByRole("radio", { name: "Connect existing repository" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Existing repository" }), { target: { value: "octocat/scout" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect repository" }));
  await waitFor(() => expect(onConnected).toHaveBeenCalledWith(connected));
  expect(setup).toHaveBeenLastCalledWith({ mode: "connect", repo: "octocat/scout" });
});

it("prevents repeated submissions and ignores a response after signing out unmounts onboarding", async () => {
  let finish!: (value: Me) => void;
  const setup = vi.spyOn(api, "setupRepository").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onConnected = vi.fn();
  const { unmount } = render(<RepositoryOnboarding me={me} onConnected={onConnected} />);
  const submit = screen.getByRole("button", { name: "Create private repository" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(setup).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("radio", { name: "Connect existing repository" })).toBeDisabled();
  unmount();
  finish(connected);
  await Promise.resolve();
  expect(onConnected).not.toHaveBeenCalled();
});
