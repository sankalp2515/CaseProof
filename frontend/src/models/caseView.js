export function formatMinor(value) {
  if (value == null) return "—";
  if (!Number.isSafeInteger(value)) throw new Error("Unsupported money value");
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}₹${new Intl.NumberFormat("en-IN").format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function remaining(minutes) {
  if (minutes == null) return "Unknown";
  const seconds = Math.max(0, Math.floor(minutes * 60));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function remainingAt(clock, now = Date.now()) {
  if (clock?.golden_hour_remaining == null) return null;
  if (clock.replay) return clock.golden_hour_remaining;
  const sampled = Date.parse(clock.as_of);
  return Number.isFinite(sampled)
    ? Math.max(
        0,
        clock.golden_hour_remaining - Math.max(0, now - sampled) / 60000,
      )
    : null;
}
export const time = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Calcutta",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(value)) + " IST"
    : "Unknown time";
// Plain-language names for internal codes; judges and analysts read these.
const PLAIN = {
  REVIEW_REQUIRED: "Needs analyst review",
  COMPLETE_CANDIDATE: "Ready for reviewer sign-off",
  ESCALATE_CANDIDATE: "Escalate now",
  needs_attention: "Needs attention",
  needs_analysis: "Needs analysis",
  ready_for_review: "Ready for review",
  processing: "Processing",
  queued: "Queued",
  running: "Processing",
  done: "Assessed",
  failed: "Needs retry",
  approved: "Approved",
  delivered: "Delivered",
  amount: "Amount",
  currency: "Currency",
  date: "Payment date",
  txn_datetime: "Payment time",
  payee_vpa: "Payee UPI ID",
  transaction_reference: "Transaction reference (UTR)",
  receipt_association: "Match the receipt to the selected bank payment",
  ledger_coverage: "Bank records up to date",
  bank_verified: "Confirmed in bank records",
  deception_account: "How the scam happened",
  all_transfers_accounted: "Every disputed transfer accounted for",
  readable_receipt: "Readable payment receipt",
  confirmed_disputed: "Confirmed disputed",
  awaiting_confirmation: "Awaiting customer confirmation",
  source_supported: "Seen on evidence",
  reported: "Reported by customer",
  conflicted: "Conflicting",
  unresolved: "Unresolved",
  own_bank: "Our bank records",
  downstream_bank: "Receiving bank report",
  victim: "Customer",
  human_decision: "Reviewer decision",
  recoverable: "Still in an account",
  left_system: "Left the banking system",
  unaccounted: "Not yet traced",
  customer_statement: "Customer statement",
  scam_instruction: "Scammer's instruction",
  caller_number: "Caller number",
  caller_claimed_identity: "Caller claimed to be",
  deception_channel: "Contact channel",
  embedded_instruction: "Suspicious instruction in evidence",
  bank_website: "Bank website",
  fraud_analyst: "Fraud analyst",
  bank_data_operations: "Bank data team",
  reviewer: "Reviewer",
};
export const label = (value) =>
  PLAIN[value] ??
  String(value ?? "Unknown")
    .replaceAll("_", " ")
    .toLowerCase();
export function makeCaseView(snapshot, workflow) {
  if (
    snapshot.case_id !== workflow.case_id ||
    snapshot.revision !== workflow.revision ||
    snapshot.digest !== workflow.digest
  )
    throw new Error("Updating assessment");
  return {
    snapshot,
    workflow,
    identity: {
      caseId: snapshot.case_id,
      revision: snapshot.revision,
      digest: snapshot.digest,
    },
    amounts: {
      confirmed: workflow.confirmed_disputed_minor ?? 0,
      candidate: workflow.additional_candidate_minor ?? 0,
    },
    mutable:
      !workflow.bank_data_refresh_required &&
      !["processing", "failed", "needs_analysis"].includes(workflow.status),
  };
}
