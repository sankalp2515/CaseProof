// Presentation of server-owned workflow state. Never computes approval eligibility.
export function staffJourney(view, stale = false) {
  const w = view.workflow,
    s = view.snapshot;
  const requests = s.requests || [];
  if (stale)
    return {
      phase: "stale",
      title: "Refresh before taking action",
      detail:
        "The latest case could not be loaded. Changes and approvals stay blocked until it is refreshed.",
      target: "refresh",
    };
  if (w.job?.status === "failed")
    return {
      phase: "failed",
      title: "Evidence processing needs attention",
      detail:
        "Inspect the processing error and retry the supported failed job in Evidence.",
      target: "evidence",
    };
  if (
    w.status === "processing" ||
    ["queued", "running"].includes(w.job?.status)
  )
    return {
      phase: "processing",
      title: "Assessment is in progress",
      detail:
        "A background assessment is processing evidence or refreshed bank records. Wait for the current version before correcting facts, sending requests or approving.",
      target: "evidence",
    };
  const kinds = new Set(
    (w.deliveries || []).filter((d) => d.status === "sent").map((d) => d.kind),
  );
  if (
    w.status === "completed" &&
    ["cfcfrms_report_update", "case_ticket"].every((k) => kinds.has(k))
  )
    return {
      phase: "followup",
      title: "Reports delivered — follow-up remains open",
      detail:
        "Both receivers acknowledged. Confirm the owner and next action; delivery does not establish a freeze, refund or closed investigation.",
      target: "delivery",
    };
  if (
    w.approval &&
    w.approval.revision === s.revision &&
    w.approval.digest === s.digest
  )
    return {
      phase: "delivery",
      title: "Reviewer approval recorded",
      detail:
        "Send this approved version and verify both receiver acknowledgements. A queued send is not delivery.",
      target: "delivery",
      reviewer: true,
    };
  if (w.bank_data_refresh_required)
    return {
      phase: "bank",
      title: "Waiting for current bank records",
      detail:
        "Background services are refreshing bank observations. Do not ask the customer for records their bank must supply.",
      target: "refresh",
    };
  if (["COMPLETE_CANDIDATE", "ESCALATE_CANDIDATE"].includes(w.readiness))
    return {
      phase: "review",
      title:
        w.readiness === "ESCALATE_CANDIDATE"
          ? "Reviewer decision needed: escalation with gaps"
          : "Ready for independent reviewer sign-off",
      detail:
        "The server permits review of this version. The reviewer must inspect the evidence, limitations and report, then record a reason. Readiness is not approval.",
      target: "review",
      reviewer: true,
    };
  if (requests.some((r) => r.state === "proposed"))
    return {
      phase: "request",
      title: "Clarify the unresolved customer information",
      detail:
        "Review the server-proposed question and its purpose in Requests. Send only what is needed for the next decision.",
      target: "requests",
    };
  if (w.status === "awaiting_information")
    return {
      phase: "waiting",
      title: "Awaiting the customer’s reply",
      detail:
        "The request has been sent. Avoid sending it again; the reply will trigger a new assessment. Urgent referral eligibility is checked separately.",
      target: "requests",
    };
  if (w.unresolved?.includes("receipt_association"))
    return {
      phase: "receipt",
      title: "The receipt is not yet matched to the bank payment",
      detail:
        "Compare the original amount, time and payee with the separate bank match. A misread character or unrelated receipt must be resolved; the bank debit alone does not establish what the uploaded receipt supports.",
      target: "evidence",
    };
  return {
    phase: "investigate",
    title: "Check the evidence and bank match",
    detail:
      "Compare each extracted detail with its original source, inspect conflicts and follow the bank-reported money trail.",
    target: "evidence",
  };
}
