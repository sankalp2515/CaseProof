import React from "react";
import { Clock, ArrowRight, Sparkles, Info } from "lucide-react";
import {
  Card,
  CardH,
  Ring,
  Badge,
  Status,
  ErrorBanner,
  Empty,
} from "../components/live.jsx";
import { formatMinor, time, remaining, label } from "../models/caseView.js";
import {
  useSession,
  useResource,
  useDisplayClock,
} from "../state/resources.jsx";
import { apiRequest } from "../api/client.js";
import { go } from "../router.js";
import Evidence from "./case/LiveEvidence.jsx";
import MoneyTrail from "./case/LiveTrail.jsx";
import Requests from "./case/LiveRequests.jsx";
import Review from "./case/LiveReview.jsx";
import Delivery from "./case/LiveDelivery.jsx";
import CaseNextStep from "../components/CaseNextStep.jsx";
import { GeminiSummary } from "../components/Gemini.jsx";
import { WorkDone, GeminiInvestigator } from "../components/AnalystWork.jsx";

export default function CasePages({ view, tab, stale, reload }) {
  const props = { view, reload, stale };
  return (
    <>
      <div className={tab === "overview" ? "case-priority-row" : undefined}>
        {tab === "overview" && <GoldenHour view={view} />}
        <CaseNextStep view={view} stale={stale} reload={reload} tab={tab} />
      </div>
      {view.workflow.bank_data_refresh_required && (
        <div className="banner warn">
          <Clock size={16} />
          Bank observations need refresh. Observed availability is time-bound;
          unsupported sends remain blocked.
        </div>
      )}
      {tab === "overview" ? (
        <Overview {...props} />
      ) : tab === "evidence" ? (
        <Evidence {...props} />
      ) : tab === "trail" ? (
        <MoneyTrail {...props} />
      ) : tab === "requests" ? (
        <Requests {...props} />
      ) : tab === "review" ? (
        <Review {...props} />
      ) : tab === "delivery" ? (
        <Delivery {...props} />
      ) : tab === "audit" ? (
        <Audit {...props} />
      ) : (
        <Empty>Section unavailable.</Empty>
      )}
    </>
  );
}
function GoldenHour({ view }) {
  const clock = view.workflow.clock;
  const countdown = useDisplayClock(clock);
  return (
    <Card className="case-golden-hour">
      <CardH title="Golden-hour priority" icon={<Clock size={16} />} />
      <div className="card-b golden-hour-body">
        <Ring value={(countdown ?? 0) / 60} size={72}>
          <strong className="mono">{remaining(countdown)}</strong>
        </Ring>
        <div>
          <div className="eyebrow">Response window</div>
          <p>{clock?.replay ? "Labelled replay" : "Demo clock · IST"}</p>
          <small>Response urgency, not a recovery deadline</small>
        </div>
      </div>
    </Card>
  );
}
function Overview({ view }) {
  const { snapshot: s, workflow: w } = view;
  const brief = w.brief || {};
  const to = (section) => go(`/staff/cases/${s.case_id}/${section}`);
  // Display identical statements once; all original claims remain in Evidence.
  const statements = [
    ...new Map(
      (brief.victim_statements || []).map((c) => [
        c.kind + ":" + String(c.value),
        c,
      ]),
    ).values(),
  ];
  return (
    <>
      <div className="analyst-overview-top">
        <div className="col gap16">
          <Card className="ai-frame overview-brief">
            <CardH
              title="Investigation brief"
              icon={<Sparkles size={17} />}
              sub={"Supported findings · version " + s.revision}
            >
              <Badge tone="ai">Advisory</Badge>
            </CardH>
            <div className="card-b">
              <p className="brief-summary">
                {brief.summary ||
                  "The current assessment is still being prepared. Inspect processing before acting."}
              </p>
              <details className="reported-details">
                <summary>
                  What the customer reported · {statements.length} details
                </summary>
                {statements.map((c) => (
                  <div className="statement" key={c.claim_id}>
                    <span>
                      {c.kind === "amount"
                        ? formatMinor(c.value)
                        : String(c.value ?? "Unknown")}
                    </span>{" "}
                    <Status value={c.state} />
                    <button
                      className="chip-cite"
                      onClick={() =>
                        to(
                          "evidence?source=" +
                            encodeURIComponent(
                              c.sources?.[0]?.segment_id || "",
                            ),
                        )
                      }
                    >
                      Inspect source
                    </button>
                  </div>
                ))}
              </details>
              <p className="brief-limitations">
                <Info size={13} />
                {brief.limitations ||
                  "Advisory assessment. Observed funds are not a confirmed hold or recovery."}
              </p>
            </div>
          </Card>
          {(brief.conflicts?.length > 0 || brief.unknowns?.length > 0) && (
            <Card className="card-b" data-tour="unresolved-matters">
              <h3>Still to resolve</h3>
              {(brief.unknowns || []).map((x, i) => (
                <p key={i}>
                  {typeof x === "string"
                    ? {
                        all_transfers_accounted:
                          "Confirm which payments belong in the complaint.",
                        deception_account:
                          "Clarify how the customer was persuaded to pay.",
                        ledger_coverage:
                          "Current bank records are still needed.",
                        readable_receipt:
                          "A readable payment source is still needed.",
                        transaction_reference:
                          "The transaction reference is not yet established.",
                      }[x] || "Not yet established: " + label(x)
                    : "Inspect this unresolved item in Evidence."}
                </p>
              ))}
              {brief.conflicts?.length > 0 && (
                <Badge tone="crit">
                  {brief.conflicts.length} conflicting claims
                </Badge>
              )}
            </Card>
          )}
        </div>
        <div className="col gap16">
          <Card>
            <CardH
              title="Payment inventory"
              sub="Disputed payments and candidates remain distinct"
            />
            <div className="card-b">
              <div className="tl">
                {(brief.payments || []).map((p) => (
                  <div
                    className={
                      "tl-item " +
                      (p.status === "confirmed_disputed" ? "crit" : "")
                    }
                    key={p.txn_id}
                  >
                    <span className="dot" />
                    <div className="muted mono">{time(p.at)}</div>
                    <div
                      className={
                        "debit-card " +
                        (p.status === "confirmed_disputed" ? "urgent" : "")
                      }
                    >
                      <div className="row gap8 wrap">
                        <b>{label(p.status)}</b>
                        <b className="right num">
                          {formatMinor(p.amount_minor)}
                        </b>
                      </div>
                      <p className="mono">{p.payee || p.txn_id}</p>
                      <div className="muted mono">
                        {p.reference || "Reference unknown"}
                      </div>
                      <Badge tone="outline">{label(p.source_category)}</Badge>
                    </div>
                  </div>
                ))}
                {!brief.payments?.length && (
                  <Empty>
                    No bank-matched disputed payment yet. Uncertain evidence
                    remains visible for review.
                  </Empty>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
      <details className="overview-chronology analyst-methods">
        <summary>
          Source chronology · {(brief.chronology || []).length} events
        </summary>
        {(brief.chronology || []).map((e, i) => (
          <div className="chronology" key={i}>
            <span className="mono muted">{time(e.at)}</span>
            <b>{e.event}</b>
            <small className="muted">
              {label(e.source_category)} · {e.source_id}
            </small>
          </div>
        ))}
      </details>
      <section className="analyst-assistance" aria-label="AI assistance">
        <h2>Additional investigation tools</h2>
        <p className="muted">
          Use source-checked summaries and on-demand investigation after
          reviewing the case and bank match. These tools do not grant approval.
        </p>
        <div className="g2">
          <GeminiSummary caseId={s.case_id} revision={s.revision} />
          <GeminiInvestigator caseId={s.case_id} />
        </div>
      </section>
      <details className="analyst-methods">
        <summary>How this assessment was assembled</summary>
        <WorkDone view={view} />
        <Card>
          <CardH
            title="Actual processing"
            sub="Provider metadata, not a confidence score"
          />
          <div className="card-b">
            {(s.run_meta || []).length ? (
              (s.run_meta || []).slice(-2).map((r, i) => (
                <div className="insp-row" key={i}>
                  <span>
                    {r.provider} · {r.mode}
                  </span>
                  <span className="mono">{r.model_id}</span>
                </div>
              ))
            ) : (
              <p className="muted">
                Processing metadata will appear after assessment.
              </p>
            )}
            {w.job && (
              <div className="insp-row">
                <span>Current job</span>
                <Status value={w.job.status} />
              </div>
            )}
            <p className="muted">
              Processing providers for this assessment are listed above. Each
              extracted fact remains linked to its source.
            </p>
          </div>
        </Card>
      </details>
    </>
  );
}

function Audit({ view }) {
  const { persona } = useSession(),
    id = view.identity.caseId;
  const resource = useResource("audit:" + id + ":" + persona, (s) =>
    Promise.all(
      ["audit", "approvals", "urgent-referrals"].map((p) =>
        apiRequest(`/v1/cases/${id}/${p}`, { persona, signal: s }),
      ),
    ),
  );
  const [events, approvals, urgent] = resource.data || [[], [], []];
  return (
    <div className="g2">
      <Card>
        <CardH
          title="Audit chronology"
          sub="Persisted backend events · originals and decisions retained"
        />
        <div className="card-b">
          <ErrorBanner error={resource.error} />
          {[...events].reverse().map((e, i) => (
            <div key={i} className="chronology">
              <span className="mono muted">
                r{e.revision} · {time(e.at)}
              </span>
              <b>{label(e.event)}</b>
            </div>
          ))}
        </div>
      </Card>
      <div className="col gap12">
        <Card>
          <CardH
            title="Approval history"
            sub="Historical approvals do not authorise current content"
          />
          <div className="card-b">
            {approvals.length ? (
              approvals.map((a) => (
                <div className="statement" key={a.approval_id}>
                  <b>
                    Revision {a.revision} · {label(a.disposition)}
                  </b>
                  <p>{a.reason}</p>
                  <small className="mono muted">
                    {a.reviewer?.user_id} · {time(a.at)} ·{" "}
                    {a.digest?.slice(0, 16)}
                  </small>
                </div>
              ))
            ) : (
              <Empty>No complete handoff approval recorded.</Empty>
            )}
          </div>
        </Card>
        <Card className="card-b">
          <h3>Urgent referral history</h3>
          {urgent.length ? (
            urgent.map((r, i) => (
              <div className="statement" key={r.referral_id || i}>
                <b>
                  Revision {r.revision} ·{" "}
                  {label(r.status || r.disposition || "recorded")}
                </b>
                {r.reason && <p>{r.reason}</p>}
                <details>
                  <summary>Referral record</summary>
                  <pre className="safe-json">{JSON.stringify(r, null, 2)}</pre>
                </details>
              </div>
            ))
          ) : (
            <Empty>No urgent referrals recorded.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
