// The visual bug explainer: one checked Diagram shown as Before, After and Changes, with an inspector, the five
// reasoning questions and the same graph as text (docs/evidence-walkthrough.md, Part 1). React Flow draws the canvas
// (MIT; see THIRD_PARTY_NOTICES.md); everything it shows comes from src/diagram.ts and is rendered as text.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge, ControlButton, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize } from "lucide-react";
import { CodeBlock } from "./beautiful";
import { layout, view, type Answer, type Change, type CheckId, type Diagram, type DiagramNode, type Reasoning, type Slot, type ViewName } from "../diagram";

type Selection = { kind: "node" | "edge"; id: string };
type Shown = ReturnType<typeof view>;
type Origin = HTMLElement | SVGElement | null;
type Open = (next: Selection, from: Origin) => void;

const VIEWS: [ViewName, string][] = [["before", "Before"], ["after", "After"], ["changes", "Changes"]];
const KIND = { input: "Input", step: "Step", check: "Check", failure: "Failure", result: "Result", statement: "Statement" };
const CHANGED: Record<Change, string> = { same: "", added: "Added by the patch", removed: "Removed by the patch" };
const QUESTIONS: [keyof Omit<Reasoning, "tested" | "uncertain">, string][] = [
  ["intended", "What behaviour was intended?"],
  ["cause", "What caused the reported failure?"],
  ["location", "Why was this location changed?"],
  ["effect", "How does the change address it?"],
];

// What each recorded check says, in words. The regression check "passes" when the new test FAILS on the code before
// the patch, so it is worded as what it shows: whether the bug was reproduced. The recorded flags are untouched.
type CheckState = "passed" | "failed" | "not_run" | "not_applicable" | "missing";
const CHECK_NAME: Record<CheckId, string> = { tests: "Tests", regression: "Reproduction on original code", documentation: "Documentation checks" };
const CHECK_WORDS: Record<CheckId, Record<CheckState, string>> = {
  tests: {
    passed: "Tests passed", failed: "Tests failed", not_run: "Tests did not run",
    not_applicable: "Tests don’t apply to this run", missing: "Tests: nothing recorded",
  },
  regression: {
    passed: "Bug reproduced on original code", failed: "Bug not reproduced on original code",
    not_run: "Reproduction on original code was not attempted", not_applicable: "No reproduction for a documentation fix",
    missing: "Reproduction on original code: nothing recorded",
  },
  documentation: {
    passed: "Documentation checks passed", failed: "Documentation checks failed", not_run: "Documentation checks did not run",
    not_applicable: "Documentation checks don’t apply to this run", missing: "Documentation checks: nothing recorded",
  },
};
const CHECK_MEANING: Partial<Record<CheckId, Partial<Record<CheckState, string>>>> = {
  regression: {
    passed: "The new regression test failed on the code before the patch.",
    failed: "The new regression test did not fail on the code before the patch, so the run didn’t show that it catches the bug.",
    not_run: "The run attempts this only once the tests pass.",
    not_applicable: "A documentation fix changes no behaviour to reproduce.",
  },
};
const checkRow = (reasoning: Reasoning, id: CheckId) => reasoning.tested.rows.find((row) => row.id === id);
const checkState = (reasoning: Reasoning, id: CheckId): CheckState => {
  const row = checkRow(reasoning, id);
  return !row ? "missing" : row.availability === "not_applicable" ? "not_applicable" : row.check;
};
const checkWords = (reasoning: Reasoning, id: CheckId) => CHECK_WORDS[id][checkState(reasoning, id)];
function Check({ reasoning, id }: { reasoning: Reasoning; id: CheckId }) {
  return <span className={`diagram-state ${checkState(reasoning, id)}`}>{checkWords(reasoning, id)}</span>;
}
const lineRange = (start: number, end: number) => (start === end ? `line ${start}` : `lines ${start}–${end}`);
const basisWords = (value: "reported" | "inferred") => (value === "reported" ? "Reported in the issue" : "Scout's reading");

// Geometry, in the diagram's own units (pixels at 100%). Steps have a fixed width; a layer is as tall as its tallest
// step, estimated from the text so the layout is the same in every view and never waits for measurement. The
// estimates err on the tall side: a little spare room is better than two steps touching.
// Two steps side by side fit a 400px canvas (the narrowest window) at the 90% fitting limit.
const STEP = 190, ACROSS = 204, BETWEEN = 64, PAD = 20;
/** Automatic fitting never goes below this, so the smallest step text (13.5px) stays at 12px or more. */
const MIN_FIT = 0.9;
/** A label drawn on a connection; the inspector, the text list and the accessible name carry the whole label. */
const brief = (text: string) => (text.length > 26 ? `${text.slice(0, 25)}…` : text);
const wrapped = (text: string, perLine: number) => Math.ceil(text.length / perLine);
const stepHeight = (node: DiagramNode, checks: string[]) =>
  26 + 21 * wrapped(node.label, 19) + 19 * (wrapped(`${KIND[node.kind]} · ${basisWords(node.basis)}`, 22)
    + (node.presence === "both" ? 0 : 1) + checks.reduce((sum, text) => sum + wrapped(text, 22), 0)) + 12;

function geometry(diagram: Diagram, reasoning: Reasoning) {
  const { steps, routes, columns } = layout(diagram);
  const heights = Array<number>(columns).fill(0);
  for (const node of diagram.nodes) {
    const checks = diagram.evidence.filter((link) => link.target === node.id).map((link) => checkWords(reasoning, link.check));
    heights[steps.get(node.id)!.column] = Math.max(heights[steps.get(node.id)!.column], stepHeight(node, checks));
  }
  const tops = heights.map((_, at) => heights.slice(0, at).reduce((sum, height) => sum + height + BETWEEN, 0));
  const foot = (column: number) => tops[column] + heights[column];
  const middle = (slot: Slot) => (slot.row - (slot.rows - 1) / 2) * ACROSS;
  const all = [...steps.values(), ...[...routes.values()].flat()].map(middle);
  return {
    place: (id: string) => ({ x: middle(steps.get(id)!) - STEP / 2, y: tops[steps.get(id)!.column] }),
    // A connection drops straight to the foot of its own layer, crosses sideways only in the gap between layers,
    // and runs straight down its own place in any layer it skips. So it never passes through a step.
    route: (edge: { id: string; from: string; to: string }): [number, number][] => {
      const from = steps.get(edge.from)!, to = steps.get(edge.to)!;
      return [
        [middle(from), foot(from.column)],
        ...(routes.get(edge.id) ?? []).flatMap((slot): [number, number][] => [[middle(slot), tops[slot.column]], [middle(slot), foot(slot.column)]]),
        [middle(to), tops[to.column]],
      ];
    },
    left: Math.min(...all) - STEP / 2, width: Math.max(...all) - Math.min(...all) + STEP,
    height: foot(columns - 1),
  };
}

type StepData = { label: string; meta: string; change: Change; checks: string[] };
function Step({ data }: NodeProps<Node<StepData, "step">>) {
  return (
    <div className={`diagram-step ${data.change}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="diagram-step-meta">{data.meta}</span>
      <strong>{data.label}</strong>
      {data.change !== "same" && <span className="diagram-step-meta">{CHANGED[data.change]}</span>}
      {data.checks.map((text) => <span className="diagram-step-meta" key={text}>{text}</span>)}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
type RouteData = { points: [number, number][]; branch: boolean; crowded: boolean };
function Route({ sourceX, sourceY, targetX, targetY, data, label, markerEnd, interactionWidth }: EdgeProps<Edge<RouteData, "route">>) {
  const points = data?.points ?? [[sourceX, sourceY], [targetX, targetY]];
  const stops: [number, number][] = [[sourceX, sourceY], ...points, [targetX, targetY]];
  // Each stretch leaves and arrives vertically, so it never cuts sideways across a layer of steps.
  const path = stops.slice(1).reduce((drawn, [x, y], at) => {
    const [fromX, fromY] = stops[at], bend = (fromY + y) / 2;
    return `${drawn} C ${fromX},${bend} ${x},${bend} ${x},${y}`;
  }, `M ${sourceX},${sourceY}`);
  // The label sits in the first gap the connection crosses, clear of every step. Where several labelled connections
  // leave one step it goes to the far end, low in the gap, so the branches' labels stand apart; otherwise it stays
  // at the near end, high in the gap, so labels of connections arriving at one step stand apart too.
  // If another connection arrives at that far end too, the label is pulled back along its own line, off the other.
  const [[nearX, top], [farX, bottom]] = points;
  const share = data?.branch ? 0.7 : 0.3;
  return (
    <BaseEdge
      path={path} label={label} labelY={top + (bottom - top) * share}
      labelX={!data?.branch ? nearX : data.crowded ? farX + (nearX - farX) * 0.4 : farX}
      labelBgPadding={[6, 3]} labelBgBorderRadius={4} markerEnd={markerEnd} interactionWidth={interactionWidth}
    />
  );
}
const nodeTypes = { step: Step };
const edgeTypes = { route: Route };

function Canvas({ diagram, shown, name, reasoning, selection, onOpen }: {
  diagram: Diagram; shown: Shown; name: ViewName; reasoning: Reasoning; selection: Selection | null; onOpen: Open;
}) {
  const flow = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const shape = useMemo(() => geometry(diagram, reasoning), [diagram, reasoning]);
  const label = (id: string) => diagram.nodes.find((node) => node.id === id)?.label ?? id;
  const nodes: Node<StepData, "step">[] = shown.nodes.map(({ node, change, evidence }) => {
    const checks = evidence.map((link) => checkWords(reasoning, link.check));
    return {
      id: node.id, type: "step", position: shape.place(node.id),
      selected: selection?.kind === "node" && selection.id === node.id,
      data: { label: node.label, meta: `${KIND[node.kind]} · ${basisWords(node.basis)}`, change, checks },
      ariaLabel: [node.label, KIND[node.kind], basisWords(node.basis), CHANGED[change], ...checks].filter(Boolean).join(", "),
    };
  });
  const branches = (from: string) => shown.edges.filter((entry) => entry.edge.from === from && entry.edge.label).length > 1;
  const routes = new Map(shown.edges.map(({ edge }) => [edge.id, shape.route(edge)]));
  // Does another connection in this view pass through the far end of this one's first gap?
  const crowded = (id: string) => {
    const [, [x, y]] = routes.get(id)!;
    return [...routes].some(([other, points]) => other !== id && points.some(([px, py]) => px === x && py === y));
  };
  const edges: Edge<RouteData, "route">[] = shown.edges.map(({ edge, change }) => ({
    // Above the steps, so nothing a connection carries is hidden behind one.
    id: edge.id, type: "route", source: edge.from, target: edge.to, label: edge.label && brief(edge.label), className: `diagram-edge ${change}`,
    interactionWidth: 24, zIndex: 1, data: { points: routes.get(edge.id)!, branch: branches(edge.from), crowded: crowded(edge.id) },
    selected: selection?.kind === "edge" && selection.id === edge.id, markerEnd: { type: MarkerType.ArrowClosed },
    ariaLabel: [`From ${label(edge.from)} to ${label(edge.to)}`, edge.label, "Scout's reading", CHANGED[change]].filter(Boolean).join(", "),
  }));

  // One fitting rule for the first view, the Fit button, the 0 key and a resized window. It fits the whole graph
  // (all three views), so switching views moves nothing, and it never shrinks below MIN_FIT: a graph too large for
  // that starts at its top-left and is panned. Zooming further out is the user's own choice, with the buttons or keys.
  const fitted = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const fit = useCallback(() => {
    if (!box.current) return;
    // Width decides the zoom. The canvas is as tall as the graph (the page scrolls), so height never shrinks it.
    // Nested report panels can be narrower than the sample page. Use the spare width for gutters without
    // clipping a graph that still fits at the readable zoom floor. Larger graphs retain panning.
    const across = Math.max(0, Math.min(PAD, (box.current.clientWidth - shape.width * MIN_FIT) / 2));
    const room = box.current.clientWidth - 2 * across;
    const zoom = Math.min(1, Math.max(MIN_FIT, room / shape.width));
    const x = shape.width * zoom <= room ? (box.current.clientWidth - shape.width * zoom) / 2 - shape.left * zoom : across - shape.left * zoom;
    fitted.current = { x, y: PAD, zoom };
    void flow.setViewport(fitted.current);
  }, [flow, shape]);
  // A step that takes focus while partly outside the canvas is moved into it.
  const reveal = (event: React.FocusEvent<HTMLDivElement>) => {
    const item = (event.target as Element).closest(".react-flow__node");
    if (!item || !box.current) return;
    const step = item.getBoundingClientRect(), frame = box.current.getBoundingClientRect(), edge = 8;
    const across = step.left < frame.left + edge ? frame.left + edge - step.left : step.right > frame.right - edge ? frame.right - edge - step.right : 0;
    const down = step.top < frame.top + edge ? frame.top + edge - step.top : step.bottom > frame.bottom - edge ? frame.bottom - edge - step.bottom : 0;
    if (!across && !down) return;
    const at = flow.getViewport();
    void flow.setViewport({ ...at, x: at.x + across, y: at.y + down });
  };
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return;
    // Refit when the canvas changes size, unless the user has moved or zoomed the diagram themselves.
    const observer = new ResizeObserver(() => {
      const now = flow.getViewport(), last = fitted.current;
      if (!last || (Math.abs(now.x - last.x) < 1 && Math.abs(now.y - last.y) < 1 && Math.abs(now.zoom - last.zoom) < 0.001)) fit();
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [flow, fit]);

  // Ctrl with +, - or 0 (and Ctrl + wheel) zooms the whole application, so the diagram never uses Ctrl.
  const keys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const item = (event.target as Element).closest<HTMLElement | SVGElement>(".react-flow__node, .react-flow__edge");
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (event.key === "Enter" || event.key === " ") {
      // Opening is an action of its own, not a change of selection: an item that is already selected opens again.
      if (!item?.dataset.id) return;
      onOpen({ kind: item.classList.contains("react-flow__node") ? "node" : "edge", id: item.dataset.id }, item);
    } else if (event.key === "+" || event.key === "=") void flow.zoomIn();
    else if (event.key === "-") void flow.zoomOut();
    else if (event.key === "0") fit();
    else if (arrow && event.shiftKey) {
      const at = flow.getViewport();
      void flow.setViewport({ ...at, x: at.x - arrow[0] * 60, y: at.y - arrow[1] * 60 });
    } else if (arrow) {
      // Down and up follow a connection; right and left step through the list, so every step can be reached.
      const from = item?.classList.contains("react-flow__node") ? item.dataset.id : undefined;
      const order = shown.nodes.map((entry) => entry.node.id);
      const to = !from ? undefined
        : arrow[1] > 0 ? shown.edges.find((entry) => entry.edge.from === from)?.edge.to
        : arrow[1] < 0 ? shown.edges.find((entry) => entry.edge.to === from)?.edge.from
        : order[order.indexOf(from) + arrow[0]];
      if (!to) return;
      event.currentTarget.querySelector<HTMLElement>(`.react-flow__node[data-id="${to}"]`)?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <div className="diagram-canvas" ref={box} onKeyDown={keys} onFocus={reveal} style={{ height: Math.min(2000, Math.max(360, Math.ceil(shape.height + 2 * PAD))) }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={fit} minZoom={0.3} maxZoom={2} autoPanOnNodeFocus={false}
        nodesDraggable={false} nodesConnectable={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
        panOnScroll={false} preventScrolling={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
        aria-label={`Diagram, ${name} view`}
        ariaLabelConfig={{
          "node.a11yDescription.default": "Press Enter or Space to open this step. Down and up arrows follow connections; right and left move through the steps.",
          "node.a11yDescription.keyboardDisabled": "Press Enter or Space to open this step. Down and up arrows follow connections; right and left move through the steps.",
          "edge.a11yDescription.default": "Press Enter or Space to open this connection.",
        }}
        onNodeClick={(event, node) => onOpen({ kind: "node", id: node.id }, event.currentTarget as HTMLElement)}
        onEdgeClick={(event, edge) => onOpen({ kind: "edge", id: edge.id }, event.currentTarget as SVGElement)}
      >
        <Controls showInteractive={false} showFitView={false}>
          <ControlButton onClick={fit} aria-label="Fit view" title="Fit view"><Maximize size={13} /></ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}

function Said({ answers }: { answers: Answer[] }) {
  if (!answers.length) return <dd className="diagram-source">This run didn’t record this.</dd>;
  return <>{answers.map((answer) => (
    <dd key={answer.from}>
      {answer.text}
      <span className="diagram-source">{answer.from.startsWith("explanation.") ? "Scout’s explanation" : "Scout’s report"}</span>
    </dd>
  ))}</>;
}

function Inspector({ diagram, shown, reasoning, selection }: { diagram: Diagram; shown: Shown; reasoning: Reasoning; selection: Selection | null }) {
  const step = selection?.kind === "node" ? shown.nodes.find((item) => item.node.id === selection.id) : undefined;
  const link = selection?.kind === "edge" ? shown.edges.find((item) => item.edge.id === selection.id) : undefined;
  const label = (id: string) => diagram.nodes.find((node) => node.id === id)?.label ?? id;
  const commit = diagram.base_commit.slice(0, 7);
  if (link) {
    const { edge, change } = link;
    return <>
      <h3>{label(edge.from)} → {label(edge.to)}</h3>
      <p className="diagram-source">Connection · Scout’s reading of the code. No run records the path the code took.</p>
      {change !== "same" && <p>{CHANGED[change]}.</p>}
      {edge.label && <p>When: {edge.label}</p>}
      {edge.explanation ? <p>{edge.explanation}</p> : <p className="diagram-source">Scout gave no explanation for this connection.</p>}
    </>;
  }
  if (!step) return <>
    <h3>Nothing selected</h3>
    <p className="diagram-source">Select a step or a connection to see its code, Scout’s explanation and the recorded checks tied to it.</p>
  </>;
  const { node, change, code, evidence } = step;
  return <>
    <h3>{node.label}</h3>
    <p className="diagram-source">{KIND[node.kind]}{change !== "same" && ` · ${CHANGED[change]}`}</p>

    <h4>What happens here</h4>
    {node.basis === "reported"
      ? <><p className="diagram-source">Reported in the issue:</p><blockquote>{node.issue_quote}</blockquote></>
      : <p className="diagram-source">Scout’s reading of the code. It was not observed.</p>}
    {node.explanation && <p>{node.explanation}</p>}

    <h4>Code</h4>
    {!code.length && <p className="diagram-source">No code is tied to this step in this view.</p>}
    {code.map((ref) => (
      <div key={ref.revision}>
        <p>
          {ref.path}, {lineRange(ref.start_line, ref.end_line)}, {ref.revision === "original" ? `original (commit ${commit})` : "after the patch"}
          <span className="diagram-source">
            {ref.check === "patch"
              ? `Matched against the saved patch. ${ref.changed ? (ref.revision === "original" ? "Removed by it." : "Added by it.") : "Not changed by it."}`
              : `Checked by the engine against ${ref.revision === "original" ? `commit ${commit}` : "the patched code"} when the run was saved. Not shown in the patch.`}
          </span>
        </p>
        <CodeBlock title={`${ref.path} (${ref.revision})`}>{ref.quote}</CodeBlock>
      </div>
    ))}
    {!!code.length && <p className="diagram-source">These lines locate the step. They don’t show that it behaves as described.</p>}

    <h4>Recorded checks</h4>
    {!evidence.length && <p className="diagram-source">No recorded check is tied to this step.</p>}
    {evidence.map((item) => {
      const row = checkRow(reasoning, item.check), meaning = CHECK_MEANING[item.check]?.[checkState(reasoning, item.check)];
      return (
        <div key={item.check}>
          <p><Check reasoning={reasoning} id={item.check} />{meaning && <span className="diagram-source">{meaning}</span>}</p>
          {item.note && <p><span className="diagram-source">Why Scout ties this check to this step:</span>{item.note}</p>}
          {row?.commands.availability === "available" && <CodeBlock title="Commands">{row.commands.commands.map((command) => command.join(" ")).join("\n")}</CodeBlock>}
          {row?.log.availability === "available" && <CodeBlock title={`${CHECK_NAME[item.check]}: log`}>{row.log.text}</CodeBlock>}
          <p className="diagram-source">This is the check’s recorded result. It doesn’t show that each step happened as drawn.</p>
        </div>
      );
    })}
  </>;
}

export function BugDiagram({ diagram, reasoning }: { diagram: Diagram; reasoning: Reasoning }) {
  const [name, setName] = useState<ViewName>("before");
  const [picked, setPicked] = useState<Selection | null>(null);
  // Counts every opening, so opening the item that is already selected still moves focus to the inspector.
  const [opened, setOpened] = useState(0);
  const origin = useRef<Origin>(null);
  const shown = useMemo(() => view(diagram, name), [diagram, name]);
  const inspector = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // A selection only counts while its step or connection exists in the current view.
  const selection = picked && (picked.kind === "node" ? shown.nodes.some((item) => item.node.id === picked.id) : shown.edges.some((item) => item.edge.id === picked.id)) ? picked : null;
  const open: Open = (next, from) => {
    origin.current = from;
    setPicked(next);
    setOpened((count) => count + 1);
  };
  useEffect(() => {
    if (opened) inspector.current?.focus();
  }, [opened]);
  const label = (id: string) => diagram.nodes.find((node) => node.id === id)?.label ?? id;

  return (
    <div className="bug-diagram">
      <div
        className="filter-tabs" role="tablist" aria-label="Version of the code"
        onKeyDown={(event) => {
          const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!move) return;
          const next = (VIEWS.findIndex(([value]) => value === name) + move + VIEWS.length) % VIEWS.length;
          setName(VIEWS[next][0]);
          (event.currentTarget.children[next] as HTMLElement).focus();
          event.preventDefault();
        }}
      >
        {VIEWS.map(([value, text]) => (
          <button
            key={value} role="tab" id={`diagram-tab-${value}`} aria-selected={name === value} aria-controls="diagram-panel"
            tabIndex={name === value ? 0 : -1} className={name === value ? "active" : ""} onClick={() => setName(value)}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="diagram-main" role="tabpanel" id="diagram-panel" aria-labelledby={`diagram-tab-${name}`}>
        <div ref={canvas}>
          <ReactFlowProvider>
            <Canvas diagram={diagram} shown={shown} name={name} reasoning={reasoning} selection={selection} onOpen={open} />
          </ReactFlowProvider>
          <p className="diagram-help">
            Drag to move the diagram. Zoom with the buttons, or with + and − while the diagram has focus; 0 or the Fit button
            fits it to view. Every connection is Scout’s reading of the code: no run records the path the code took.
          </p>
        </div>
        <section
          className="diagram-inspector" ref={inspector} tabIndex={-1} aria-label="Selected step or connection"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !selection) return;
            // Back to whatever opened it: the step or connection on the canvas, or its button in the text list.
            const from = origin.current?.isConnected ? origin.current
              : canvas.current?.querySelector<HTMLElement | SVGElement>(`.react-flow__${selection.kind}[data-id="${selection.id}"]`);
            from?.focus();
          }}
        >
          <Inspector diagram={diagram} shown={shown} reasoning={reasoning} selection={selection} />
        </section>
      </div>

      <section className="diagram-list" aria-label="Steps as text">
        <h3>Steps as text</h3>
        <ol>
          {shown.nodes.map(({ node, change }) => {
            const next = shown.edges.filter((item) => item.edge.from === node.id);
            return (
              <li key={node.id}>
                <button
                  type="button" className="text-button" aria-pressed={selection?.kind === "node" && selection.id === node.id}
                  onClick={(event) => open({ kind: "node", id: node.id }, event.currentTarget)}
                >
                  {node.label}
                </button>
                <span className="diagram-source">
                  {KIND[node.kind]} · {node.basis === "reported" ? "Reported in the issue" : "Scout’s reading"}{change !== "same" && ` · ${CHANGED[change]}`}
                </span>
                {next.map(({ edge, change: edgeChange }) => (
                  <span className="diagram-next" key={edge.id}>
                    Leads to{" "}
                    <button
                      type="button" className="text-button" aria-label={`Connection to ${label(edge.to)}`}
                      aria-pressed={selection?.kind === "edge" && selection.id === edge.id}
                      onClick={(event) => open({ kind: "edge", id: edge.id }, event.currentTarget)}
                    >
                      {label(edge.to)}
                    </button>
                    {edge.label && ` when: ${edge.label}`}{edgeChange !== "same" && ` (${CHANGED[edgeChange].toLowerCase()})`}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      </section>

      <ReasoningPanel reasoning={reasoning} />
    </div>
  );
}

export function ReasoningPanel({ reasoning }: { reasoning: Reasoning }) {
  return (
      <section className="diagram-reasoning" aria-label="Reasoning behind the fix">
        <h3>Reasoning behind the fix</h3>
        <dl>
          {QUESTIONS.map(([key, question]) => <div key={key}><dt>{question}</dt><Said answers={reasoning[key]} /></div>)}
          <div>
            <dt>What was tested, and what remains uncertain?</dt>
            {reasoning.tested.rows.map((row) => (
              <dd key={row.id}><Check reasoning={reasoning} id={row.id} /><span className="diagram-source">Recorded by the run</span></dd>
            ))}
            <Said answers={reasoning.uncertain} />
          </div>
        </dl>
      </section>
  );
}
