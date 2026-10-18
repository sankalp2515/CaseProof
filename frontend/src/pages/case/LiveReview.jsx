import { canRequestRole } from "../../api/auth.js";
import React, { useState } from "react";
import { ShieldCheck, Clock, Check, AlertTriangle, Send } from "lucide-react";
import {
  Card,
  CardH,
  Badge,
  ErrorBanner,
  Modal,
  Status,
} from "../../components/live.jsx";
import { useAction, useSession, useResource } from "../../state/resources.jsx";
import { apiRequest, post, loadCaseView } from "../../api/client.js";
import { formatMinor, label } from "../../models/caseView.js";

export default function Review({ view, reload, stale }) {
  const { persona } = useSession(),
    action = useAction(reload);
  const [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(null),
    [urgent, setUrgent] = useState(null),
    [preview, setPreview] = useState(null);
  const { snapshot: s, workflow: w } = view,
    root = `/v1/cases/${s.case_id}`;
  const referrals = useResource(
    "review-referrals:" + s.case_id + ":" + persona,
    (signal) => apiRequest(root + "/urgent-referrals", { persona, signal }),
  );
  const pendingUrgent =
    urgent?.revision === s.revision && urgent?.digest === s.digest
      ? urgent
      : (referrals.data || []).find(
          (r) =>
            !r.delivery &&
            r.approval.revision === s.revision &&
            r.approval.digest === s.digest,
        )?.approval;
  const current =
    confirm && confirm.revision === s.revision && confirm.digest === s.digest;
  const full =
    w.readiness === "COMPLETE_CANDIDATE" ||
    w.readiness === "ESCALATE_CANDIDATE";
  const canReview =
    canRequestRole(persona, "reviewer") &&
    !action.busy &&
    !stale &&
    !["queued", "running", "failed"].includes(w.job?.status);
  const alreadyApproved =
    w.approval?.revision === s.revision && w.approval?.digest === s.digest;
  const perform = (fn) => action.run(fn).catch(() => {});
  async function decide() {
    const fresh = await loadCaseView(s.case_id, { persona });
    if (
      fresh.identity.revision !== confirm.revision ||
      fresh.identity.digest !== confirm.digest
    )
      throw new Error(
        "The case changed. Close this dialog and review the current assessment.",
      );
    const body = {
      reason: confirm.reason,
      expected_revision: confirm.revision,
      digest: confirm.digest,
    };
    const result = await post(
      root + (confirm.kind === "urgent" ? "/urgent-referrals" : "/reviews"),
      confirm.kind === "urgent"
        ? body
        : { ...body, disposition: confirm.disposition },
      persona,
    );
    if (confirm.kind === "urgent") setUrgent(result);
    setConfirm(null);
  }
  return (
    <div className="g2 review-grid">
      <div className="col gap12">
        <Card>
          <CardH
            title="Readiness assessment"
            sub="Deterministic requirements · not model confidence"
          />
          <div className="card-b">
            <div className="row gap8 wrap">
              <Status value={w.readiness} />
              <Badge tone="outline">Policy {s.readiness.policy_version}</Badge>
            </div>
            {s.readiness.satisfied_facts.map((f) => (
              <div className="readiness-line" key={f}>
                <Check size={15} className="ok-text" />
                {label(f)}
              </div>
            ))}
            {w.unresolved?.map((f) => (
              <div className="readiness-line" key={f}>
                <AlertTriangle size={15} className="warn-text" />
                {label(f)}
              </div>
            ))}
            {s.readiness.blocking_conflicts.map((f) => (
              <div className="banner crit" key={f}>
                Material conflict: {f}
              </div>
            ))}
            <p className="muted">
              Complete documentation and urgent response are separate decisions.
            </p>
          </div>
        </Card>
        <Card>
          <CardH
            title="Reviewer rationale"
            sub="Required for either decision"
          />
          <div className="card-b">
            <label>
              Reason for the supported action
              <textarea
                aria-label="Reviewer rationale"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="State the facts and limitations supporting this decision"
                rows={5}
              />
            </label>
            <ErrorBanner error={action.error} />
            {!canRequestRole(persona, "reviewer") && (
              <div className="banner info">
                Choose Reviewer demo in the staff persona selector to record an
                authorised decision.
              </div>
            )}
            <div className="bound">
              <div>Case version {s.revision}</div>
              <div className="hash-text" title={"sha256:" + s.digest}>
                Fingerprint {s.digest?.slice(0, 12)}…
              </div>
            </div>
            <p className="muted">
              New evidence or bank observations require a fresh review. This
              screen never invents a frozen revision.
            </p>
          </div>
        </Card>
      </div>
      <div className="col gap12">
        <Card>
          <CardH
            title="Urgent transaction referral"
            icon={<Clock size={17} />}
            sub="A supported first response can precede a complete packet"
          />
          <div className="card-b">
            <Badge tone={w.urgent_referral.eligible ? "ok" : "warn"}>
              {w.urgent_referral.eligible
                ? "Eligible for human review"
                : "Not yet eligible"}
            </Badge>
            <p>{w.urgent_referral.reason}</p>
            <details className="referral-help">
              <summary>When would I use this?</summary>
              <p>
                A customer reports a safe-account scam. The bank confirms the
                disputed debit, but the complete narrative or downstream trail
                is still being clarified. An authorised reviewer can approve an
                early alert about that identified transaction without claiming
                the full investigation is complete.
              </p>
              <p>
                Eligibility comes from the current server assessment: a matched
                disputed debit, no material conflict and no unprocessed
                evidence. Delivery is an acknowledgement, not a freeze or
                refund.
              </p>
            </details>
            <div className="bound">
              {w.urgent_referral.transaction_ids?.map((id) => (
                <div className="mono" key={id}>
                  {id}
                </div>
              ))}
            </div>
            <button
              className="btn primary full"
              disabled={
                !canReview ||
                !reason.trim() ||
                !w.urgent_referral.eligible ||
                !!pendingUrgent
              }
              onClick={() =>
                setConfirm({
                  kind: "urgent",
                  revision: s.revision,
                  digest: s.digest,
                  reason,
                })
              }
            >
              <ShieldCheck size={14} />
              Review urgent referral
            </button>
            {pendingUrgent && (
              <div className="banner ok">
                Urgent approval recorded. Sending is a separate action below.
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardH
            title="Complete handoff / escalation"
            icon={<ShieldCheck size={17} />}
            sub="Full readiness, authority and fresh sources are checked server-side"
          />
          <div className="card-b">
            <p>
              {full
                ? "The current assessment supports review of " +
                  (w.readiness === "COMPLETE_CANDIDATE"
                    ? "a complete handoff."
                    : "an escalation with explicit gaps.")
                : "Resolve the outstanding requirements or record supported unavailability before complete-case review."}
            </p>
            <button
              className="btn ok full"
              disabled={
                !canReview ||
                !reason.trim() ||
                !full ||
                alreadyApproved ||
                w.bank_data_refresh_required
              }
              onClick={() =>
                setConfirm({
                  kind: "full",
                  disposition:
                    w.readiness === "COMPLETE_CANDIDATE"
                      ? "COMPLETE_HANDOFF"
                      : "ESCALATE_WITH_GAPS",
                  revision: s.revision,
                  digest: s.digest,
                  reason,
                })
              }
            >
              Review{" "}
              {w.readiness === "ESCALATE_CANDIDATE"
                ? "escalation"
                : "complete handoff"}
            </button>
            {alreadyApproved && (
              <div className="banner ok">
                Current revision approved. Review destination delivery in
                Delivery & follow-up.
              </div>
            )}
          </div>
        </Card>
        {pendingUrgent && (
          <Card className="card-b">
            <h3>Approved urgent referral</h3>
            <p className="mono">
              {pendingUrgent.approval_id} · r{pendingUrgent.revision}
            </p>
            <p>{pendingUrgent.reason}</p>
            <button
              className="btn primary"
              disabled={
                action.busy ||
                !canReview ||
                !canRequestRole(persona, "reviewer") ||
                pendingUrgent.revision !== s.revision ||
                stale
              }
              onClick={() =>
                perform(async () => {
                  await post(
                    root +
                      "/urgent-referrals/" +
                      pendingUrgent.approval_id +
                      "/send",
                    undefined,
                    persona,
                  );
                  setUrgent(null);
                  referrals.reload();
                })
              }
            >
              <Send size={14} />
              Send approved referral to simulator
            </button>
            <p className="muted">
              Receipt acknowledgement only; no hold or recovery claim.
            </p>
          </Card>
        )}
      </div>
      <Card className="report-preview-card">
        <CardH
          title="Draft report"
          sub="Server-generated payment inventory before review"
        />
        <div className="card-b">
          <button
            className="btn"
            disabled={action.busy}
            onClick={() =>
              perform(async () =>
                setPreview(
                  await apiRequest(root + "/report-preview", { persona }),
                ),
              )
            }
          >
            Inspect draft report
          </button>
          {preview && (
            <div className="bound">
              <b>Draft revision {preview.revision}</b>
              <p className="muted">
                Preview only · reviewer approval still required
              </p>
              {preview.revision !== s.revision && (
                <p className="warn-text">
                  The assessment changed. Reload this preview before review.
                </p>
              )}
              <p>
                {preview.ledger_debits?.length ?? 0} bank-matched debit(s) ·{" "}
                {preview.unreported?.length ?? 0} additional candidate(s) ·{" "}
                {preview.evidence_only_debits?.length ?? 0} unmatched
                evidence-only debit(s)
              </p>
              {(preview.ledger_debits || []).map((d) => (
                <div className="insp-row" key={d.txn_id}>
                  <span className="mono">{d.txn_id}</span>
                  <b>{formatMinor(d.resolved_fields?.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
      {confirm && (
        <Modal
          title={
            "Confirm " +
            (confirm.kind === "urgent"
              ? "urgent referral approval"
              : "reviewer decision")
          }
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn ok"
                disabled={!current || !canReview}
                onClick={() => perform(decide)}
              >
                Approve revision {confirm.revision}
              </button>
            </>
          }
        >
          <p>{confirm.reason}</p>
          <p>
            Confirmed disputed: {formatMinor(view.amounts.confirmed)}.
            Candidates remain separate.
          </p>
          <p className="mono hash-text">
            r{confirm.revision} · {confirm.digest}
          </p>
          {!current && (
            <div className="banner crit">
              Assessment changed. Reopen the decision after reviewing current
              evidence.
            </div>
          )}
          <ErrorBanner error={action.error} />
        </Modal>
      )}
    </div>
  );
}
