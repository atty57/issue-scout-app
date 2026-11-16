import { explain, type Explanation, type SourceField } from "./explain";
import { sideLines, splitPatch, type SplitPatch } from "./patch";
import type { Run } from "./types";

// The visual bug explainer's diagram model (docs/evidence-walkthrough.md, Part 1). Plain data, no React.
// One graph per run; Before, After and Changes are views of it. Three things are kept apart on every node:
//   behaviour  what happens and why: reported in the issue, or Scout's reading of the code. Never observed.
//   code       which lines it is about, and whether the saved patch shows and changes them. A recorded fact.
//   evidence   which recorded check Scout ties to it. The result is the run's; the tie is Scout's.
// A diagram shows an explanation someone wrote; it adds no knowledge. buildDiagram() checks a saved explanation
// like any untrusted file and refuses it whole when the saved patch or issue contradicts it.

export type Presence = "both" | "before" | "after";
export type Revision = "original" | "patched";
export type NodeKind = "input" | "step" | "check" | "failure" | "result" | "statement";
export type CheckId = "tests" | "regression" | "documentation";
export type CodeRef = {
  path: string;
  start_line: number;
  end_line: number;
  quote: string;
  /** "patch": every quoted line is shown by the saved patch and matches. "engine": some or all lie outside what
   *  the patch shows, so only the engine could check them, against the checkout when the run was saved. */
  check: "patch" | "engine";
  /** The patch adds (patched) or removes (original) at least one of these lines. Says nothing about behaviour. */
  changed: boolean;
};
export type DiagramNode = {
  id: string;
  label: string;
  kind: NodeKind;
  presence: Presence;
  /** Of the behaviour, not the code. "reported" carries the issue's own words in `issue_quote`. */
  basis: "reported" | "inferred";
  issue_quote?: string;
  explanation: string;
  code: { original?: CodeRef; patched?: CodeRef };
};
/** No run records an execution trace, so a connection is always Scout's reading. */
export type DiagramEdge = { id: string; from: string; to: string; label?: string; presence: Presence; basis: "inferred"; explanation?: string };
export type Diagram = {
  /** Written by hand for the prototype, not produced by a run. Whatever shows it must say so. */
  sample: boolean;
  kind: "behaviour" | "documentation";
  base_commit: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  reasoning: Record<"intended" | "cause" | "location" | "effect" | "uncertain", string>;
  evidence: { check: CheckId; target: string; note: string; attribution: "inferred" }[];
};
export type Built = { ok: true; diagram: Diagram } | { ok: false; reason: string };
export type Context = { patch: string | null; withheld: boolean; issue: { title: string; body_excerpt?: string } };

export const LIMITS = { nodes: 12, edges: 16, evidence: 8, text: 600, label: 80, lines: 40 };
const KINDS = { behaviour: ["input", "step", "check", "failure", "result"], documentation: ["statement"] } as const;
const CHECKS = { behaviour: ["tests", "regression"], documentation: ["tests", "documentation"] } as const;
const PRESENCE = ["both", "before", "after"] as const;

class Refused extends Error {}
const refuse = (reason: string): never => {
  throw new Refused(reason);
};
const record = (value: unknown, what: string): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : refuse(`${what} isn't in the expected form.`);
const list = (value: unknown, what: string, max: number): unknown[] =>
  Array.isArray(value) && value.length <= max ? value : refuse(`${what} are missing or number more than ${max}.`);
const text = (value: unknown, what: string, max: number, blank = false): string =>
  typeof value === "string" && value.length <= max && (blank || value.trim() !== "") ? value : refuse(`${what} is missing or too long.`);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], what: string): T =>
  allowed.includes(value as T) ? (value as T) : refuse(`${what} isn't one of: ${allowed.join(", ")}.`);
const id = (value: unknown, what: string) => (typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : refuse(`${what} has no usable id.`));
const bare = (line: string) => line.replace(/\r$/, "");

export function buildDiagram(input: unknown, context: Context): Built {
  if (context.withheld) return { ok: false, reason: "The patch was withheld for safety, so no diagram is shown." };
  try {
    return { ok: true, diagram: read(input, context) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}

function read(input: unknown, { patch, issue }: Context): Diagram {
  const raw = record(input, "The explanation");
  const kind = oneOf(raw.kind, ["behaviour", "documentation"] as const, "The explanation's kind");
  const base_commit = typeof raw.base_commit === "string" && /^[0-9a-f]{40}$/.test(raw.base_commit) ? raw.base_commit : refuse("The explanation names no commit for the original code.");
  const split = patch ? splitPatch(patch) : null;
  const reported = `${issue.title}\n${issue.body_excerpt ?? ""}`;
  const ids = new Set<string>();
  const fresh = (value: string, what: string) => (ids.has(value) ? refuse(`${what} repeats the id "${value}".`) : (ids.add(value), value));

  const nodes = list(raw.nodes, "The explanation's steps", LIMITS.nodes).map((value, index): DiagramNode => {
    const node = record(value, `Step ${index + 1}`);
    const what = `Step "${fresh(id(node.id, `Step ${index + 1}`), `Step ${index + 1}`)}"`;
    const presence = oneOf(node.presence, PRESENCE, `${what}'s presence`);
    // "recorded" is refused here on purpose: nothing a run saves observes behaviour, whatever lines the patch changed.
    const basis = oneOf(node.basis, ["reported", "inferred"] as const, `${what}'s basis`);
    const code = node.code === undefined || node.code === null ? {} : record(node.code, `${what}'s code`);
    if (presence === "before" && code.patched != null) refuse(`${what} exists only before the patch but points at patched code.`);
    if (presence === "after" && code.original != null) refuse(`${what} exists only after the patch but points at original code.`);
    const quote = basis === "reported" ? text(node.issue_quote, `${what}'s quote from the issue`, 300) : undefined;
    if (quote !== undefined && !reported.includes(quote)) refuse(`${what} quotes words that aren't in the saved issue text.`);
    return {
      id: node.id as string, label: text(node.label, `${what}'s label`, LIMITS.label), kind: oneOf(node.kind, KINDS[kind], `${what}'s kind`), presence, basis,
      ...(quote === undefined ? {} : { issue_quote: quote }),
      explanation: text(node.explanation, `${what}'s explanation`, LIMITS.text, true),
      code: {
        ...(code.original == null ? {} : { original: reference(code.original, `${what}'s original code`, "original", split) }),
        ...(code.patched == null ? {} : { patched: reference(code.patched, `${what}'s patched code`, "patched", split) }),
      },
    };
  });
  if (!nodes.length) refuse("The explanation has no steps.");
  const presenceOf = new Map(nodes.map((node) => [node.id, node.presence]));

  const edges = list(raw.edges, "The explanation's connections", LIMITS.edges).map((value, index): DiagramEdge => {
    const edge = record(value, `Connection ${index + 1}`);
    const what = `Connection "${fresh(id(edge.id, `Connection ${index + 1}`), `Connection ${index + 1}`)}"`;
    const presence = oneOf(edge.presence, PRESENCE, `${what}'s presence`);
    if (edge.basis !== undefined && edge.basis !== "inferred") refuse(`${what} claims to be more than Scout's reading; no run records the path the code took.`);
    const [from, to] = [edge.from, edge.to].map((end) => (typeof end === "string" && presenceOf.has(end) ? end : refuse(`${what} joins a step that doesn't exist.`)));
    if (from === to) refuse(`${what} joins a step to itself.`);
    // Each view is closed: a connection is only drawn where both of its ends are.
    for (const end of [from, to])
      if (presenceOf.get(end) !== "both" && presenceOf.get(end) !== presence) refuse(`${what} would be drawn in a view that doesn't show step "${end}".`);
    return {
      id: edge.id as string, from, to, presence, basis: "inferred",
      ...(edge.label == null ? {} : { label: text(edge.label, `${what}'s label`, LIMITS.label) }),
      ...(edge.explanation == null ? {} : { explanation: text(edge.explanation, `${what}'s explanation`, LIMITS.text) }),
    };
  });
  if (cyclic(nodes, edges)) refuse("The explanation's connections form a loop.");

  const reasons = raw.reasoning == null ? {} : record(raw.reasoning, "The explanation's reasoning");
  const reason = (key: string) => (reasons[key] == null ? "" : text(reasons[key], `The reasoning's "${key}"`, LIMITS.text, true));
  return {
    sample: raw.sample === true, kind, base_commit, nodes, edges,
    reasoning: { intended: reason("intended"), cause: reason("cause"), location: reason("location"), effect: reason("effect"), uncertain: reason("uncertain") },
    evidence: list(raw.evidence ?? [], "The explanation's evidence links", LIMITS.evidence).map((value, index) => {
      const link = record(value, `Evidence link ${index + 1}`);
      const target = typeof link.target === "string" && ids.has(link.target) ? link.target : refuse(`Evidence link ${index + 1} points at nothing in the diagram.`);
      return { check: oneOf(link.check, CHECKS[kind], `Evidence link ${index + 1}'s check`), target, note: text(link.note, `Evidence link ${index + 1}'s note`, 300, true), attribution: "inferred" as const };
    }),
  };
}

/** Compares a reference with the saved patch, line by line. Lines the patch doesn't show are unknown, not wrong:
 *  a diff carries only a few lines of context. Only a shown line that differs refuses the explanation. */
function reference(value: unknown, what: string, revision: Revision, split: SplitPatch | null): CodeRef {
  const ref = record(value, what);
  const path = text(ref.path, `${what}'s path`, 300);
  const start = ref.start_line as number, end = ref.end_line as number;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= LIMITS.lines) refuse(`${what} has unusable line numbers.`);
  const quote = text(ref.quote, `${what}'s quote`, 4000, true);
  const quoted = quote.split("\n");
  if (quoted.length !== end - start + 1) refuse(`${what} quotes a different number of lines than it names.`);
  let shown = 0, changed = false;
  const file = split?.files.find((candidate) => (revision === "original" ? candidate.oldPath ?? candidate.path : candidate.path) === path);
  if (split && file) {
    if (file.status === (revision === "original" ? "added" : "deleted")) refuse(`${what} points at a version of the file that doesn't exist.`);
    const known = sideLines(split, file, revision);
    quoted.forEach((line, offset) => {
      const saved = known.get(start + offset);
      if (!saved) return;
      if (bare(saved.text) !== bare(line)) refuse(`${what} doesn't match the saved patch.`);
      shown++;
      changed ||= saved.changed;
    });
  }
  return { path, start_line: start, end_line: end, quote, check: shown === quoted.length ? "patch" : "engine", changed };
}

function cyclic(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const waiting = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) waiting.set(edge.to, waiting.get(edge.to)! + 1);
  const ready = nodes.filter((node) => !waiting.get(node.id)).map((node) => node.id);
  let done = 0;
  for (let next; (next = ready.pop()) !== undefined; done++)
    for (const edge of edges) if (edge.from === next && waiting.set(edge.to, waiting.get(edge.to)! - 1).get(edge.to) === 0) ready.push(edge.to);
  return done < nodes.length;
}

/** A place in the layout: a layer (the longest path leading there), and a position among that layer's places. */
export type Slot = { column: number; row: number; rows: number };

/** Where each step sits, and for each connection that skips layers, a place of its own in every layer it passes, so
 *  it is drawn beside the steps there and never through one. Worked out over the whole graph (all three views
 *  together), so a step or connection stays in place when the view changes. */
export function layout(diagram: Diagram): { steps: Map<string, Slot>; routes: Map<string, Slot[]>; columns: number } {
  const column = new Map(diagram.nodes.map((node) => [node.id, 0]));
  // The graph has no loops (buildDiagram refuses them), so one pass per step settles every longest path.
  for (let pass = 0; pass < diagram.nodes.length; pass++)
    for (const edge of diagram.edges) column.set(edge.to, Math.max(column.get(edge.to)!, column.get(edge.from)! + 1));

  type Item = { key: string; column: number; parents: string[]; order: number };
  const items: Item[] = diagram.nodes.map((node, order) => ({ key: node.id, column: column.get(node.id)!, parents: [], order }));
  const step = new Map(items.map((item) => [item.key, item]));
  const passing = new Map<string, string[]>();
  diagram.edges.forEach((edge, index) => {
    const keys: string[] = [];
    let parent = edge.from;
    for (let at = column.get(edge.from)! + 1; at < column.get(edge.to)!; at++) {
      const key = `${edge.id}\n${at}`; // a step id can't contain a line break, so this can't collide with one
      items.push({ key, column: at, parents: [parent], order: diagram.nodes.length + index });
      keys.push(parent = key);
    }
    step.get(edge.to)!.parents.push(parent);
    passing.set(edge.id, keys);
  });

  // Layer by layer, each place goes under the middle of whatever leads to it; ties keep the saved order.
  const slots = new Map<string, Slot>();
  const columns = Math.max(...items.map((item) => item.column)) + 1;
  const middle = (key: string) => slots.get(key)!.row - (slots.get(key)!.rows - 1) / 2;
  const pull = (item: Item) => item.parents.reduce((sum, key) => sum + middle(key), 0) / (item.parents.length || 1);
  for (let at = 0; at < columns; at++) {
    const here = items.filter((item) => item.column === at).sort((a, b) => pull(a) - pull(b) || a.order - b.order);
    here.forEach((item, row) => slots.set(item.key, { column: at, row, rows: here.length }));
  }
  return {
    steps: new Map(diagram.nodes.map((node) => [node.id, slots.get(node.id)!])),
    routes: new Map([...passing].map(([id, keys]) => [id, keys.map((key) => slots.get(key)!)])),
    columns,
  };
}

export type ViewName = "before" | "after" | "changes";
export type Change = "same" | "added" | "removed";

/** One of the three views. Before and After show that version only, with that version's code reference.
 *  Changes shows everything, marks what the patch adds or removes, and gives both references. */
export function view(diagram: Diagram, name: ViewName) {
  const shown = (presence: Presence) => name === "changes" || presence === "both" || presence === name;
  const change = (presence: Presence): Change => (name !== "changes" || presence === "both" ? "same" : presence === "after" ? "added" : "removed");
  const sides: Revision[] = name === "before" ? ["original"] : name === "after" ? ["patched"] : ["original", "patched"];
  return {
    nodes: diagram.nodes.filter((node) => shown(node.presence)).map((node) => ({
      node, change: change(node.presence),
      code: sides.flatMap((revision) => (node.code[revision] ? [{ revision, ...node.code[revision] }] : [])),
      evidence: diagram.evidence.filter((link) => link.target === node.id),
    })),
    edges: diagram.edges.filter((edge) => shown(edge.presence)).map((edge) => ({
      edge, change: change(edge.presence), evidence: diagram.evidence.filter((link) => link.target === edge.id),
    })),
  };
}

/** Scout's words, with where they were saved. `from` is a Run field or a field of the saved explanation. */
export type Answer = { origin: "proposed"; from: SourceField | `explanation.reasoning.${keyof Diagram["reasoning"]}`; text: string };
export type Reasoning = {
  intended: Answer[];
  cause: Answer[];
  location: Answer[];
  effect: Answer[];
  /** What was tested: the run's recorded checks, logs and commands, exactly as explain() gives them. */
  tested: Extract<Explanation, { supported: true }>["evidence"];
  uncertain: Answer[];
};

/** The five questions beside the diagram. An empty list means the run didn't record an answer; nothing is written
 *  in its place. Works without a diagram (every run so far), and needs no patch, so a withheld patch still gets it. */
export function reasoningFor(run: Run, diagram?: Diagram): Reasoning | null {
  const explanation = explain(run);
  if (!explanation.supported || !run.report) return null;
  const said = (from: Answer["from"], words: string | undefined): Answer[] => (words?.trim() ? [{ origin: "proposed", from, text: words }] : []);
  const own = (key: keyof Diagram["reasoning"]) => said(`explanation.reasoning.${key}`, diagram?.reasoning[key]);
  const or = (first: Answer[], second: Answer[]) => (first.length ? first : second);
  return {
    intended: own("intended"),
    cause: or(own("cause"), said("report.root_cause", run.report.root_cause)),
    location: own("location"),
    effect: or(own("effect"), said("report.approach", run.report.approach)),
    tested: explanation.evidence,
    uncertain: [...own("uncertain"), ...said("report.not_verified", run.report.not_verified), ...said("report.risks", run.report.risks)],
  };
}
