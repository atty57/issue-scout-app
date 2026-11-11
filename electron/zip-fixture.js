// Test helper only: builds zip archives in memory, including broken ones, and loads the engine's real
// artifacts from electron/fixtures (written by the template's own notify() and finish(), offline).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (...parts) => path.join(FIXTURES, ...parts);

// entries: [{ name, content, method (8 deflate, 0 stored), and overrides for crc, length or flags }]
export function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "");
    const method = entry.method ?? 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(entry.name);
    const crc = entry.crc ?? crc32(data), length = entry.length ?? data.length, flags = entry.flags ?? 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// The engine's saved files for an outcome: fix_verified, fix_not_verified, no_fix or no_pick.
export function engineFiles(outcome) {
  return Object.fromEntries(["result.json", "report.txt", "change.patch"]
    .filter((name) => existsSync(fixture(outcome, name)))
    .map((name) => [name, readFileSync(fixture(outcome, name), "utf8")]));
}

export const engineArchive = (outcome, extra = {}) =>
  zip(Object.entries({ ...engineFiles(outcome), ...extra }).map(([name, content]) => ({ name, content })));

export const engineHistory = () => readFileSync(fixture("seen.json"), "utf8");

// A fetch Response body, delivered in chunks so size limits are checked while reading.
export function streamed(buffer, chunk = 64 * 1024) {
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < buffer.length; at += chunk) controller.enqueue(new Uint8Array(buffer.subarray(at, at + chunk)));
      controller.close();
    },
  });
}
