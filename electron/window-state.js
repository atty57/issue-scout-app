import { readFileSync, writeFileSync } from "node:fs";

// What the window remembers between launches (userData/window.json), the way a browser does: its theme, zoom,
// size, position and whether it was maximized. Display scaling itself comes from Windows, as in Chrome.

// Chrome's zoom levels from 67% to 200%.
export const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DEFAULT_SIZE = { width: 1280, height: 860 };

const validBounds = (bounds) =>
  !!bounds && ["x", "y", "width", "height"].every((key) => Number.isSafeInteger(bounds[key])) && bounds.width > 0 && bounds.height > 0;

export function readWindowState(file) {
  let saved;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    saved = {};
  }
  return {
    theme: saved?.theme === "dark" ? "dark" : "light",
    zoom: ZOOM_STEPS.includes(saved?.zoom) ? saved.zoom : 1,
    bounds: validBounds(saved?.bounds) ? saved.bounds : undefined,
    maximized: saved?.maximized === true,
  };
}

export function writeWindowState(file, state) {
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // Kept for this session only; the next launch opens with the defaults.
  }
}

// The saved bounds while their title bar is still on one of the displays' work areas (a monitor may have been
// unplugged or rearranged), sized to fit it; otherwise the default size, fitted to the primary work area and centered.
export function windowBounds(saved, workAreas, primary) {
  const home = saved && workAreas.find((area) =>
    saved.y >= area.y && saved.y < area.y + area.height - 40 &&
    saved.x + saved.width > area.x + 100 && saved.x < area.x + area.width - 100);
  if (home) return { ...saved, width: Math.min(saved.width, home.width), height: Math.min(saved.height, home.height) };
  const width = Math.min(DEFAULT_SIZE.width, primary.width);
  const height = Math.min(DEFAULT_SIZE.height, primary.height);
  return { x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2), width, height };
}

// "in", "out" or "reset" from Ctrl + plus / minus / 0, on the main keys or the number pad; anything else is undefined.
export function zoomKey(input) {
  if (input.type !== "keyDown" || !input.control || input.alt || input.meta) return undefined;
  if (input.key === "=" || input.key === "+" || input.code === "NumpadAdd") return "in";
  if (input.key === "-" || input.key === "_" || input.code === "NumpadSubtract") return "out";
  if (input.key === "0" || input.code === "Numpad0") return "reset";
  return undefined;
}

export function nextZoom(current, direction) {
  if (direction === "reset") return 1;
  const next = direction === "in" ? ZOOM_STEPS.find((step) => step > current) : ZOOM_STEPS.findLast((step) => step < current);
  return next ?? current;
}
