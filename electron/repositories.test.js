import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createRepositoryStore } from "./repositories.js";

let directory, file;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "issue-scout-repositories-"));
  file = path.join(directory, "repositories.json");
});
afterEach(() => {
  if (!directory.startsWith(path.join(tmpdir(), "issue-scout-repositories-"))) throw new Error("Unsafe test cleanup path.");
  rmSync(directory, { recursive: true, force: true });
});

it("persists account-specific references across restarts without arbitrary fields", () => {
  const store = createRepositoryStore(file);
  expect(store.get(7)).toBeUndefined();
  store.set(7, { id: 42, full_name: "octocat/scout", token: "never-save-this" });
  store.set(8, { id: 43, full_name: "other/scout" });
  const restarted = createRepositoryStore(file);
  expect(restarted.get(7)).toEqual({ id: 42, full_name: "octocat/scout" });
  expect(restarted.get(8)).toEqual({ id: 43, full_name: "other/scout" });
  expect(readFileSync(file, "utf8")).not.toContain("never-save-this");
});

it("forgets one account's repository and keeps the others", () => {
  const store = createRepositoryStore(file);
  store.set(7, { id: 42, full_name: "octocat/scout" });
  store.set(8, { id: 43, full_name: "other/scout" });
  store.forget(7);
  const restarted = createRepositoryStore(file);
  expect(restarted.get(7)).toBeUndefined();
  expect(restarted.get(8)).toEqual({ id: 43, full_name: "other/scout" });
  restarted.forget(99); // nothing saved for that account
  expect(createRepositoryStore(file).get(8)).toEqual({ id: 43, full_name: "other/scout" });
});

it.each(["broken json", "[]", "null", '{"7":{"id":42,"full_name":"../escape"}}'])("lets a user reconnect after a damaged local selection: %s", (content) => {
  writeFileSync(file, content);
  const store = createRepositoryStore(file);
  expect(store.get(7)).toBeUndefined();
  store.set(7, { id: 42, full_name: "octocat/scout" });
  expect(createRepositoryStore(file).get(7)).toEqual({ id: 42, full_name: "octocat/scout" });
});
