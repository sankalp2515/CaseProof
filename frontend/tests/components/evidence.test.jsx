import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({ persona: "analyst" }));
vi.mock("../../src/state/resources.jsx", async (original) => ({
  ...(await original()),
  useSession: () => ({ persona: mock.persona }),
}));
vi.mock("../../src/api/client.js", () => ({
  apiRequest: vi.fn(async () => ({
    blob: async () => ({ text: async () => "Original file contents" }),
  })),
  post: vi.fn(),
  evidenceForm: vi.fn(),
}));
vi.mock("../../src/components/Gemini.jsx", () => ({
  GeminiReader: () => null,
}));
import Evidence from "../../src/pages/case/LiveEvidence.jsx";
function make() {
  return {
    snapshot: {
      case_id: "CASE-A",
      revision: 1,
      artifacts: [
        {
          artifact_id: "N",
          kind: "narrative",
          mime_type: "text/plain",
          byte_count: 30,
          sha256: "hash",
          received_at: null,
        },
        {
          artifact_id: "R",
          kind: "receipt",
          mime_type: "text/plain",
          byte_count: 30,
          sha256: "hash",
          received_at: null,
        },
      ],
      segments: [
        { segment_id: "LINE-N", artifact_id: "N", text: "Customer story" },
        { segment_id: "LINE-R", artifact_id: "R", text: "Amount INR 51,000" },
      ],
      claims: [
        {
          claim_id: "C-N",
          kind: "scam_instruction",
          normalized_value: "Customer story",
          original_text: "Customer story",
          anchor_segment_ids: ["LINE-N"],
          evidence_state: "reported",
        },
        {
          claim_id: "C-R",
          kind: "amount",
          normalized_value: 5100000,
          original_text: "Amount INR 51,000",
          anchor_segment_ids: ["LINE-R"],
          evidence_state: "source_supported",
        },
      ],
      ledger_matches: [],
    },
    workflow: {},
  };
}
afterEach(() => {
  cleanup();
  mock.persona = "analyst";
  location.hash = "";
});
it("shows facts for the selected original and offers an explicit all-files view", async () => {
  render(<Evidence view={make()} reload={vi.fn()} />);
  await screen.findByText("Original file contents");
  expect(screen.queryByText("Customer story")).toBeNull();
  fireEvent.change(screen.getByLabelText("Evidence fact scope"), {
    target: { value: "all" },
  });
  expect(screen.getAllByText("Customer story").length).toBeGreaterThan(0);
});
it("selects a cited original when its source arrives in a later assessment", async () => {
  location.hash = "#/staff/cases/CASE-A/evidence?source=LINE-N";
  const first = make();
  first.snapshot.segments = [];
  first.snapshot.claims = [];
  const { rerender } = render(<Evidence view={first} reload={vi.fn()} />);
  expect(screen.getByText(/That cited line is not present/)).toBeTruthy();
  rerender(<Evidence view={make()} reload={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Customer story"),
  );
  expect(
    screen
      .getByRole("button", { name: "narrative 1" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("disables corrections for a reviewer and while a new assessment is running", async () => {
  mock.persona = "reviewer";
  const { rerender } = render(<Evidence view={make()} reload={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Correct", exact: true }).disabled,
  ).toBe(true);
  mock.persona = "analyst";
  const running = make();
  running.workflow.job = { status: "running" };
  rerender(<Evidence view={running} reload={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Correct", exact: true }).disabled,
  ).toBe(true);
  await screen.findByText("Original file contents");
});
