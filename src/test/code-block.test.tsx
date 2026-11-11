import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodeBlock } from "../components/beautiful";

it("renders an untrusted patch as text and copies the original bytes without line numbers", async () => {
  const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-previous\n+<script>alert('example')</script>\n";
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { container } = render(<CodeBlock title="change.patch" diff>{patch}</CodeBlock>);
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain("+<script>alert('example')</script>");
  fireEvent.click(screen.getByRole("button", { name: "Copy change.patch" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(patch));
  expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  vi.unstubAllGlobals();
});

it("numbers only real lines and keeps blank lines empty, so selected text is the original", () => {
  const { container } = render(<CodeBlock title="change.patch" diff>{"first\n\n+added\n"}</CodeBlock>);
  const lines = [...container.querySelectorAll(".code-line")];
  // Three lines, not four: the final newline ends the last line.
  expect(lines.map((line) => line.querySelector(".line-number")?.textContent)).toEqual(["1", "2", "3"]);
  expect(lines.map((line) => line.lastElementChild?.textContent)).toEqual(["first", "", "+added"]);
  expect(container.textContent).not.toContain(" ");
});
