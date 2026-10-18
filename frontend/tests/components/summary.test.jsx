import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../src/api/client.js", () => ({
  apiRequest: mock.request,
  post: vi.fn(),
}));
vi.mock("../../src/state/resources.jsx", () => ({
  useSession: () => ({ persona: "analyst" }),
}));
import { GeminiSummary } from "../../src/components/Gemini.jsx";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const draft = {
  available: true,
  summary: [{ text: "A source-checked example summary.", source_ids: [] }],
  sources: [],
  cybercrime_statement: [{ text: "An example statement.", source_ids: [] }],
  model: "test-model",
};
it("shows an explicit retry when the summary request fails", async () => {
  mock.request
    .mockRejectedValueOnce(new Error("Capacity reached"))
    .mockResolvedValueOnce(draft);
  render(<GeminiSummary caseId="A" revision={1} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry summary" }));
  await screen.findByText("A source-checked example summary.");
  expect(mock.request).toHaveBeenCalledTimes(2);
});
it("labels retained summaries as older versions and blocks copying an outdated statement", async () => {
  mock.request
    .mockResolvedValueOnce(draft)
    .mockReturnValueOnce(new Promise(() => {}));
  const { rerender } = render(<GeminiSummary caseId="A" revision={4} />);
  await screen.findByText("A source-checked example summary.");
  rerender(<GeminiSummary caseId="A" revision={5} />);
  await screen.findByText(/Showing summary version 4/);
  fireEvent.click(screen.getByText(/Draft cybercrime/));
  expect(screen.getByRole("button", { name: /Copy statement/ }).disabled).toBe(
    true,
  );
});
it("does not carry the previous case’s summary into a different case", async () => {
  mock.request
    .mockResolvedValueOnce(draft)
    .mockReturnValueOnce(new Promise(() => {}));
  const { rerender } = render(<GeminiSummary caseId="A" revision={1} />);
  await screen.findByText("A source-checked example summary.");
  rerender(<GeminiSummary caseId="B" revision={1} />);
  await waitFor(() =>
    expect(screen.queryByText("A source-checked example summary.")).toBeNull(),
  );
});
