// Guided demo tour: one synthetic "golden hour" scam, from the victim's report to
// the fraud desk's accountable handoff. Self-explanatory controls (search, refresh,
// navigation links) are deliberately left out.
//
// Step fields:
//   go       route to open when the step starts (string or (ctx) => string)
//   target   CSS selector to spotlight; omitted = centred card
//   optional the panel only exists in some case states; `absent` explains when
//   action   what the visitor should do themselves on this step
//   advance  {route: RegExp} or {selector: string}: auto-advance once it happens
//   example  text the visitor can insert into the narrative field

export const EXAMPLE_NARRATIVE =
  "Shortly before the selected payment, a man called saying he was from Cedar Bank's fraud team. " +
  "He said my account was compromised and told me to move my money to a safe account " +
  "he gave me. I made the payment while he stayed on the call. Afterwards he stopped " +
  "answering. I did not share any OTP or PIN.";

const caseTab = (tab) => (ctx) => `/staff/cases/${ctx.caseId}/${tab}`;
const at = (name) => `[data-tour="${name}"]`;

export const CHAPTERS = {
  intro: "The golden hour",
  victim: "Victim reports",
  desk: "Fraud desk",
  overview: "Case overview",
  evidence: "Evidence",
  trail: "Money trail",
  requests: "Requests",
  review: "Review & decision",
  delivery: "Delivery & follow-up",
  audit: "Audit",
};

const ALL_STEPS = [
  {
    id: "intro",
    chapter: "intro",
    go: null,
    title: "Welcome: the golden hour",
    body: [
      'It is 10:02. A caller posing as Cedar Bank\'s fraud team persuades a customer to move money to a "safe account". Minutes later the customer realises it was a scam.',
      "The first hour after a scam payment is often called the golden hour: the sooner a complete, evidence-backed report reaches the banks, the better the chance that money can still be held downstream. It is a priority signal, never a recovery promise.",
      "In about six minutes you will file that report as the customer, then follow it through the fraud desk. Every account, payment and destination here is synthetic.",
    ],
  },
  {
    id: "practice",
    chapter: "victim",
    go: "/victim/start",
    target: at("practice-session"),
    title: "Generate your own scam",
    body: [
      "Choose when the scam payment happened: 10 or 40 minutes ago is inside the golden hour, 2 hours ago has already missed it. A fresh fictional bank, customers, scam payment and onward money movements are generated now, only for you.",
    ],
    action: "Pick a timing, then click Start a fresh practice session.",
  },
  {
    id: "customer",
    chapter: "victim",
    target: at("choose-your-demo-customer"),
    title: "Become the customer",
    body: [
      "Customers marked with a suspicious payment are the scam victims; the first one is already selected. Other customers have only normal payments.",
    ],
    action: "Click Continue with selected customer.",
    advance: { route: /^\/victim\/home/ },
  },
  {
    id: "home",
    chapter: "victim",
    go: "/victim/home",
    target: at("report-scam"),
    title: "The customer's banking home",
    body: [
      "This is what the customer sees after signing in: their accounts and recent payments. Reporting starts from here, with no forms to find.",
    ],
    action: "Click Report a payment scam.",
    advance: { route: /^\/victim\/report/ },
  },
  {
    id: "payments",
    chapter: "victim",
    target: at("report-payments"),
    title: "Choose the scam payment",
    body: [
      "The scam payment of your scenario is highlighted in red. Select it. Other debits stay separate: a possibly related payment is never disputed automatically.",
    ],
    action: "Select the payment, then Continue.",
    advance: { selector: at("report-narrative") },
  },
  {
    id: "narrative",
    chapter: "victim",
    target: at("report-narrative"),
    title: "Say what happened, in plain words",
    body: [
      'The customer writes freely, in English, Hindi or Hinglish. Click "Check what my description is missing": Gemini asks, in the customer’s own language, only for the facts the bank still needs. Set how the payment was made to "I made the payment after being deceived".',
    ],
    example: true,
    action:
      "Write the account (or insert the example), choose the option, then Continue.",
    advance: { selector: at("report-evidence") },
  },
  {
    id: "evidence",
    chapter: "victim",
    target: at("report-evidence"),
    title: "Attach the bank receipt",
    body: [
      "Evidence is a real image, not a form field. Click View bank receipt to download the payment receipt, then upload that file with Report evidence. It is read by OCR and every fact keeps a link back to the exact line it came from.",
    ],
    action: "Download the receipt, upload it, then Continue.",
    advance: { selector: at("report-review") },
  },
  {
    id: "submit",
    chapter: "victim",
    target: at("report-review"),
    title: "Review and submit",
    body: [
      "Submitting registers the complaint immediately and starts assessment in the background. Evidence uploads separately, so a failed upload can be retried without creating a duplicate complaint.",
    ],
    action: "Click Submit report.",
    advance: { route: /^\/victim\/complaints\// },
  },
  {
    id: "registered",
    chapter: "victim",
    target: at("complaint-reference"),
    title: "Report registered",
    body: [
      "The customer gets a case reference and can return here for updates or to answer the fraud desk's questions. The new case has already arrived in the fraud desk queue. Let's switch sides.",
    ],
  },
  {
    id: "persona",
    chapter: "desk",
    go: "/staff/queue",
    target: at("persona"),
    title: "Fraud desk roles",
    body: [
      "The Analyst investigates and asks the customer for missing information. The Reviewer approves what leaves the bank. Switch roles here: these are labelled demo personas confined to your practice session, not a login.",
    ],
  },
  {
    id: "kpis",
    chapter: "desk",
    target: at("kpis"),
    title: "Command center signals",
    body: [
      "Confirmed disputed: only amounts matched to the bank's own ledger; possible extra debits are excluded.",
      "Golden-hour priority: cases still inside their window; each dot shows how much of the hour is left.",
      "Awaiting clarification: cases waiting for a customer's answer. Ready for review: cases a reviewer must decide.",
    ],
  },
  {
    id: "scope",
    chapter: "desk",
    target: at("workspace-scope"),
    title: "Scope and live updates",
    body: [
      "The queue shows your current practice session by default and refreshes every five seconds, so new complaints and status changes appear without reloading.",
    ],
  },
  {
    id: "queue",
    chapter: "desk",
    target: at("case-queue"),
    title: "The case queue",
    body: [
      "Cases are ordered by urgency. Your complaint shows Processing while OCR and checks run, then a status such as Awaiting information or Ready for review. Filters narrow the list by stage.",
    ],
    action: "Open your case, or press Next and the tour opens it.",
  },
  {
    id: "notifications",
    chapter: "desk",
    target: at("notifications"),
    title: "Arrival alerts",
    body: [
      "The bell counts newly arrived complaints and status changes since you opened the workspace, so nothing urgent is missed while you work on another case.",
    ],
  },
  {
    id: "header",
    chapter: "overview",
    go: caseTab("overview"),
    needsCase: true,
    target: at("case-header"),
    title: "The case at a glance",
    body: [
      "Case reference, current status, and the golden-hour badge showing how much of the response window remains. Below: the customer's account, how the report arrived, and the assessment revision (r) you are looking at.",
    ],
  },
  {
    id: "stats",
    chapter: "overview",
    target: at("case-stats"),
    title: "Amounts and snapshot",
    body: [
      "Confirmed disputed: payments the customer reported that match the bank ledger. Additional candidate: possibly related debits nobody has confirmed yet.",
      "Snapshot r·digest: the exact version of this case. Every approval binds to it, so a decision can never silently apply to newer, unreviewed content.",
    ],
  },
  {
    id: "tabs",
    chapter: "overview",
    target: at("case-tabs"),
    title: "Tabs follow the investigation",
    body: [
      "Left to right: understand the case, check the evidence, follow the money, ask for what is missing, decide, deliver, and audit. The tour visits each one.",
    ],
  },
  {
    id: "inventory",
    chapter: "overview",
    target: at("payment-inventory"),
    title: "Payment inventory",
    body: [
      "Every payment in the case with its source: reported by the customer, matched in the bank ledger, or only a candidate. Disputed payments and candidates are never merged.",
    ],
  },
  {
    id: "golden",
    chapter: "overview",
    target: at("golden-hour-priority"),
    title: "Golden-hour priority",
    body: [
      "How much of the one-hour response window remains since the first scam debit, with the amounts at stake. It decides how urgently to act, not whether money can be recovered.",
    ],
  },
  {
    id: "next",
    chapter: "overview",
    target: at("next-best-step"),
    title: "Next best step",
    body: [
      'One recommended action, computed from what is still missing and what the evidence already supports, for example "ask for a clearer receipt" or "ready for urgent referral".',
    ],
  },
  {
    id: "brief",
    chapter: "overview",
    target: at("investigation-brief"),
    title: "Investigation brief",
    body: [
      "A readable summary with a chronology and citations. Each statement points to its source (the customer's words, an OCR line, or a bank record), so the analyst can verify instead of trusting a summary.",
    ],
  },
  {
    id: "processing",
    chapter: "overview",
    target: at("actual-processing"),
    title: "Actual processing",
    body: [
      "Which engine produced the facts and how long it took: Document AI and Gemini in the cloud, local OCR and literal rules offline. It is a provenance record, not a confidence score.",
    ],
  },
  {
    id: "unresolved",
    chapter: "overview",
    target: at("unresolved-matters"),
    optional: true,
    absent: "Shown when evidence conflicts or important details are unknown.",
    title: "Unresolved matters",
    body: [
      "Conflicts and unknowns, such as a receipt amount that disagrees with the ledger. They block a complete handoff until resolved or explicitly escalated.",
    ],
  },
  {
    id: "originals",
    chapter: "evidence",
    go: caseTab("evidence"),
    needsCase: true,
    target: at("evidence-originals"),
    title: "Evidence originals",
    body: [
      "The evidence exactly as the customer sent it, sealed so it cannot be altered. Turn on source boxes to see each line the OCR read, so every fact can be traced back to the image.",
      "Click Ask Gemini to read this image: Gemini lists the payee, amount and reference it sees, and each finding lights up its box on the image.",
    ],
  },
  {
    id: "additional",
    chapter: "evidence",
    target: at("additional-evidence"),
    title: "Additional evidence",
    body: [
      "The analyst can add material received by other channels. Adding creates a new case revision; the originals stay untouched.",
    ],
  },
  {
    id: "facts",
    chapter: "evidence",
    target: at("source-linked-facts"),
    title: "Source-linked facts",
    body: [
      'Each extracted fact (amount, time, payee) keeps three separate answers: what the customer said, whether a source supports it, and whether the bank verified it. A claim never becomes "verified" just because it was written down.',
    ],
  },
  {
    id: "matches",
    chapter: "evidence",
    target: at("own-bank-matches"),
    title: "Own-bank matches",
    body: [
      "The bank's own ledger records matched to the reported payments. This is the bank's data, kept separate from the customer's statements.",
    ],
  },
  {
    id: "graph",
    chapter: "trail",
    go: caseTab("trail"),
    needsCase: true,
    target: at("money-trail"),
    title: "Money trail",
    body: [
      "Where the money went after it left the customer: accounts are nodes, transfers are arrows, each with the time a bank observed it. Zoom and fit with the buttons; the replay slider shows the order in which money moved.",
    ],
  },
  {
    id: "legend",
    chapter: "trail",
    target: at("trail-legend"),
    title: "Reading the graph",
    body: [
      "Solid green arrows are transfers a bank actually reported; dashed orange ones mean availability is uncertain. The Follow buttons trace each scam debit on its own path.",
    ],
  },
  {
    id: "positions",
    chapter: "trail",
    target: at("trail-positions"),
    title: "Attributed positions",
    body: [
      "How much may still sit in downstream accounts at their last observation, how much is unaccounted for, and how much has left the system. These are observations, not confirmed holds or recoveries.",
    ],
  },
  {
    id: "inspector",
    chapter: "trail",
    target: at("trail-inspector"),
    title: "Account inspector",
    body: [
      "Select any account in the graph to see its bank, observed balance and how fresh that observation is. Stale data is flagged rather than presented as current.",
    ],
  },
  {
    id: "engine",
    chapter: "requests",
    go: caseTab("requests"),
    needsCase: true,
    target: at("request-engine"),
    title: "Request engine",
    body: [
      "Proposes questions only for real gaps, from an approved catalogue. The analyst reviews and sends one focused request; the customer receives a private, expiring link to answer it.",
    ],
    action:
      "If a question is proposed: Review & send → Confirm request → Open scoped reply, then submit the customer's answer. On the customer's report, explicitly confirm or exclude any additional payment. Return here and wait for reassessment. If nothing is missing, continue to review.",
  },
  {
    id: "why",
    chapter: "requests",
    target: at("why-this-request"),
    optional: true,
    absent: "Shown when a customer request is proposed or open.",
    title: "Why this request?",
    body: [
      "Explains which decision the answer would change. Questions that would not change the outcome are not asked, which keeps the burden on the customer low.",
    ],
  },
  {
    id: "bank",
    chapter: "requests",
    target: at("internal-bank-action"),
    title: "Internal bank action",
    body: [
      "Gaps the bank must close itself, such as refreshing ledger or downstream observations. Kept apart from questions to the customer, who should never be asked for what the bank already holds.",
    ],
  },
  {
    id: "readiness",
    chapter: "review",
    go: caseTab("review"),
    needsCase: true,
    target: at("readiness-assessment"),
    title: "Readiness assessment",
    body: [
      "A deterministic checklist of what is met and missing, separately for an urgent referral and for a complete handoff. Rules decide eligibility; no model confidence is involved.",
    ],
  },
  {
    id: "rationale",
    chapter: "review",
    target: at("reviewer-rationale"),
    title: "Reviewer rationale",
    body: [
      "Only the Reviewer persona can decide, and a written reason is required either way. Switch to Reviewer at the top right to try it.",
    ],
  },
  {
    id: "urgent",
    chapter: "review",
    target: at("urgent-transaction-referral"),
    title: "Urgent transaction referral",
    body: [
      "The golden-hour action: approve a scoped first referral for the supported payments now, before the full packet is complete, so downstream banks can act while it still matters.",
    ],
  },
  {
    id: "handoff",
    chapter: "review",
    target: at("complete-handoff-escalation"),
    title: "Complete handoff or escalation",
    body: [
      "The full decision: a complete handoff when everything is supported, or escalation with the gaps stated openly. The server re-checks readiness, the reviewer's authority and data freshness against the exact snapshot.",
    ],
  },
  {
    id: "draft",
    chapter: "review",
    target: at("draft-report"),
    title: "Draft report",
    body: [
      "The report as it will be sent, generated by the server from the current payment inventory, so the reviewer approves exactly what leaves the bank.",
    ],
  },
  {
    id: "delivery",
    chapter: "delivery",
    go: caseTab("delivery"),
    needsCase: true,
    target: at("report-delivery"),
    title: "Report delivery",
    body: [
      "One approved report goes to two destinations: the bank's case system and a national cybercrime-reporting-style receiver (both simulated). Each send is retried until it is acknowledged, and never duplicated.",
      "Delivered means acknowledged, not that money is held or recovered. Open View delivered report below to read the exact report both receivers got, and print it as a PDF.",
    ],
  },
  {
    id: "packets",
    chapter: "delivery",
    target: at("delivered-packet-history"),
    title: "Delivered packet history",
    body: [
      "The exact content that was approved and sent stays inspectable, even after the case is reassessed with new information.",
    ],
  },
  {
    id: "referrals",
    chapter: "delivery",
    target: at("urgent-referral-history"),
    optional: true,
    absent: "Shown once an urgent referral has been approved.",
    title: "Urgent referral history",
    body: [
      "Earlier urgent referrals, with their scope and receipts, remain visible next to the later full handoff.",
    ],
  },
  {
    id: "owner",
    chapter: "delivery",
    target: at("owner-and-next-action"),
    title: "Owner and next action",
    body: [
      "Delivery is a handoff, not closure. A named owner and the next action, such as tracking both receivers' responses, keep the case moving.",
    ],
  },
  {
    id: "chronology",
    chapter: "audit",
    go: caseTab("audit"),
    needsCase: true,
    target: at("audit-chronology"),
    title: "Audit chronology",
    body: [
      "Every event persisted by the backend: uploads, assessments, requests, approvals, deliveries. Originals and decisions are retained, so the case can be reconstructed later.",
    ],
  },
  {
    id: "approvals",
    chapter: "audit",
    target: at("approval-history"),
    title: "Approval history",
    body: [
      "Past approvals and the revision each one covered. An old approval never authorises newer content.",
    ],
  },
  {
    id: "urgency",
    chapter: "overview",
    go: caseTab("overview"),
    needsCase: true,
    target: at("golden-hour-priority"),
    title: "Why this case is urgent",
    body: [
      "The clock started at the scam payment, not when the customer called. It shows how much of the golden hour is left and how much money is at stake, so the analyst knows which case to work first.",
      "Two roles share this desk: the Analyst investigates and asks the customer for anything missing; a separate Reviewer approves the report. Nobody can approve their own work.",
    ],
  },
  {
    id: "ai-summary",
    chapter: "overview",
    target: at("gemini-summary"),
    optional: true,
    absent: "Appears once Gemini has drafted the summary for this case.",
    title: "Gemini reads the case for you",
    body: [
      "Gemini drafts the analyst summary and the cybercrime (NCRP) statement from the verified facts. Every sentence carries a tag for the source it used; a sentence whose source or numbers do not check out is removed before you see it.",
    ],
  },
  {
    id: "work-done",
    chapter: "overview",
    target: at("work-done"),
    title: "An hour of manual work, already done",
    body: [
      "Left: what an analyst normally does by hand across core banking, email and phone calls. Right: what was done automatically for this case, with the real results.",
    ],
  },
  {
    id: "investigator",
    chapter: "overview",
    target: at("gemini-investigator"),
    title: "Gemini investigator",
    body: [
      "Click Investigate with Gemini. An AI agent decides which checks to run (ledger, other complaints about the same payee, the money trail, how fresh our bank records are), runs them and reports findings that point to each check. It can look, never change the case.",
    ],
    action:
      "Optional: click Investigate with Gemini and open a step's results.",
  },
  {
    id: "finish",
    chapter: "audit",
    title: "That's the whole path",
    body: [
      "From a panicked call at 10:02 to a cited, reviewed and delivered report: the customer explains once, the analyst verifies every fact against its source, and the reviewer approves an exact, auditable snapshot.",
      "Try the rest yourself: send a request and answer it as the customer, switch to Reviewer, approve, and watch both receivers acknowledge. Restart this tour any time from the Tour button.",
    ],
  },
];

// Twelve decision points. Ordinary controls remain discoverable outside the tour.
const HIGHLIGHTS = [
  "intro",
  "practice",
  "narrative",
  "evidence",
  "registered",
  "brief",
  "originals",
  "graph",
  "engine",
  "readiness",
  "delivery",
  "finish",
];
export const STEPS = HIGHLIGHTS.map((id) => {
  const step = ALL_STEPS.find((item) => item.id === id);
  if (id === "brief")
    return {
      ...step,
      go: caseTab("overview"),
      needsCase: true,
      body: [
        ...step.body,
        "Start with the next-action banner, summary and bank-matched payments. Additional tools below include the source-checked Gemini summary and on-demand investigator. Assessment methods are expandable.",
        "Work as Analyst demo to inspect evidence and request clarification. Switch to Reviewer demo only for the independent approval of the current revision. The bank applies this separation so the investigator cannot authorise their own handoff.",
      ],
    };
  if (id === "registered")
    return {
      ...step,
      action:
        "Your customer journey is complete. Use Continue as analyst in the top-right corner to investigate this exact case. Next also opens its overview.",
    };
  if (id === "graph")
    return {
      ...step,
      body: [
        "Follow the bank-reported path of each disputed payment. Select an account to see its source and observation time. Observed availability is time-bound; it is not a confirmed hold or recovery.",
      ],
    };
  if (id === "readiness")
    return {
      ...step,
      target: at("case-next-action"),
      body: [
        "The bank's rules, not the AI, decide when a report is ready: an urgent referral can go early, a complete report needs every required fact. Ticks show what is settled; warnings show what is still missing.",
        "Only the Reviewer can approve, with a written reason, and only the exact version on screen. Switch to Reviewer demo from the identity menu at the top right.",
      ],
      action:
        "Follow the role named in the next-action banner. Use Continue as reviewer demo for an eligible complete handoff, or the separately labelled urgent-referral option. Missing customer information still belongs with the analyst.",
    };
  if (id === "delivery")
    return {
      ...step,
      body: [
        "Send the approved report. It goes to two receivers, the bank's case system and the cybercrime portal, and is delivered only when both confirm receipt.",
        "Assign a follow-up owner and next action. Delivery is a handoff, not a freeze, refund or closed investigation.",
      ],
      action:
        "As Reviewer demo: Review & send approved reports → Confirm send. Wait for both acknowledgements. Then switch to Analyst demo, save an owner, next action and assignment reason. Inspect the delivered report; its money trail is included.",
    };
  if (id === "practice")
    return {
      ...step,
      body: [
        "Pick when the scam happened and start a fresh session. A new fictional bank, customers and money movements are built for you (about 20 seconds). Then choose a customer marked with a suspicious payment and select that payment.",
      ],
      action:
        "Start a session, choose a marked customer, select their suspicious payment and continue.",
      advance: { selector: at("report-narrative") },
    };
  if (id === "intro")
    return {
      ...step,
      body: [
        '10:02. A caller posing as the bank\'s fraud team talks a customer into sending money to a "safe account". By 10:10 the money is moving through mule accounts at other banks, and some is withdrawn at an ATM.',
        "The first hour, the golden hour, is when banks can still ask for that money to be held. You will report the scam as the customer, then work it as the fraud desk, and see what the system does in seconds that normally takes an analyst an hour. Everything here is synthetic.",
      ],
    };
  if (id === "evidence")
    return {
      ...step,
      body: [
        "Attach the payment receipt or a screenshot of the scammer's chat or call log, or create a labelled sample. Document AI reads it, and every fact keeps a link to the exact line it came from.",
      ],
      action:
        "Attach relevant evidence, continue, review and submit the report.",
      advance: { route: /^\/victim\/complaints\// },
    };
  if (id === "finish")
    return {
      ...step,
      go: caseTab("audit"),
      needsCase: true,
      title: "Verify the handoff",
      body: [
        "The result: a sourced, reviewer-approved report with the money trail, confirmed by both receivers, and an owner for the follow-up. Sending a report is not a freeze or a refund; the receiving banks act on it.",
        "Inspect audit and approval history here. You can revisit any chapter, or start another fresh complaint with a different customer.",
      ],
    };
  return step;
});
