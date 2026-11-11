// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { nextZoom, readWindowState, windowBounds, writeWindowState, zoomKey } from "./window-state.js";

const file = () => path.join(mkdtempSync(path.join(tmpdir(), "issue-scout-window-")), "window.json");

it("remembers theme, zoom, bounds and maximized, and ignores anything it didn't write", () => {
  const saved = file();
  expect(readWindowState(saved)).toEqual({ theme: "light", zoom: 1, bounds: undefined, maximized: false });
  const state = { theme: "dark", zoom: 1.25, bounds: { x: 10, y: 20, width: 900, height: 700 }, maximized: true };
  writeWindowState(saved, state);
  expect(readWindowState(saved)).toEqual(state);
  writeFileSync(saved, JSON.stringify({ theme: "blue", zoom: 7, bounds: { x: "0", y: 0, width: 900, height: 700 }, maximized: "yes" }));
  expect(readWindowState(saved)).toEqual({ theme: "light", zoom: 1, bounds: undefined, maximized: false });
  writeFileSync(saved, "{not json");
  expect(readWindowState(saved).zoom).toBe(1);
});

it("reopens where it was while that spot is still on a display, and otherwise fits the primary display", () => {
  const primary = { x: 0, y: 0, width: 1536, height: 824 }; // 1080p at 125% scaling
  const right = { x: 1536, y: 0, width: 1920, height: 1040 };
  const saved = { x: 1700, y: 100, width: 1000, height: 700 };
  expect(windowBounds(saved, [primary, right], primary)).toEqual(saved);
  // Taller than its display now (scaling went up): it keeps its place and fits.
  expect(windowBounds({ ...saved, x: 100, height: 1200 }, [primary], primary)).toEqual({ x: 100, y: 100, width: 1000, height: 824 });
  // On a monitor that's gone: the default size, fitted to the primary work area and centered.
  expect(windowBounds(saved, [primary], primary)).toEqual({ x: 128, y: 0, width: 1280, height: 824 });
  expect(windowBounds(undefined, [right], right)).toEqual({ x: 1536 + 320, y: 90, width: 1280, height: 860 });
  // Title bar above the top of the screen can't be dragged back, so it doesn't count as visible.
  expect(windowBounds({ ...saved, x: 100, y: -300 }, [primary], primary).y).toBe(0);
});

it("zooms through Chrome's steps from Ctrl + plus, minus and 0 only", () => {
  const down = (input) => zoomKey({ type: "keyDown", control: true, alt: false, meta: false, ...input });
  expect(down({ key: "=", code: "Equal" })).toBe("in");
  expect(down({ key: "+", code: "Equal" })).toBe("in");
  expect(down({ key: "-", code: "Minus" })).toBe("out");
  expect(down({ key: "0", code: "Numpad0" })).toBe("reset");
  expect(down({ key: "Add", code: "NumpadAdd" })).toBe("in");
  expect(down({ key: "=", control: false })).toBeUndefined();
  expect(down({ key: "=", alt: true })).toBeUndefined();
  expect(zoomKey({ type: "keyUp", control: true, key: "=" })).toBeUndefined();
  expect([nextZoom(1, "in"), nextZoom(1.1, "in"), nextZoom(1, "out"), nextZoom(1.25, "reset")]).toEqual([1.1, 1.25, 0.9, 1]);
  expect([nextZoom(2, "in"), nextZoom(0.67, "out")]).toEqual([2, 0.67]);
});
