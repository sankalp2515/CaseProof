import React, { useEffect, useState } from "react";
import { Sparkles, Copy, Check } from "lucide-react";
import { Card, CardH } from "./ui.jsx";
import { apiRequest, post } from "../api/client.js";
import { useSession } from "../state/resources.jsx";

// Gemini drafts; the server keeps only sentences/findings it could trace to a
// cited source. These panels show what survived and say what was removed.

const modelName = (m) =>
  (m || "Gemini").replace(/^gemini-/i, "Gemini ").replace(/-/g, " ");

function Provenance({ data }) {
  return (
    <p className="gemini-note">
      <Sparkles size={12} /> Drafted by {modelName(data.model)} · every
      sentence checked against its cited source
      {data.dropped_unverified > 0 &&
        ` · ${data.dropped_unverified} unverifiable sentence(s) removed`}
    </p>
  );
}

function Sentences({ rows, sources }) {
  const text = Object.fromEntries((sources || []).map((s) => [s.id, s.text]));
  return (
    <ul className="gemini-sentences">
      {rows.map((r, i) => (
        <li key={i}>
          {r.text}{" "}
          {r.source_ids.map((id) => (
            <span key={id} className="gemini-cite mono" title={text[id] || id}>
              {id}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function useGeminiSummary(caseId, revision, persona) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const c = new AbortController();
    // Keep the previous version's summary on screen while the new one drafts.
    setState((old) => (old.data?.available ? { ...old, refreshing: true } : { loading: true }));
    apiRequest(
      `/v1/cases/${caseId}/genai/summary` +
        (revision != null ? `?revision=${revision}` : ""),
      { persona, signal: c.signal },
    )
      .then((data) =>
        setState((old) =>
          data?.available || !old.data?.available ? { data } : { data: old.data },
        ),
      )
      .catch(
        (e) =>
          e.name !== "AbortError" &&
          setState((old) => (old.data?.available ? { data: old.data } : { data: null })),
      );
    return () => c.abort();
  }, [caseId, revision, persona]);
  return state;
}

export function GeminiSummary({ caseId, revision }) {
  const { persona } = useSession() || {};
  const { loading, data } = useGeminiSummary(caseId, revision, persona);
  const [copied, setCopied] = useState(false);
  if (!loading && !data?.available) return null;
  return (
    <Card className="gemini-card">
      <CardH
        title="AI case summary"
        sub="Gemini reads the verified facts and drafts the analyst summary and the cybercrime statement"
        icon={<Sparkles size={16} />}
        tour="gemini-summary"
      />
      <div className="card-b col gap12">
        {loading ? (
          <p className="muted">Gemini is drafting from the verified facts…</p>
        ) : (
          <>
            <Sentences rows={data.summary} sources={data.sources} />
            {data.cybercrime_statement.length > 0 && (
              <details className="gemini-statement">
                <summary>
                  Draft cybercrime (NCRP) statement for the victim and
                  receiving banks
                </summary>
                <Sentences
                  rows={data.cybercrime_statement}
                  sources={data.sources}
                />
                <button
                  className="btn sm"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(
                        data.cybercrime_statement.map((r) => r.text).join(" "),
                      )
                      .then(() => setCopied(true));
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />} Copy
                  statement
                </button>
              </details>
            )}
            <Provenance data={data} />
          </>
        )}
      </div>
    </Card>
  );
}

export function GeminiStatement({ caseId, revision }) {
  const { persona } = useSession() || {};
  const { data } = useGeminiSummary(caseId, revision, persona);
  if (!data?.available || !data.cybercrime_statement.length) return null;
  return (
    <section className="packet-gemini">
      <b>Statement (AI-drafted, source-checked)</b>
      <Sentences rows={data.cybercrime_statement} sources={data.sources} />
      <Provenance data={data} />
    </section>
  );
}

export function GeminiReader({ caseId, artifact, persona, onSelect }) {
  const [state, setState] = useState(null);
  useEffect(() => setState(null), [artifact.artifact_id]);
  if (!artifact.mime_type.startsWith("image/")) return null;
  const run = () => {
    setState({ loading: true });
    apiRequest(
      `/v1/cases/${caseId}/artifacts/${artifact.artifact_id}/genai-read`,
      { persona },
    )
      .then((data) => setState({ data }))
      .catch(() => setState({ data: { available: false } }));
  };
  const data = state?.data;
  return (
    <div className="gemini-reader">
      {!state ? (
        <button className="btn sm" data-tour="gemini-read" onClick={run}>
          <Sparkles size={13} /> Ask Gemini to read this image
        </button>
      ) : state.loading ? (
        <p className="muted">Gemini is reading the image…</p>
      ) : !data.available ? (
        <p className="muted">Gemini reading is unavailable right now.</p>
      ) : (
        <>
          <b>{data.document_type || "Evidence"}: what Gemini found</b>
          <ul className="gemini-findings">
            {data.findings.map((f, i) => (
              <li key={i}>
                <button
                  className="linklike"
                  onClick={() => onSelect(f.segment_ids[0])}
                >
                  <span className="muted">{f.label}</span>{" "}
                  <span className="mono">{f.value}</span>
                </button>
              </li>
            ))}
          </ul>
          {data.scam_signals.length > 0 && (
            <>
              <b>Scam signals</b>
              <ul className="gemini-findings">
                {data.scam_signals.map((s, i) => (
                  <li key={i}>
                    <button
                      className="linklike"
                      onClick={() => onSelect(s.segment_ids[0])}
                    >
                      {s.signal}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="gemini-note">
            <Sparkles size={12} /> {modelName(data.model)} · each finding is
            kept only if its exact text is in the boxed line it points to; click
            one to highlight it
            {data.dropped_unverified > 0 &&
              ` · ${data.dropped_unverified} unverifiable item(s) removed`}
          </p>
        </>
      )}
    </div>
  );
}

export function IntakeHelper({ narrative }) {
  const [state, setState] = useState(null);
  const ready = narrative.trim().length >= 10;
  const run = () => {
    setState({ loading: true });
    post("/v1/victim/intake-assist", { narrative })
      .then((data) => setState({ data }))
      .catch(() => setState({ data: { available: false } }));
  };
  const data = state?.data;
  return (
    <div className="intake-helper" aria-live="polite">
      <button
        type="button"
        className="btn sm"
        disabled={!ready || state?.loading}
        onClick={run}
        data-tour="intake-helper"
      >
        <Sparkles size={13} />{" "}
        {state?.loading ? "Checking…" : "Check what my description is missing"}
      </button>
      {data &&
        (!data.available ? (
          <p className="muted">The helper is unavailable; you can continue.</p>
        ) : (
          <div className="intake-result">
            {data.questions.length ? (
              <>
                <b>
                  To help the bank act quickly, please also add
                  {data.language ? ` (${data.language})` : ""}:
                </b>
                <ul>
                  {data.questions.map((q) => (
                    <li key={q.fact}>{q.question}</li>
                  ))}
                </ul>
              </>
            ) : (
              <b>Your description covers what the bank needs first.</b>
            )}
            {data.present.length > 0 && (
              <p className="muted">
                Already clear:{" "}
                {data.present.map((p) => `“${p.quote}”`).join(" · ")}
              </p>
            )}
            <p className="gemini-note">
              <Sparkles size={12} /> Questions worded by {modelName(data.model)}{" "}
              in your language; the bank's rules decide what is needed. Never
              share an OTP, PIN or password.
            </p>
          </div>
        ))}
    </div>
  );
}
