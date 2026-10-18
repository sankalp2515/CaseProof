import React, { useMemo, useState, useEffect, useRef } from "react";
import dagre from "@dagrejs/dagre";
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Maximize,
  Expand,
  Minimize,
} from "lucide-react";
import { Card, Badge, Empty, Metric } from "../../components/live.jsx";
import { formatMinor, time, label } from "../../models/caseView.js";
export function edgeCurve(points) {
  const a = points[0],
    b = points.at(-1),
    mx = (a.x + b.x) / 2;
  return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
}
export function trailTone(account, positions, observation) {
  if (account.kind === "customer") return "victim";
  if (account.kind === "cashout") return "cashout";
  return positions.some((p) => p.status === "unaccounted") || !observation
    ? "uncertain"
    : "observed";
}
export function makeTrailView(snapshot) {
  const trail = snapshot.trail || {},
    accounts = new Map((trail.accounts || []).map((a) => [a.id, a]));
  for (const t of trail.transfers || [])
    for (const id of [t.from_account, t.to_account])
      if (!accounts.has(id))
        accounts.set(id, {
          id,
          label: id,
          bank: "Bank not specified",
          kind: "external",
        });
  return {
    ...trail,
    accounts: [...accounts.values()],
    transfers: trail.transfers || [],
    positions: trail.positions || [],
    account_observations: trail.account_observations || [],
    summary: trail.summary || {},
    assessmentAsOf: snapshot.clock?.as_of,
  };
}
export function layoutTrail(trail) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: 48,
    ranksep: 86,
    marginx: 26,
    marginy: 62,
  });
  g.setDefaultEdgeLabel(() => ({}));
  trail.accounts.forEach((a) => g.setNode(a.id, { width: 200, height: 86 }));
  trail.transfers.forEach((t) =>
    g.setEdge(
      t.from_account,
      t.to_account,
      { width: 78, height: 38 },
      t.txn_id,
    ),
  );
  dagre.layout(g);
  return {
    nodes: trail.accounts.map((a) => ({ ...a, ...g.node(a.id) })),
    edges: trail.transfers.map((t) => ({
      ...t,
      ...g.edge(t.from_account, t.to_account, t.txn_id),
    })),
    bounds: g.graph(),
  };
}
export function transferWindow(transfers) {
  const times = transfers.map((t) => Date.parse(t.ts)).filter(Number.isFinite);
  return times.length
    ? { start: Math.min(...times) - 60000, end: Math.max(...times) + 60000 }
    : null;
}
const timelineTime = (ms, seconds = false) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(ms);
const bankColor = (bank) =>
  bank?.startsWith("Cedar")
    ? "#0e6d70"
    : ["#0e6d70", "#9b303f", "#b23b2b", "#3250ad", "#783e99"][
        Array.from(bank || "").reduce((n, c) => n + c.charCodeAt(0), 0) % 5
      ];
export default function MoneyTrail({ view }) {
  const trail = useMemo(() => makeTrailView(view.snapshot), [view.snapshot]);
  const graph = useMemo(() => layoutTrail(trail), [trail]);
  const [fullscreen, setFullscreen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [screenError, setScreenError] = useState(null);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const canvas = useRef(null),
    [canvasWidth, setCanvasWidth] = useState(0);
  useEffect(() => {
    if (!canvas.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) =>
      setCanvasWidth(entries[0].contentRect.width),
    );
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [trail.transfers.length]);
  const [selected, setSelected] = useState(null),
    [zoom, setZoom] = useState(1),
    [cursor, setCursor] = useState(1),
    [playing, setPlaying] = useState(false),
    [follow, setFollow] = useState(null);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () =>
        setCursor((x) => {
          if (x >= 1) {
            setPlaying(false);
            return 1;
          }
          return Math.min(1, x + 0.025);
        }),
      70,
    );
    return () => clearInterval(id);
  }, [playing]);
  const scale =
    Math.min(
      1,
      canvasWidth ? Math.max(0.72, (canvasWidth - 32) / graph.bounds.width) : 1,
    ) * zoom;
  const ordered = [...trail.transfers].sort((a, b) => a.ts.localeCompare(b.ts));
  const window = transferWindow(ordered);
  const replayTime = window
    ? window.start + cursor * (window.end - window.start)
    : null;
  const active = new Set(
    ordered
      .filter(
        (t) =>
          cursor === 1 ||
          (replayTime !== null && Date.parse(t.ts) <= replayTime),
      )
      .map((t) => t.txn_id),
  );
  const debitIds = new Set(
    (view.snapshot.ledger_matches || []).map((m) => m.txn_id),
  );
  const debits = trail.transfers.filter((t) => debitIds.has(t.txn_id));
  const debitIndex = new Map(debits.map((d, i) => [d.txn_id, i]));
  const edgeStyle = (e) =>
    (debitIndex.get(e.txn_id) ?? 0) > 0
      ? "debit"
      : e.source === "ledger"
        ? "bank"
        : "report";
  const edgeColors = { bank: "#3c9a67", report: "#d48a45", debit: "#d42e29" };
  useEffect(() => {
    setPlaying(false);
    setCursor(1);
  }, [view.identity.caseId, view.snapshot.revision]);
  useEffect(() => {
    if (selected && !trail.accounts.some((a) => a.id === selected))
      setSelected(null);
    if (follow && !debits.some((d) => d.txn_id === follow)) setFollow(null);
  }, [trail]);
  const followed = follow
    ? new Set([
        follow,
        ...trail.positions
          .filter((p) => (p.path || []).includes(follow))
          .flatMap((p) => p.path || []),
      ])
    : null;
  const columns = [...new Set(graph.nodes.map((n) => n.x))].sort(
    (a, b) => a - b,
  );
  const account = trail.accounts.find((a) => a.id === selected),
    positions = trail.positions.filter((p) => p.account === selected),
    observation = trail.account_observations.find(
      (o) => o.account === selected,
    );
  return (
    <div className="trail-wrap live-trail">
      <Card className="graph-card" id="case-trail-canvas">
        <header className="trail-heading" data-tour="money-trail">
          <div>
            <h2>Money Trail</h2>
            <p className="mono muted">
              Graph · {trail.accounts.length} accounts ·{" "}
              {trail.transfers.length} transfers ·{" "}
              {Math.max(0, new Set(graph.nodes.map((n) => n.x)).size - 1)} hops
              · r{view.snapshot.revision}
            </p>
          </div>
          <div className="trail-toolbar">
            <div className="legend" data-tour="trail-legend">
              <span>
                <i style={{ borderColor: edgeColors.bank }} />
                Our bank record
              </span>
              <span>
                <i
                  style={{
                    borderColor: edgeColors.report,
                    borderTopStyle: "dashed",
                  }}
                />
                Receiving-bank report
              </span>
              {debits.length > 1 && (
                <span>
                  <i style={{ borderColor: edgeColors.debit }} />
                  Additional disputed debit
                </span>
              )}
            </div>
            <div className="row gap6 wrap">
              {debits.length > 0 && <small className="muted">Follow</small>}
              {debits.map((d, i) => (
                <button
                  key={d.txn_id}
                  className={"btn sm " + (follow === d.txn_id ? "dark" : "")}
                  aria-pressed={follow === d.txn_id}
                  onClick={() =>
                    setFollow((old) => (old === d.txn_id ? null : d.txn_id))
                  }
                >
                  Debit {i + 1} · {formatMinor(d.amount_minor)}
                </button>
              ))}
              <button
                className="btn sm trail-motion-toggle"
                aria-pressed={motionPaused}
                onClick={() => setMotionPaused((p) => !p)}
              >
                {motionPaused
                  ? "Resume flow animation"
                  : "Pause flow animation"}
              </button>
              <div className="row gap4 trail-zoom">
                {document.fullscreenEnabled && (
                  <button
                    className="icon-btn"
                    aria-label={
                      fullscreen
                        ? "Exit trail full screen"
                        : "Expand money trail"
                    }
                    onClick={async () => {
                      try {
                        setScreenError(null);
                        if (document.fullscreenElement)
                          await document.exitFullscreen();
                        else
                          await document
                            .getElementById("case-trail-canvas")
                            .requestFullscreen();
                      } catch {
                        setScreenError(
                          "Full screen is unavailable in this browser. Use the scrollable graph below.",
                        );
                      }
                    }}
                  >
                    {fullscreen ? <Minimize size={14} /> : <Expand size={14} />}
                  </button>
                )}
                <button
                  className="icon-btn"
                  aria-label="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0.72, z - 0.15))}
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Fit graph"
                  onClick={() => setZoom(1)}
                >
                  <Maximize size={14} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Zoom in"
                  onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            </div>
          </div>
        </header>
        {screenError && <p className="banner info">{screenError}</p>}
        {!trail.transfers.length ? (
          <Empty>
            No sourced trail yet. A missing observation is not zero balance.
          </Empty>
        ) : (
          <div
            className="graph-viewport"
            style={{
              height: Math.min(520, Math.max(250, graph.bounds.height * scale)),
            }}
            ref={canvas}
            tabIndex={0}
            aria-label="Scrollable money trail"
          >
            <div
              className="graph-scale"
              style={{
                width: graph.bounds.width * scale,
                height: graph.bounds.height * scale,
              }}
            >
              <div
                className="live-graph"
                style={{
                  width: graph.bounds.width,
                  height: graph.bounds.height,
                  transform: `scale(${scale})`,
                }}
              >
                {columns.map((x, i) => (
                  <React.Fragment key={x}>
                    <span
                      className="colhead"
                      style={{ left: x - 100, top: 12 }}
                    >
                      {i === 0 ? "Origin · customer" : `Hop ${i}`}
                    </span>
                    {i > 0 && (
                      <span className="colline" style={{ left: x - 127 }} />
                    )}
                  </React.Fragment>
                ))}
                <svg width={graph.bounds.width} height={graph.bounds.height}>
                  <defs>
                    {Object.entries(edgeColors).map(([key, color]) => (
                      <marker
                        key={key}
                        id={"trail-arrow-" + key}
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="3"
                        orient="auto"
                      >
                        <path d="M0,0 L0,6 L7,3 z" fill={color} />
                      </marker>
                    ))}
                  </defs>
                  {graph.edges.map((e) => {
                    const pts = e.points;
                    return (
                      <g
                        key={e.txn_id}
                        opacity={
                          active.has(e.txn_id) &&
                          (!followed || followed.has(e.txn_id))
                            ? 1
                            : 0.15
                        }
                      >
                        <path
                          d={edgeCurve(pts)}
                          fill="none"
                          stroke={edgeColors[edgeStyle(e)]}
                          strokeWidth="1.8"
                          strokeDasharray={
                            edgeStyle(e) === "report" ? "5 4" : undefined
                          }
                          markerEnd={`url(#trail-arrow-${edgeStyle(e)})`}
                        />
                        {!motionPaused &&
                          active.has(e.txn_id) &&
                          (!followed || followed.has(e.txn_id)) && (
                            <circle
                              className="trail-motion"
                              r="3"
                              fill={edgeColors[edgeStyle(e)]}
                            >
                              <animateMotion
                                dur="2.8s"
                                repeatCount="indefinite"
                                path={edgeCurve(pts)}
                              />
                            </circle>
                          )}
                      </g>
                    );
                  })}
                </svg>
                {graph.edges.map((e) => (
                  <span
                    key={e.txn_id}
                    className={"elabel " + edgeStyle(e)}
                    style={{
                      left: e.x,
                      top: e.y,
                      opacity:
                        active.has(e.txn_id) &&
                        (!followed || followed.has(e.txn_id))
                          ? 1
                          : 0.2,
                    }}
                  >
                    {debitIds.has(e.txn_id) && (
                      <small>
                        {(debitIndex.get(e.txn_id) ?? 0) > 0
                          ? "ADDITIONAL DEBIT"
                          : "DEBIT 1"}
                      </small>
                    )}
                    {formatMinor(e.amount_minor)}
                    <small>{time(e.ts).split(", ").at(-1)}</small>
                  </span>
                ))}
                {graph.nodes.map((n) => {
                  const ps = trail.positions.filter((p) => p.account === n.id);
                  const ob = trail.account_observations.find(
                    (o) => o.account === n.id,
                  );
                  const tone = trailTone(n, ps, ob);
                  const attributed = trail.summary?.attributed;
                  return (
                    <button
                      key={n.id}
                      className={
                        "trail-node node " +
                        tone +
                        " " +
                        (selected === n.id ? "selected sel" : "")
                      }
                      style={{
                        left: n.x - 100,
                        top: n.y - 43,
                        opacity:
                          followed &&
                          !trail.transfers.some(
                            (t) =>
                              followed.has(t.txn_id) &&
                              (t.from_account === n.id ||
                                t.to_account === n.id),
                          )
                            ? 0.3
                            : 1,
                      }}
                      aria-pressed={selected === n.id}
                      onClick={() => setSelected(n.id)}
                    >
                      <div className="row gap8">
                        <span
                          className="bank-letter bk"
                          style={{ background: bankColor(n.bank) }}
                        >
                          {n.bank?.slice(0, 3).toUpperCase()}
                        </span>
                        <div className="grow">
                          <b>
                            {n.kind === "customer"
                              ? "Customer"
                              : n.label && n.label !== n.id
                                ? n.label
                                : `${n.bank?.replace(" Demo Bank", "")} · ${n.id.slice(-4)}`}
                          </b>
                          <small>
                            {n.bank} · {n.kind}
                          </small>
                        </div>
                      </div>
                      <div className="foot">
                        {ps.length
                          ? formatMinor(
                              ps.reduce((a, p) => a + p.amount_minor, 0),
                            )
                          : n.kind === "customer"
                            ? "Debited " + formatMinor(view.amounts.confirmed)
                            : "No attributed position"}
                        <span
                          className={
                            "badge mono " +
                            (tone === "uncertain"
                              ? "warn"
                              : tone === "victim"
                                ? "crit"
                                : "ok")
                          }
                        >
                          {tone === "uncertain"
                            ? "Uncertain"
                            : tone === "victim"
                              ? "Customer"
                              : tone === "cashout"
                                ? "Withdrawn"
                                : "Observed"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div className="trail-asof mono muted">
          Assessment as of {time(trail.assessmentAsOf)} · balances require their
          own bank observation
        </div>
        <div className="transfer-sequence">
          <div className="row gap8 wrap">
            <span className="eyebrow">Transfer timeline · IST</span>
            <button
              className="btn sm ghost"
              disabled={!ordered.length || !window}
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                } else {
                  setCursor(0);
                  setPlaying(true);
                }
              }}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}{" "}
              {playing ? "Pause" : "Replay"}
            </button>
            <span className="right mono replay-time">
              {replayTime !== null
                ? timelineTime(replayTime, true)
                : "Time not established"}
            </span>
          </div>
          <div className="scrub trail-scrub">
            <div className="track" />
            <div className="fill" style={{ width: `${cursor * 100}%` }} />
            {window &&
              ordered
                .filter((t) => Number.isFinite(Date.parse(t.ts)))
                .map((t) => (
                  <span
                    className="ev"
                    key={t.txn_id}
                    title={`${formatMinor(t.amount_minor)} · ${time(t.ts)}`}
                    style={{
                      left: `${((Date.parse(t.ts) - window.start) / (window.end - window.start)) * 100}%`,
                      background: edgeColors[edgeStyle(t)],
                    }}
                  />
                ))}
            <span className="knob" style={{ left: `${cursor * 100}%` }} />
            <div className="ticks">
              {window &&
                [0, 0.25, 0.5, 0.75, 1].map((part) => (
                  <span
                    key={part}
                    style={{
                      position: "absolute",
                      left: `${part * 100}%`,
                      transform:
                        part === 1
                          ? "translateX(-100%)"
                          : part === 0
                            ? undefined
                            : "translateX(-50%)",
                    }}
                  >
                    {timelineTime(
                      window.start + part * (window.end - window.start),
                    )}
                  </span>
                ))}
            </div>
            <input
              aria-label="Transfer sequence"
              aria-valuetext={
                replayTime !== null
                  ? timelineTime(replayTime, true) + " IST"
                  : "Time not established"
              }
              disabled={!window}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={cursor}
              onChange={(e) => {
                setPlaying(false);
                setCursor(+e.target.value);
              }}
            />
          </div>
          <p className="muted">
            Observed transfer replay. Account positions stay at the assessment
            time; this does not reconstruct historical balances.
          </p>
        </div>
        {account && (
          <div className="trail-selection">
            <span>
              Selected: <b>{account.label || account.id}</b>
            </span>
            <button
              className="btn sm"
              onClick={() =>
                document.getElementById("trail-inspector")?.focus()
              }
            >
              Inspect sources &amp; observation
            </button>
          </div>
        )}
        <details className="transfer-table">
          <summary>Transfer table · {trail.transfers.length} records</summary>
          <div className="table-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>From → to</th>
                  <th>Amount</th>
                  <th>Time</th>
                  <th>Source / reference</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((t) => (
                  <tr key={t.txn_id}>
                    <td>
                      {t.from_account}
                      <br />→ {t.to_account}
                    </td>
                    <td>{formatMinor(t.amount_minor)}</td>
                    <td>{time(t.ts)}</td>
                    <td>
                      {t.source}
                      <br />
                      {t.reference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
      <div className="col gap12">
        <Card className="card-b" data-tour="trail-positions">
          <div className="eyebrow">Attributed positions · assessment time</div>
          <div className="position-total">
            {formatMinor(trail.summary.recoverable)}
          </div>
          <p className="muted">
            Potentially available at a bank-reported observation. Not a
            confirmed hold or recovery.
          </p>
          <div className="mini-stats">
            <Metric
              title="Unaccounted"
              value={formatMinor(trail.summary.unaccounted)}
            />
            <Metric
              title="Left system"
              value={formatMinor(trail.summary.left_system)}
            />
          </div>
        </Card>
        <Card
          className="card-b"
          data-tour="trail-inspector"
          id="trail-inspector"
          tabIndex={-1}
        >
          <div className="eyebrow">Account inspector</div>
          {account ? (
            <>
              <h2>{account.label || account.id}</h2>
              <p className="muted">
                {account.bank} · {account.id}
              </p>
              <div className="insp-row">
                <span>Attributed to complaint</span>
                <b>
                  {formatMinor(
                    positions.reduce((a, p) => a + p.amount_minor, 0),
                  )}
                </b>
              </div>
              <div className="insp-row">
                <span>Whole account observation</span>
                <b>{formatMinor(observation?.balance_minor)}</b>
              </div>
              <p className="mono muted">{time(observation?.reported_at)}</p>
              {positions.map((p, i) => (
                <div className="statement" key={i}>
                  <Badge tone={p.status === "recoverable" ? "ok" : "warn"}>
                    {label(p.status)}
                  </Badge>
                  <p>
                    {p.status === "left_system"
                      ? "Funds left the observed bank path; this is not available bank balance."
                      : p.availability_note}
                  </p>
                  <small className="hash-text">{p.sources?.join(" · ")}</small>
                </div>
              ))}
            </>
          ) : (
            <Empty>
              Select an account to inspect its sources and observation.
            </Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
