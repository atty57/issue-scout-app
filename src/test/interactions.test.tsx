import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { api } from "../api";
import { resetMock } from "../mock/server";
import { initialSuggestions } from "../mock/data";
import { SuggestionCard } from "../components/SuggestionCard";
import { Avatar, JobProgress, Markdown } from "../components/ui";
import Feed from "../pages/Feed";
import Profile from "../pages/Profile";
import { ResumeUpload } from "../pages/Onboarding";

async function tick(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  resetMock();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("feedback", () => {
  it("collapses a card and restores it with undo", async () => {
    const onFeedback = vi.fn();
    render(
      <SuggestionCard
        suggestion={initialSuggestions[0]}
        onFeedback={onFeedback}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Good fit:/ }));
    await tick();
    expect(screen.getByText("Thanks, tuned your profile")).toBeInTheDocument();
    expect(onFeedback).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await tick();
    expect(
      screen.getByRole("heading", { name: initialSuggestions[0].issue.title }),
    ).toBeInTheDocument();
    expect(onFeedback).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole("button", { name: /^Good fit:/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("offers undo for five seconds after feedback succeeds", async () => {
    render(<SuggestionCard suggestion={initialSuggestions[0]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Good fit:/ }));
    await tick();
    await tick(4500);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await tick(600);
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  });
  it("submits multiple negative reasons and an optional note", async () => {
    const feedback = vi.spyOn(api, "feedback");
    render(<SuggestionCard suggestion={initialSuggestions[0]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Not a fit:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Too much scope" }));
    fireEvent.click(screen.getByRole("button", { name: "Already taken" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Looking for a focused change." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send feedback/ }));
    await tick();
    expect(feedback).toHaveBeenCalledWith("sg_01", {
      verdict: "down",
      reasons: ["too_big", "already_taken"],
      note: "Looking for a focused change.",
    });
    expect(screen.getByText("Thanks, tuned your profile")).toBeInTheDocument();
  });
  it("keeps the card usable when feedback fails", async () => {
    vi.spyOn(api, "feedback").mockRejectedValueOnce(
      new Error("Could not save feedback."),
    );
    render(<SuggestionCard suggestion={initialSuggestions[0]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Good fit:/ }));
    await tick();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save feedback.",
    );
    expect(screen.getByRole("button", { name: /^Good fit:/ })).toBeEnabled();
  });
});

describe("refresh and job failures", () => {
  it("disables refresh after 429 and re-enables it after retry_after", async () => {
    resetMock("rate_limit");
    render(<Feed />);
    await tick();
    fireEvent.click(
      screen.getByRole("button", { name: /Refresh suggestions/ }),
    );
    await tick();
    expect(
      screen.getByRole("button", { name: /Try again in 30s/ }),
    ).toBeDisabled();
    await tick(29000);
    expect(
      screen.getByRole("button", { name: /Try again in 1s/ }),
    ).toBeDisabled();
    await tick(1000);
    expect(
      screen.getByRole("button", { name: /Refresh suggestions/ }),
    ).toBeEnabled();
  });
  it("shows a failed build and re-uploads the retained file on retry", async () => {
    resetMock("failure");
    const file = new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    });
    const upload = vi.spyOn(api, "upload");
    const complete = vi.fn();
    function Harness() {
      const [id, setId] = useState("job_initial");
      return (
        <JobProgress
          id={id}
          onComplete={complete}
          onRetry={() => {
            void api.upload(file).then((result) => setId(result.job_id));
          }}
        />
      );
    }
    render(<Harness />);
    await tick(2500);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "GitHub was temporarily unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await tick(400);
    expect(upload).toHaveBeenCalledWith(file);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await tick(10000);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("treats an empty shortlist as a normal result", async () => {
    resetMock("empty");
    render(<Feed />);
    await tick();
    expect(
      screen.getByRole("heading", {
        name: "A thoughtful shortlist can be empty.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/Next scout:/)).toBeInTheDocument();
  });
});

describe("resume and profile", () => {
  it("rejects wrong file types and oversized resumes before uploading", async () => {
    const uploaded = vi.fn();
    const upload = vi.spyOn(api, "upload");
    render(<ResumeUpload onUploaded={uploaded} />);
    const input = screen.getByLabelText("Choose resume");
    fireEvent.change(input, {
      target: {
        files: [new File(["test"], "resume.html", { type: "text/html" })],
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a PDF or DOCX resume.",
    );
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], "resume.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("5 MB or smaller");
    expect(upload).not.toHaveBeenCalled();
  });
  it("passes the selected resume back to the app for retry", async () => {
    const uploaded = vi.fn();
    const file = new File(["resume"], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    render(<ResumeUpload onUploaded={uploaded} />);
    fireEvent.change(screen.getByLabelText("Choose resume"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Build my profile/ }));
    await tick();
    expect(uploaded).toHaveBeenCalledWith(expect.stringMatching(/^job_/), file);
  });
  it("locks an edited skill and preserves its evidence sources", async () => {
    const save = vi.spyOn(api, "saveProfile");
    render(<Profile />);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByLabelText("Skill 2"), {
      target: { value: "Distributed tracing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await tick();
    expect(save.mock.calls[0][0].skills[1]).toEqual({
      value: "Distributed tracing",
      sources: ["resume", "octocat/trace-lab", "user"],
      locked: true,
    });
    expect(
      screen.getByText(/Profile saved\. Your updated preferences/),
    ).toBeInTheDocument();
  });
  it("prevents saving a profile without a work type", async () => {
    const save = vi.spyOn(api, "saveProfile");
    render(<Profile />);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(screen.getByLabelText("Code"));
    fireEvent.click(screen.getByLabelText("Documentation"));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(
      screen.getByText("Choose at least one kind of work."),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("untrusted issue content", () => {
  it("drops HTML, images, and unsafe links while securing HTTPS links", () => {
    const { container } = render(
      <Markdown>
        {
          '<img src="x" onerror="alert(1)" /><script>alert(1)</script>\n\n![tracking](https://example.com/pixel)\n\n[unsafe](javascript:alert(1)) [plain](http://example.com) [safe](https://github.com/example/repo)'
        }
      </Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://github.com/example/repo");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });
  it("shows negative scoring components as penalties", () => {
    render(<SuggestionCard suggestion={initialSuggestions[0]} />);
    expect(screen.getByText("scope (penalty)")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
  });
});

it("shows the GitHub avatar and falls back when it fails to load", () => {
  render(<Avatar url="https://avatars.githubusercontent.com/u/7" alt="octocat">O</Avatar>);
  fireEvent.error(screen.getByRole("img", { name: "octocat" }));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("O")).toBeInTheDocument();
});
