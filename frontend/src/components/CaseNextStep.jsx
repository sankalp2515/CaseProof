import React from "react";
import { ArrowRight, ShieldCheck, Clock } from "lucide-react";
import { useSession } from "../state/resources.jsx";
import { auth } from "../api/auth.js";
import { staffJourney } from "../models/staffJourney.js";
import { go } from "../router.js";

export default function CaseNextStep({ view, stale, reload, tab }) {
  const { persona, setPersona } = useSession();
  const next = staffJourney(view, stale);
  const switching = auth.personas && persona === "analyst" && next.reviewer;
  const urgentOnly =
    view.workflow.urgent_referral?.eligible &&
    !next.reviewer &&
    !["processing", "failed", "stale", "followup", "bank"].includes(next.phase);
  return (
    <section
      className={"case-next-step phase-" + next.phase}
      aria-label="Case next action"
      data-tour="case-next-action"
    >
      <div className="case-next-icon">
        {next.reviewer ? <ShieldCheck size={22} /> : <Clock size={22} />}
      </div>
      <div className="grow">
        <span className="case-next-owner" data-tour="next-best-step">
          {auth.personas
            ? next.reviewer
              ? "Reviewer action"
              : next.phase === "followup"
                ? "Follow-up action"
                : "Analyst action"
            : "Next action"}
        </span>
        <h2>{next.title}</h2>
        <details className="next-action-detail">
          <summary>Why this next step</summary>
          <p>{next.detail}</p>
        </details>
        {urgentOnly && (
          <p className="urgent-review-note">
            <button
              className="linklike"
              onClick={() => {
                if (auth.personas && persona === "analyst")
                  setPersona("reviewer");
                go(`/staff/cases/${view.identity.caseId}/review`);
              }}
            >
              {auth.personas && persona === "analyst"
                ? "Continue as reviewer for urgent referral"
                : "Inspect urgent referral"}
            </button>
            <span>Full handoff still has gaps.</span>
          </p>
        )}
      </div>
      {(switching || next.target !== tab) && (
        <button
          className="btn primary"
          onClick={() => {
            if (next.target === "refresh") return reload();
            if (switching) setPersona("reviewer");
            go(`/staff/cases/${view.identity.caseId}/${next.target}`);
          }}
        >
          {switching
            ? "Continue as reviewer demo"
            : next.target === "refresh"
              ? "Refresh case"
              : next.target === "review"
                ? "Open reviewer decision"
                : next.target === "delivery"
                  ? "Open delivery & follow-up"
                  : next.target === "requests"
                    ? "Open customer requests"
                    : "Inspect evidence"}
          <ArrowRight size={14} />
        </button>
      )}
    </section>
  );
}
