import React, { useState } from "react";
import { Check, Sparkles, Search, Clock } from "lucide-react";
import { Card, CardH } from "./ui.jsx";
import { post } from "../api/client.js";
import { formatMinor, label } from "../models/caseView.js";
import { useSession } from "../state/resources.jsx";

// The "so what": the manual steps a fraud analyst normally does one by one,
// each shown with what this system actually produced for this case.
export function WorkDone({ view }) {
  const s = view.snapshot;
  const positions = s.trail?.positions || [];
  const sum = (status) =>
    positions
      .filter((p) => p.status === status)
      .reduce((n, p) => n + (p.amount_minor || 0), 0);
  const banks = new Set(positions.map((p) => p.account)).size;
  const rows = [
    [
      "Read the customer's story and receipt, retype the facts",
      `${s.claims.length} facts extracted, each linked to its source line`,
    ],
    [
      "Search core banking for the disputed debit",
      `${s.ledger_matches.length} debit confirmed in our ledger · ${formatMinor(
        view.amounts.confirmed,
      )}`,
    ],
    [
      "Check for other suspicious debits",
      s.unreported.length
        ? `${s.unreported.length} more debit to confirm · ${formatMinor(view.amounts.candidate)}`
        : "No other suspicious debit",
    ],
    [
      "Chase receiving banks to trace the money",
      positions.length
        ? `${banks} account${banks === 1 ? "" : "s"} traced · ${formatMinor(sum("recoverable"))} still in accounts · ${formatMinor(
            sum("left_system"),
          )} left the banking system`
        : "Waiting for receiving-bank reports",
    ],
    [
      "Look for repeat complaints about the same scammer",
      s.linked.length
        ? `${s.linked.length} linked complaint(s) found`
        : "No linked complaint in the last 72 hours",
    ],
    [
      "Work out what is still missing and phone the customer",
      s.readiness.unresolved_facts.length
        ? `Missing: ${s.readiness.unresolved_facts.map(label).join(", ")}`
        : "Nothing missing",
    ],
  ];
  return (
    <Card className="work-done">
      <CardH
        title="What was done for the analyst"
        sub="Steps an analyst normally works through by hand, one system at a time"
        icon={<Clock size={16} />}
        tour="work-done"
      />
      <div className="card-b">
        <table className="work-table">
          <thead>
            <tr>
              <th>By hand</th>
              <th>Done automatically for this case</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([manual, auto]) => (
              <tr key={manual}>
                <td>{manual}</td>
                <td>
                  <Check size={13} /> {auto}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          The analyst still decides, and a reviewer still approves.
        </p>
      </div>
    </Card>
  );
}

const TOOL_TEXT = {
  lookup_transactions: "Looked up the customer's transactions in our ledger",
  find_linked_complaints: "Searched other complaints for",
  trace_money: "Traced the money through receiving-bank reports",
  check_bank_records: "Checked that our bank records are current",
};

export function GeminiInvestigator({ caseId }) {
  const { persona } = useSession() || {};
  const [state, setState] = useState(null);
  const run = () => {
    setState({ loading: true });
    post(`/v1/cases/${caseId}/genai/investigate`, undefined, persona)
      .then((data) => setState({ data }))
      .catch(() => setState({ data: { available: false } }));
  };
  const data = state?.data;
  return (
    <Card className="gemini-card">
      <CardH
        title="Gemini investigator"
        sub="An AI agent decides which read-only checks to run, runs them, and reports what it found"
        icon={<Search size={16} />}
        tour="gemini-investigator"
      >
        {!state?.loading && (
          <button className="btn sm" onClick={run}>
            <Sparkles size={13} /> {data ? "Run again" : "Investigate with Gemini"}
          </button>
        )}
      </CardH>
      <div className="card-b col gap12">
        {!state && (
          <p className="muted">
            Gemini chooses its own lookups: ledger, linked complaints, money trail
            and bank-record freshness. It cannot change the case.
          </p>
        )}
        {state?.loading && <p className="muted">Gemini is investigating…</p>}
        {data && !data.available && (
          <p className="muted">The investigator is unavailable right now.</p>
        )}
        {data?.available && (
          <>
            <ol className="agent-steps">
              {data.steps.map((step) => (
                <li key={step.id}>
                  <span className="gemini-cite mono">{step.id}</span>{" "}
                  <b>
                    {TOOL_TEXT[step.tool] || step.tool}
                    {step.args?.value ? ` ${step.args.value}` : ""}
                  </b>
                  <details>
                    <summary>
                      {step.output.length} result{step.output.length === 1 ? "" : "s"}
                    </summary>
                    <ul>
                      {step.output.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ol>
            <b>Findings</b>
            <ul className="gemini-sentences">
              {data.findings.map((f, i) => (
                <li key={i}>
                  {f.text}{" "}
                  {f.source_ids.map((id) => (
                    <span key={id} className="gemini-cite mono">
                      {id}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {data.next_step && (
              <p>
                <b>Suggested next step:</b> {data.next_step.text}
              </p>
            )}
            <p className="gemini-note">
              <Sparkles size={12} /> {data.steps.length} tool calls chosen by Gemini ·
              each finding checked against the step it cites
              {data.dropped_unverified > 0 &&
                ` · ${data.dropped_unverified} unverifiable finding(s) removed`}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
