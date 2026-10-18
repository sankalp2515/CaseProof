import React, { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardH,
  Status,
  ErrorBanner,
  Empty,
  Modal,
} from "../../components/live.jsx";
import { useSession, useAction } from "../../state/resources.jsx";
import { canRequestRole } from "../../api/auth.js";
import { post, loadCaseView } from "../../api/client.js";
import { label } from "../../models/caseView.js";

export default function Requests({ view, reload, stale }) {
  const { persona } = useSession();
  const action = useAction(reload);
  const [confirm, setConfirm] = useState(null),
    [reason, setReason] = useState(""),
    [link, setLink] = useState(null);
  const s = view.snapshot,
    w = view.workflow,
    root = `/v1/cases/${s.case_id}`;
  const requests = s.requests || [],
    proposal = requests.find((r) => r.state === "proposed");
  const processing =
    w.status === "processing" ||
    ["queued", "running", "failed"].includes(w.job?.status);
  const permitted =
    canRequestRole(persona, "analyst") && !stale && !processing && !action.busy;
  const current =
    confirm &&
    confirm.revision === s.revision &&
    confirm.digest === s.digest &&
    requests.some(
      (r) =>
        r.request_id === confirm.request.request_id && r.state === "proposed",
    );
  const others = requests.filter((r) => r !== proposal);
  const invoke = (fn) => action.run(fn).catch(() => {});
  useEffect(() => {
    setLink(null);
    setConfirm(null);
  }, [s.case_id]);
  async function send() {
    const fresh = await loadCaseView(s.case_id, { persona });
    if (
      fresh.identity.revision !== confirm.revision ||
      fresh.identity.digest !== confirm.digest ||
      !fresh.snapshot.requests.some(
        (r) =>
          r.request_id === confirm.request.request_id && r.state === "proposed",
      ) ||
      ["queued", "running", "failed"].includes(fresh.workflow.job?.status)
    ) {
      reload();
      throw new Error(
        "The case or question changed. Close this dialog, refresh and review the current proposal before sending.",
      );
    }
    setLink(
      await post(
        root + "/requests/" + confirm.request.request_id + "/send",
        undefined,
        persona,
      ),
    );
    setConfirm(null);
  }
  return (
    <div className="requests-workspace">
      <div className="section-intro">
        <h2>Resolve the next information gap</h2>
        <p>
          Ask the customer only for information they can supply. Bank-record
          gaps belong with the bank, not the customer.
        </p>
      </div>
      {!canRequestRole(persona, "analyst") && (
        <div className="banner info">
          Reviewer view: inspect the request history. Sending clarification and
          recording bank-data exceptions are analyst actions.
        </div>
      )}
      {processing && (
        <div className="banner info">
          Wait for the current assessment to finish before sending a question. A
          failed job needs attention in Evidence.
        </div>
      )}
      <ErrorBanner error={action.error} />
      <div className="analyst-request-grid">
        <div className="col gap16">
          <Card>
            <CardH
              title="Customer clarification"
              sub="One server-recommended question at a time"
              tour="request-engine"
            />
            <div className="card-b">
              {proposal ? (
                <div className="request-recommendation">
                  <span className="request-label">Recommended question</span>
                  <RequestDetail request={proposal} />
                  <button
                    className="btn primary"
                    disabled={!permitted}
                    onClick={() =>
                      setConfirm({
                        request: proposal,
                        revision: s.revision,
                        digest: s.digest,
                      })
                    }
                  >
                    Review &amp; send <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <Empty>
                  {w.status === "awaiting_information"
                    ? "A question is already with the customer. Wait for their reply; it will create a new assessment."
                    : "No new customer question is proposed for this assessment. Check the next action above."}
                </Empty>
              )}
              {link && (
                <div className="banner ok">
                  <span>
                    Request recorded in the reporting customer’s inbox.{" "}
                  </span>
                  <a
                    href={
                      "#/victim/reply/" +
                      encodeURIComponent(link.url.split("/").at(-1))
                    }
                  >
                    Open scoped reply
                  </a>
                </div>
              )}
            </div>
          </Card>
          {others.length > 0 && (
            <details
              className="request-history"
              open={w.status === "awaiting_information"}
            >
              <summary>
                Other assessed questions and history ({others.length})
              </summary>
              <p className="muted">
                Suppressed questions are already settled; blocked questions must
                not be sent. Alternative proposals retain the server’s ordering.
              </p>
              {others.map((r) => (
                <div className="request-history-row" key={r.request_id}>
                  <RequestDetail request={r} />
                </div>
              ))}
            </details>
          )}
        </div>
        <div className="col gap16">
          <Card>
            <CardH
              title="Why ask this?"
              sub="What the answer can change"
              tour="why-this-request"
            />
            <div className="card-b request-explanation">
              <p>
                {proposal?.explanation?.priority_reason
                  ?.map(label)
                  .join(". ") ||
                  (proposal
                    ? "This question targets information the current assessment still needs."
                    : "No additional question is currently recommended.")}
              </p>
              <h4>What an answer can clarify</h4>
              <p>
                {proposal?.explanation?.can_settle?.map(label).join(", ") ||
                  "The next assessment uses the customer’s response and any supporting evidence."}
              </p>
              <p className="muted">
                A customer statement can explain what happened. It does not
                independently prove the caller’s identity, liability or
                recovery.
              </p>
              <p className="muted">
                After sending, use the server-issued reply link or the
                customer’s own inbox. Do not switch to an unrelated customer
                account.
              </p>
            </div>
          </Card>
          <details className="bank-exception">
            <summary>Bank records unavailable? Record an exception</summary>
            <p>
              This is an internal escalation with a reason, not a way to bypass
              missing evidence. Background services normally refresh bank
              observations.
            </p>
            <label>
              Reason
              <input
                aria-label="Bank data unavailability reason"
                value={reason}
                disabled={!canRequestRole(persona, "analyst")}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why bank verification is unavailable"
              />
            </label>
            <button
              className="btn"
              disabled={!permitted || !reason.trim()}
              onClick={() =>
                invoke(async () => {
                  await post(
                    root + "/bank-verification/unavailable",
                    { reason, expected_revision: s.revision },
                    persona,
                  );
                  setReason("");
                })
              }
            >
              Record unavailable bank data
            </button>
          </details>
        </div>
      </div>
      {confirm && (
        <Modal
          title="Send one focused customer request?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!permitted || !current}
                onClick={() => invoke(send)}
              >
                Confirm request
              </button>
            </>
          }
        >
          <p>{confirm.request.reason}</p>
          <p className="muted">
            Case version {confirm.revision}. The reporting customer receives
            this question in their inbox. External SMS delivery is simulated.
          </p>
          {!current && (
            <div className="banner warn">
              The assessment changed. Close and review the current question
              before sending.
            </div>
          )}
          <ErrorBanner error={action.error} />
        </Modal>
      )}
    </div>
  );
}
function RequestDetail({ request: r }) {
  return (
    <div className="request-detail">
      <div className="row gap8 wrap">
        <h3>{label(r.catalogue_id)}</h3>
        <Status value={r.state} />
      </div>
      <p>{r.reason}</p>
      {r.explanation?.can_settle?.length > 0 && (
        <p className="muted">
          Clarifies: {r.explanation.can_settle.map(label).join(", ")}
        </p>
      )}
    </div>
  );
}
