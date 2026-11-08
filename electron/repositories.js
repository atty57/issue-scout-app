import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validRepository } from "./github.js";

// Only account IDs and repository references are stored here, never credentials.
export function createRepositoryStore(file) {
  function read() {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (error) {
      // A damaged local selection can be reconnected; all Scout data remains on GitHub.
      if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  return {
    get(userId) {
      const value = read()[String(userId)];
      return Number.isSafeInteger(value?.id) && validRepository(value?.full_name) ? { id: value.id, full_name: value.full_name } : undefined;
    },
    set(userId, repository) {
      const data = read();
      data[String(userId)] = { id: repository.id, full_name: repository.full_name };
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
  };
}
