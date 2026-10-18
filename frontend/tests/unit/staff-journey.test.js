import { it, expect } from "vitest";
import { staffJourney } from "../../src/models/staffJourney.js";
const view = (workflow = {}, requests = []) => ({
  identity: { caseId: "C" },
  snapshot: { revision: 4, digest: "D4", requests },
  workflow: { ...workflow },
});
it("does not equate an eligible urgent referral with a completed analyst investigation", () => {
  const next = staffJourney(
    view({ urgent_referral: { eligible: true } }, [{ state: "proposed" }]),
  );
  expect(next.phase).toBe("request");
  expect(next.reviewer).toBeUndefined();
});
it("names reviewer work only when the server marks full review eligibility", () => {
  expect(staffJourney(view({ readiness: "COMPLETE_CANDIDATE" })).reviewer).toBe(
    true,
  );
  expect(
    staffJourney(view({ readiness: "REVIEW_REQUIRED" })).reviewer,
  ).toBeUndefined();
});
it("requires matching revision and digest before calling an approval current", () => {
  expect(
    staffJourney(view({ approval: { revision: 3, digest: "D3" } })).phase,
  ).not.toBe("delivery");
  expect(
    staffJourney(view({ approval: { revision: 4, digest: "D4" } })).phase,
  ).toBe("delivery");
});
it("prioritises stale, failed and running states over otherwise eligible review", () => {
  expect(
    staffJourney(view({ readiness: "COMPLETE_CANDIDATE" }), true).phase,
  ).toBe("stale");
  expect(
    staffJourney(
      view({ readiness: "COMPLETE_CANDIDATE", job: { status: "failed" } }),
    ).phase,
  ).toBe("failed");
  expect(
    staffJourney(
      view({ readiness: "COMPLETE_CANDIDATE", job: { status: "running" } }),
    ).phase,
  ).toBe("processing");
});
it("does not call one receiver acknowledgement delivered", () => {
  const w = {
    status: "completed",
    deliveries: [{ kind: "case_ticket", status: "sent" }],
  };
  expect(staffJourney(view(w)).phase).not.toBe("followup");
  w.deliveries.push({ kind: "cfcfrms_report_update", status: "sent" });
  expect(staffJourney(view(w)).phase).toBe("followup");
});
it("separates waiting for customer clarification from a bank refresh", () => {
  expect(staffJourney(view({ status: "awaiting_information" })).phase).toBe(
    "waiting",
  );
  expect(staffJourney(view({ bank_data_refresh_required: true })).phase).toBe(
    "bank",
  );
});
