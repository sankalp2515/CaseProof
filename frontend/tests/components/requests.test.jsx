import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({
  persona: "analyst",
  load: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../../src/state/resources.jsx", async (original) => ({
  ...(await original()),
  useSession: () => ({ persona: mock.persona }),
}));
vi.mock("../../src/api/client.js", () => ({
  loadCaseView: mock.load,
  post: mock.post,
}));
import Requests from "../../src/pages/case/LiveRequests.jsx";
const make = (revision = 1) => ({
  snapshot: {
    case_id: "CASE-A",
    revision,
    digest: "D" + revision,
    requests: [
      {
        request_id: "R1",
        state: "proposed",
        catalogue_id: "clarify_deception",
        reason: "Please explain how you were asked to pay.",
        explanation: { can_settle: ["deception_account"] },
      },
    ],
  },
  workflow: {},
});
afterEach(() => {
  cleanup();
  mock.persona = "analyst";
  vi.clearAllMocks();
});
it("keeps reviewer request sending read-only", () => {
  mock.persona = "reviewer";
  render(<Requests view={make()} reload={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Review & send/ }).disabled).toBe(
    true,
  );
});
it("blocks an open request dialog when its assessment revision changes", () => {
  const { rerender } = render(<Requests view={make()} reload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Review & send/ }));
  rerender(<Requests view={make(2)} reload={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Confirm request" }).disabled).toBe(
    true,
  );
  expect(screen.getByText(/The assessment changed/)).toBeTruthy();
});
it("rechecks the live proposal before sending instead of reusing stale UI state", async () => {
  const current = make();
  current.identity = { revision: 1, digest: "D1" };
  current.snapshot.requests[0].state = "fulfilled";
  mock.load.mockResolvedValue(current);
  render(<Requests view={make()} reload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Review & send/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm request" }));
  await waitFor(() =>
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0),
  );
  expect(mock.post).not.toHaveBeenCalled();
});
it("does not allow a question to be sent while processing is running", () => {
  const v = make();
  v.workflow.job = { status: "running" };
  render(<Requests view={v} reload={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Review & send/ }).disabled).toBe(
    true,
  );
});
