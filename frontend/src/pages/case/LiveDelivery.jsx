import { canRequestRole } from "../../api/auth.js";
import PacketDocument from "./PacketDocument.jsx";
import React, { useState } from "react";
import { Send, FileJson, ArrowDownToLine, Clock } from "lucide-react";
import {
  Card,
  CardH,
  Badge,
  Status,
  ErrorBanner,
  Empty,
  Modal,
} from "../../components/live.jsx";
import { apiRequest, post, loadCaseView } from "../../api/client.js";
import { useAction, useSession, useResource } from "../../state/resources.jsx";
import { label, time } from "../../models/caseView.js";

export default function Delivery({ view, reload, stale }) {
  const { persona } = useSession(),
    action = useAction(reload),
    { snapshot: s, workflow: w } = view,
    root = `/v1/cases/${s.case_id}`;
  const [confirm, setConfirm] = useState(null),
    [packet, setPacket] = useState(null),
    [owner, setOwner] = useState(""),
    [next, setNext] = useState(""),
    [reason, setReason] = useState(""),
    [due, setDue] = useState(""),
    [state, setState] = useState("awaiting_external");
  const history = useResource(
    "urgent:" + s.case_id + persona,
    (signal) => apiRequest(root + "/urgent-referrals", { persona, signal }),
    10000,
  );
  const run = (fn) => action.run(fn).catch(() => {});
  async function downloadBrief() {
    const response = await apiRequest(root + "/brief", { persona, raw: true });
    download(await response.blob(), s.case_id + "-brief.txt");
  }
  const delivered = w.status === "completed";
  return (
    <div className="g2">
      <div className="col gap12">
        <Card>
          <CardH
            title="Report delivery"
            sub="Two destinations · durable intents · simulated transport"
          />
          <div className="card-b">
            <ErrorBanner error={action.error} />
            {["cfcfrms_report_update", "case_ticket"].map((kind) => {
              const current = w.deliveries?.find((x) => x.kind === kind);
              const previous = (w.historical_deliveries || [])
                .filter((x) => x.kind === kind)
                .sort((a, b) => b.revision - a.revision)[0];
              const d =
                current || (previous ? { ...previous, status: "sent" } : null);
              return (
                <div className="delivery-row" key={kind}>
                  <span className="entry-icon">
                    <FileJson size={18} />
                  </span>
                  <div className="grow">
                    <b>
                      {kind === "case_ticket"
                        ? "Bank case-system simulator"
                        : "CFCFRMS report-update simulator"}
                    </b>
                    <p className="muted">
                      {!current && previous
                        ? `Delivered revision ${previous.revision}; current revision ${s.revision} needs its own review`
                        : d?.response
                          ? "Receiver response recorded"
                          : "Awaiting an acknowledged approved report"}
                    </p>
                  </div>
                  <Status value={d?.status || "not_sent"} />
                </div>
              );
            })}
            {w.delivery_failures?.map((d, i) => (
              <div className="banner warn" key={i}>
                {label(d.kind)}: {label(d.status)}. Restore the receiver before
                retrying the current approved report.
              </div>
            ))}
            {delivered ? (
              <div className="banner ok">
                Reports delivered · investigation remains open for external
                follow-up.
              </div>
            ) : (
              <button
                className="btn primary full"
                disabled={
                  !canRequestRole(persona, "reviewer") ||
                  !w.approval ||
                  ["queued", "running", "failed"].includes(w.job?.status) ||
                  w.bank_data_refresh_required ||
                  stale ||
                  action.busy
                }
                onClick={() =>
                  setConfirm({ revision: s.revision, digest: s.digest })
                }
              >
                <Send size={14} />
                {w.deliveries?.length
                  ? "Reconcile / retry approved delivery"
                  : "Review & send approved reports"}
              </button>
            )}
            <p className="muted">
              Acknowledgement does not mean money is held, frozen or refunded.
            </p>
            <button className="btn" onClick={() => run(downloadBrief)}>
              <ArrowDownToLine size={14} />
              Download readable brief
            </button>
          </div>
        </Card>
        <Card>
          <CardH
            title="Delivered packet history"
            sub="Original approved content, even after reassessment"
          />
          <div className="card-b">
            {(w.historical_deliveries || [])
              .filter((d) => d.packet_id)
              .map((d, i) => (
                <div className="statement" key={i}>
                  <b>
                    Revision {d.revision} · {d.packet_id}
                  </b>
                  <div className="row gap8 wrap">
                    <button
                      className="btn sm"
                      onClick={() =>
                        run(async () =>
                          setPacket(
                            await apiRequest(
                              root +
                                "/delivered-packets/" +
                                encodeURIComponent(d.packet_id),
                              { persona },
                            ),
                          ),
                        )
                      }
                    >
                      View delivered report
                    </button>
                    <button
                      className="btn sm"
                      onClick={() =>
                        run(async () => {
                          const data = await apiRequest(
                            root +
                              "/delivered-packets/" +
                              encodeURIComponent(d.packet_id),
                            { persona },
                          );
                          download(
                            new Blob([JSON.stringify(data, null, 2)], {
                              type: "application/json",
                            }),
                            d.packet_id + ".json",
                          );
                        })
                      }
                    >
                      Download JSON
                    </button>
                    <button
                      className="btn sm"
                      onClick={() =>
                        run(async () => {
                          const response = await apiRequest(
                            root +
                              "/delivered-packets/" +
                              encodeURIComponent(d.packet_id) +
                              "/document",
                            { persona, raw: true },
                          );
                          download(
                            await response.blob(),
                            d.packet_id + ".html",
                          );
                        })
                      }
                    >
                      Download handoff document
                    </button>
                  </div>
                </div>
              ))}
            {!w.historical_deliveries?.length && (
              <Empty>No historical delivery acknowledgement yet.</Empty>
            )}
            {packet && <PacketDocument packet={packet} />}
          </div>
        </Card>
        <Card>
          <CardH
            title="Urgent referral history"
            sub="Earlier scoped approvals and receipts remain inspectable"
          />
          <div className="card-b">
            <ErrorBanner error={history.error} />
            {!history.data?.length && (
              <Empty>No urgent referrals recorded.</Empty>
            )}
            {(history.data || []).map((item) => (
              <div className="statement" key={item.approval.approval_id}>
                <b>
                  Revision {item.approval.revision} ·{" "}
                  {item.approval.approval_id}
                </b>
                <p>{item.approval.reason}</p>
                <Status value={item.delivery?.status || "approved"} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <CardH
          title="Owner and next action"
          icon={<Clock size={16} />}
          sub="Delivery is a handoff, not investigation closure"
        />
        <div className="card-b">
          <div className="bound">
            <p>Current owner: {w.followup?.owner || "Unassigned"}</p>
            <p>
              {w.followup?.next_action ||
                "Assign the next supported follow-up action."}
            </p>
            <small>Assignment version {w.followup?.version ?? 0}</small>
          </div>
          <label>
            Owner
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Assigned analyst or team"
              maxLength={120}
            />
          </label>
          <label>
            Next action
            <textarea
              value={next}
              onChange={(e) => setNext(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Follow-up state
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="awaiting_external">
                Awaiting external follow-up
              </option>
              <option value="open">Open</option>
            </select>
          </label>
          <label>
            Due time (your local time, optional)
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label>
            Assignment reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </label>
          <button
            className="btn primary"
            disabled={
              !canRequestRole(persona, "analyst") ||
              !owner.trim() ||
              !next.trim() ||
              !reason.trim() ||
              action.busy ||
              stale
            }
            onClick={() =>
              run(() =>
                post(
                  root + "/followup",
                  {
                    expected_revision: s.revision,
                    expected_version: w.followup?.version ?? 0,
                    owner,
                    next_action: next,
                    reason,
                    state,
                    due_at: due ? new Date(due).toISOString() : null,
                  },
                  persona,
                ),
              )
            }
          >
            Save follow-up
          </button>
          <details>
            <summary>Assignment history</summary>
            {!w.followup?.history?.length && (
              <Empty>No assignments recorded yet.</Empty>
            )}
            {(w.followup?.history || []).map((item) => (
              <div className="statement" key={item.version}>
                <b>
                  {item.owner} · {label(item.state)}
                </b>
                <p>{item.next_action}</p>
                <p className="muted">{item.reason}</p>
                <small>
                  Version {item.version} · {time(item.at)}
                  {item.due_at ? ` · Due ${time(item.due_at)}` : ""}
                </small>
              </div>
            ))}
          </details>
        </div>
      </Card>
      {confirm && (
        <Modal
          title="Send approved reports to local simulators?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={
                  action.busy ||
                  stale ||
                  !canRequestRole(persona, "reviewer") ||
                  ["queued", "running", "failed"].includes(w.job?.status) ||
                  confirm.revision !== s.revision ||
                  confirm.digest !== s.digest
                }
                onClick={() =>
                  run(async () => {
                    const fresh = await loadCaseView(s.case_id, { persona });
                    if (
                      fresh.identity.digest !== confirm.digest ||
                      fresh.identity.revision !== confirm.revision ||
                      !fresh.workflow.approval
                    )
                      throw new Error(
                        "Assessment changed. Review the new revision.",
                      );
                    await post(root + "/exports", undefined, persona);
                    setConfirm(null);
                  })
                }
              >
                Confirm send
              </button>
            </>
          }
        >
          <p>
            Send the exact approved financial content from revision{" "}
            {confirm.revision} to both local destinations. Existing receiver
            keys prevent duplicate successful delivery.
          </p>
          <ErrorBanner error={action.error} />
          {confirm.digest !== s.digest && (
            <div className="banner crit">
              Assessment changed. Close and review current state.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
