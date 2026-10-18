import React, { useEffect, useRef } from "react";
import { X, Check, AlertTriangle, ArrowRight } from "lucide-react";
import { label } from "../models/caseView.js";
export { Card, CardH, LogoMark, Ring } from "./ui.jsx";
export function Badge({ tone = "outline", children }) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Status({ value }) {
  return (
    <Badge
      tone={
        ["completed", "assessed", "done", "source_supported", "sent"].includes(value)
          ? "ok"
          : ["failed", "conflicted"].includes(value)
            ? "crit"
            : ["processing", "running", "queued"].includes(value)
              ? "ai"
              : "warn"
      }
    >
      {value === "completed" ? "Reports delivered" : label(value)}
    </Badge>
  );
}
export function ErrorBanner({ error, onRetry }) {
  return error ? (
    <div className="banner crit" role="alert">
      <AlertTriangle size={16} />
      <span className="grow">
        {error.message}
        {Object.entries(error.fieldErrors || {}).map(([field, msg]) => (
          <span key={field}>
            <br />
            {field}: {msg}
          </span>
        ))}
      </span>
      {error.code === "practice_session_required" && (
        <a className="btn sm primary" href="#/victim/start">
          Start a practice session
        </a>
      )}
      {onRetry && error.code !== "practice_session_required" && (
        <button className="btn sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  ) : null;
}
export function Loading({ message = "Loading current records…" }) {
  return (
    <div className="loading-state" role="status">
      <span className="skel" />
      <span className="skel" />
      <span className="muted">{message}</span>
    </div>
  );
}
export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
export function Metric({ title, value, tone }) {
  return (
    <div className="mini">
      <small>{title}</small>
      <b style={tone ? { color: `var(--${tone})` } : undefined}>{value}</b>
    </div>
  );
}
export function Modal({ title, children, onClose, footer }) {
  const ref = useRef();
  useEffect(() => {
    const before = document.activeElement;
    const el = ref.current;
    el?.querySelector("button,input,textarea,select")?.focus();
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          el.querySelectorAll("button,input,textarea,select,a[href]"),
        ).filter((n) => !n.disabled);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-h row">
          <h3>{title}</h3>
          <button
            className="btn ghost sm right"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
export function SourceChip({ id, onSelect, caption }) {
  return (
    <button
      className="chip-cite"
      onClick={() => onSelect?.(id)}
      title={"Inspect source: " + id}
      aria-label={"Inspect source: " + id}
    >
      {caption || id}
    </button>
  );
}
