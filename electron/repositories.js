import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validRepository } from "./github.js";

function readJson(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    // Damaged local state can be set up again; all Scout data remains on GitHub.
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}
function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

// Only account IDs and repository references are stored here, never credentials.
export function createRepositoryStore(file) {
  return {
    get(userId) {
      const value = readJson(file)[String(userId)];
      return Number.isSafeInteger(value?.id) && validRepository(value?.full_name) ? { id: value.id, full_name: value.full_name } : undefined;
    },
    set(userId, repository) {
      const data = readJson(file);
      data[String(userId)] = { id: repository.id, full_name: repository.full_name };
      writeJson(file, data);
    },
    // Only this computer's link to the repository; the repository itself is untouched.
    forget(userId) {
      const data = readJson(file);
      delete data[String(userId)];
      writeJson(file, data);
    },
  };
}

// Email confirmation state per Scout repository ID: the address, a pending request ID, and whether the relay
// confirmed it. The relay decides who gets email; this only lets the app show the state. No credentials.
export function createEmailStore(file) {
  return {
    get(repositoryId) {
      const value = readJson(file)[String(repositoryId)];
      return value && typeof value.email === "string" ? {
        email: value.email, confirmed: value.confirmed === true,
        ...(typeof value.handle === "string" && /^[0-9a-f]{64}$/.test(value.handle) ? { handle: value.handle } : {}),
      } : undefined;
    },
    set(repositoryId, value) {
      const data = readJson(file);
      data[String(repositoryId)] = value;
      writeJson(file, data);
    },
  };
}
