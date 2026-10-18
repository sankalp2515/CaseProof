import { canRequestRole } from "../../api/auth.js";
import React, { useState, useEffect } from "react";
import { FileImage, Upload, ArrowRight, Database } from "lucide-react";
import { GeminiReader } from "../../components/Gemini.jsx";
import {
  Card,
  CardH,
  Badge,
  Status,
  ErrorBanner,
  Empty,
  SourceChip,
  Modal,
} from "../../components/live.jsx";
import { apiRequest, post, evidenceForm } from "../../api/client.js";
import { useSession, useAction } from "../../state/resources.jsx";
import { label, time, formatMinor } from "../../models/caseView.js";

export function boxStyle(box) {
  const [top, left, bottom, right] = box;
  return {
    top: top / 10 + "%",
    left: left / 10 + "%",
    width: (right - left) / 10 + "%",
    height: (bottom - top) / 10 + "%",
  };
}
export default function Evidence({ view, reload, stale }) {
  const { persona } = useSession(),
    { snapshot: s, workflow: w } = view;
  const action = useAction(reload);
  const [selected, setSelected] = useState(
      s.artifacts?.find((a) => a.kind === "receipt")?.artifact_id ||
        s.artifacts?.[0]?.artifact_id,
    ),
    [highlight, setHighlight] = useState(null),
    [boxes, setBoxes] = useState(true),
    [factScope, setFactScope] = useState("current");
  const [file, setFile] = useState(null),
    [kind, setKind] = useState("receipt"),
    [correction, setCorrection] = useState(null),
    [value, setValue] = useState(""),
    [reason, setReason] = useState("");
  const artifacts = s.artifacts || [],
    segments = s.segments || [],
    claims = s.claims || [];
  const artifact =
    artifacts.find((a) => a.artifact_id === selected) || artifacts[0];
  const select = (id) => {
    const seg = segments.find((x) => x.segment_id === id);
    if (seg) {
      setSelected(seg.artifact_id);
      setHighlight(id);
    }
  };
  const desiredSource = new URLSearchParams(
    location.hash.split("?")[1] || "",
  ).get("source");
  const sourceAvailable = segments.some((x) => x.segment_id === desiredSource);
  useEffect(() => {
    if (desiredSource && sourceAvailable) select(desiredSource);
  }, [desiredSource, s.case_id, sourceAvailable]);
  const fileSegments = new Set(
    segments
      .filter((x) => x.artifact_id === artifact?.artifact_id)
      .map((x) => x.segment_id),
  );
  const visibleClaims = claims.filter(
    (c) =>
      c.kind !== "embedded_instruction" &&
      (factScope === "all" ||
        c.anchor_segment_ids?.some((id) => fileSegments.has(id))),
  );
  const processing =
    w.status === "processing" || ["queued", "running"].includes(w.job?.status);
  const canEdit =
    canRequestRole(persona, "analyst") && !stale && !processing && !action.busy;
  const invalidCorrection =
    correction &&
    (correction.kind === "amount"
      ? !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) <= 0
      : !value.trim());
  const run = (fn) => action.run(fn).catch(() => {}),
    root = `/v1/cases/${s.case_id}`;
  return (
    <div className="evidence-workspace">
      <div className="section-intro">
        <h2>Check the original. Verify the detail.</h2>
        <p>
          Select a file on the left, then compare its extracted details with the
          cited source. A detail found in an upload is not automatically
          verified by the bank.
        </p>
      </div>
      {!canRequestRole(persona, "analyst") && (
        <div className="banner info">
          Reviewer view: inspect originals and bank matches. Corrections and new
          evidence are analyst actions.
        </div>
      )}
      {desiredSource && !sourceAvailable && !processing && (
        <div className="banner warn">
          That cited line is not present in this assessment. Inspect the
          available originals or check the earlier version in Audit.
        </div>
      )}
      <div className="g2 evidence-grid">
        <div className="col gap12">
          <Card>
            <CardH
              title="Evidence originals"
              sub="Choose an original and inspect the lines used by this assessment"
              icon={<FileImage size={17} />}
            >
              <button
                className="btn sm"
                onClick={() => setBoxes((v) => !v)}
                aria-pressed={boxes}
              >
                Source boxes {boxes ? "on" : "off"}
              </button>
            </CardH>
            <div className="card-b">
              <div className="artifact-tabs">
                {artifacts.map((a, i) => (
                  <button
                    key={a.artifact_id}
                    aria-pressed={artifact?.artifact_id === a.artifact_id}
                    className={
                      "btn sm " +
                      (artifact?.artifact_id === a.artifact_id ? "dark" : "")
                    }
                    onClick={() => {
                      setSelected(a.artifact_id);
                      setHighlight(null);
                    }}
                  >
                    {label(a.kind)} {i + 1}
                  </button>
                ))}
              </div>
              {highlight && (
                <p className="source-selection" role="status">
                  Selected source:{" "}
                  {segments.find((x) => x.segment_id === highlight)?.text}
                </p>
              )}
              {artifact ? (
                <Original
                  artifact={artifact}
                  caseId={s.case_id}
                  persona={persona}
                  segments={segments.filter(
                    (x) => x.artifact_id === artifact.artifact_id,
                  )}
                  boxes={boxes}
                  highlight={highlight}
                  onSelect={select}
                />
              ) : (
                <Empty>No evidence received.</Empty>
              )}
              {artifact && (
                <GeminiReader
                  caseId={s.case_id}
                  artifact={artifact}
                  persona={persona}
                  onSelect={select}
                />
              )}
              {artifact && (
                <>
                  <p className="muted mono hash-text">
                    sha256:{artifact.sha256}
                  </p>
                  <small className="muted">
                    {artifact.byte_count.toLocaleString()} bytes · received{" "}
                    {time(artifact.received_at)}
                  </small>
                </>
              )}
            </div>
          </Card>
          <Card>
            <CardH
              title="Additional evidence"
              sub="Adds a new revision; originals remain unchanged"
            />
            <div className="card-b">
              <ErrorBanner error={action.error} />
              <p className="muted">
                New evidence creates a new assessment and may invalidate an
                earlier approval.
              </p>
              <label>
                Evidence kind
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {["receipt", "messages", "call_log", "narrative"].map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                PNG, JPEG or UTF-8 text · up to 5 MiB
                <input
                  aria-label="Staff evidence file"
                  type="file"
                  accept="image/png,image/jpeg,text/plain"
                  onChange={(e) => setFile(e.target.files[0])}
                />
              </label>
              <div className="row gap8 wrap">
                <button
                  className="btn primary"
                  disabled={!file || !canEdit}
                  onClick={() =>
                    run(async () => {
                      await apiRequest(root + "/artifacts", {
                        method: "POST",
                        body: evidenceForm(file, kind, s.revision),
                        persona,
                      });
                      await post(root + "/process", undefined, persona);
                      setFile(null);
                    })
                  }
                >
                  <Upload size={14} />
                  Upload & assess
                </button>
                <button
                  className="btn"
                  disabled={
                    !canEdit || ["queued", "running"].includes(w.job?.status)
                  }
                  onClick={() =>
                    run(() =>
                      post(
                        w.job?.status === "failed"
                          ? "/v1/jobs/" + w.job.job_id + "/retry"
                          : root + "/process",
                        undefined,
                        persona,
                      ),
                    )
                  }
                >
                  {w.job?.status === "failed"
                    ? "Retry current failed job"
                    : "Assess received evidence"}
                </button>
              </div>
            </div>
          </Card>
        </div>
        <div className="col gap12">
          <Card>
            <CardH
              title="Details extracted from evidence"
              sub="Compare each value with its source before using it"
              tour="source-linked-facts"
            />
            <div className="card-b col gap8">
              <label className="fact-filter">
                Show details from
                <select
                  aria-label="Evidence fact scope"
                  value={factScope}
                  onChange={(e) => setFactScope(e.target.value)}
                >
                  <option value="current">Selected file</option>
                  <option value="all">All evidence files</option>
                </select>
              </label>
              <div className="evidence-legend">
                <span>
                  <b>Seen on evidence</b> means the source contains this detail.
                </span>
                <span>
                  <b>Bank matched</b> means the separate ledger check confirms
                  the payment.
                </span>
                <span>
                  <b>Conflicting / unresolved</b> needs analyst attention.
                </span>
              </div>
              {visibleClaims.map((c) => (
                <div
                  className={
                    "fact " +
                    (c.evidence_state === "source_supported"
                      ? "verified"
                      : c.evidence_state === "conflicted"
                        ? "rejected"
                        : "draft")
                  }
                  key={c.claim_id}
                >
                  <div className="grow">
                    <div className="lbl">{label(c.kind)}</div>
                    <div className="val">
                      {typeof c.normalized_value === "number" &&
                      c.kind === "amount"
                        ? new Intl.NumberFormat("en-IN", {
                            style: "currency",
                            currency: "INR",
                          }).format(c.normalized_value / 100)
                        : c.kind === "txn_datetime" &&
                            Number.isFinite(Date.parse(c.normalized_value))
                          ? time(c.normalized_value)
                          : String(c.normalized_value ?? "Unresolved")}
                    </div>
                    <div className="muted quote">{c.original_text}</div>
                    <div className="row gap6 wrap">
                      {(c.anchor_segment_ids || []).map((id, i) => (
                        <SourceChip
                          key={id}
                          id={id}
                          caption={"View source " + (i + 1)}
                          onSelect={select}
                        />
                      ))}
                    </div>
                    {c.confidence_note && (
                      <small className="muted">{c.confidence_note}</small>
                    )}
                  </div>
                  <div className="col gap8">
                    <Status value={c.evidence_state} />
                    <button
                      className="btn sm"
                      disabled={!canEdit}
                      onClick={() => {
                        setCorrection({ ...c, revision: s.revision });
                        setValue(String(c.normalized_value ?? ""));
                        setReason("");
                      }}
                    >
                      Correct
                    </button>
                  </div>
                </div>
              ))}
              {!visibleClaims.length && (
                <Empty>
                  {processing
                    ? "Processing this evidence. Extracted details will appear when assessment finishes."
                    : factScope === "current"
                      ? "No extracted details for this file. Inspect the original or choose All evidence files; no facts are invented to fill the panel."
                      : "No usable extracted details in this assessment. Inspect the originals and any processing error."}
                </Empty>
              )}
            </div>
          </Card>
          <Card>
            <CardH
              title="Own-bank matches"
              icon={<Database size={16} />}
              sub="Independently checked against our bank’s payment records"
            />
            <div className="card-b">
              {(s.ledger_matches || []).map((m) => (
                <div key={m.txn_id} className="statement">
                  <b className="mono">{m.txn_id}</b>
                  <p>
                    {Object.entries(m.resolved_fields)
                      .map(
                        ([k, v]) =>
                          label(k) +
                          ": " +
                          (k === "amount"
                            ? formatMinor(v)
                            : k === "txn_datetime"
                              ? time(v)
                              : String(v)),
                      )
                      .join(" · ")}
                  </p>
                  <Badge tone="ok">Bank matched · synthetic ledger</Badge>
                </div>
              ))}
              {!s.ledger_matches?.length && (
                <Empty>No bank-matched disputed payment.</Empty>
              )}
            </div>
          </Card>
        </div>
      </div>
      {correction && (
        <Modal
          title="Correct a sourced claim"
          onClose={() => setCorrection(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCorrection(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={
                  !reason.trim() ||
                  invalidCorrection ||
                  !canEdit ||
                  correction.revision !== s.revision
                }
                onClick={() =>
                  run(async () => {
                    await apiRequest(root + "/claims/" + correction.claim_id, {
                      method: "PATCH",
                      persona,
                      body: {
                        value:
                          correction.kind === "amount" ? Number(value) : value,
                        reason,
                        expected_revision: correction.revision,
                      },
                    });
                    setCorrection(null);
                  })
                }
              >
                Save correction
              </button>
            </>
          }
        >
          <p>Original: {correction.original_text}</p>
          <p className="muted">
            Amount values use integer paisa. The correction still needs support
            in the cited source.
          </p>
          {invalidCorrection && (
            <p className="warn-text">
              {correction.kind === "amount"
                ? "Enter a positive whole number of paisa, for example 5100000 for ₹51,000.00."
                : "Enter a non-empty corrected value."}
            </p>
          )}
          <label>
            Corrected value
            <input value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorBanner error={action.error} />
          {correction.revision !== s.revision && (
            <div className="banner warn">
              The assessment changed. Close and inspect the current claim.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function Original({
  artifact,
  caseId,
  persona,
  segments,
  boxes,
  highlight,
  onSelect,
}) {
  const [url, setUrl] = useState(null),
    [text, setText] = useState(null),
    [error, setError] = useState(null);
  useEffect(() => {
    const c = new AbortController();
    let blobUrl;
    setUrl(null);
    setText(null);
    setError(null);
    apiRequest(
      `/v1/cases/${caseId}/artifacts/${artifact.artifact_id}/content`,
      { persona, signal: c.signal, raw: true },
    )
      .then((r) => r.blob())
      .then(async (blob) => {
        if (c.signal.aborted) return;
        if (artifact.mime_type === "text/plain") setText(await blob.text());
        else {
          blobUrl = URL.createObjectURL(blob);
          setUrl(blobUrl);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e);
      });
    return () => {
      c.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [caseId, artifact.artifact_id, persona]);
  return (
    <>
      <ErrorBanner error={error} />
      {text != null ? (
        <pre className="original-text">{text}</pre>
      ) : url ? (
        <div className="evidence-image">
          <img
            src={url}
            alt={"Original " + label(artifact.kind) + " evidence"}
          />
          {boxes &&
            segments
              .filter((s) => s.box_2d)
              .map((s) => (
                <button
                  key={s.segment_id}
                  style={boxStyle(s.box_2d)}
                  className={
                    "evidence-box " +
                    (highlight === s.segment_id ? "active" : "")
                  }
                  aria-label={"Inspect source: " + s.text}
                  title={s.text}
                  onClick={() => onSelect(s.segment_id)}
                />
              ))}
        </div>
      ) : !error ? (
        <div className="empty">Loading original…</div>
      ) : null}
      <div className="source-lines">
        {segments.map((s) => (
          <button
            key={s.segment_id}
            className={
              "source-line " + (highlight === s.segment_id ? "active" : "")
            }
            onClick={() => onSelect(s.segment_id)}
          >
            <span className="mono muted">{s.segment_id}</span>
            <span>{s.text}</span>
          </button>
        ))}
      </div>
    </>
  );
}
