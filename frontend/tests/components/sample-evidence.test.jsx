import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../src/api/client.js", () => ({ apiRequest: mock.request }));
vi.mock("../../src/state/resources.jsx", async (original) => ({
  ...(await original()),
  useResource: () => ({ data: { ai_available: true } }),
}));
import SampleEvidence from "../../src/pages/victim/SampleEvidence.jsx";
afterEach(cleanup);

it("shows progress only for the clicked evidence type and attaches that file", async () => {
  let resolve;
  mock.request.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const setFiles = vi.fn();
  render(
    <SampleEvidence
      selected={["TX-1"]}
      narrative="A scam report"
      count={0}
      setFiles={setFiles}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create synthetic receipt" }),
  );
  expect(
    screen
      .getByRole("button", { name: "Creating receipt…" })
      .getAttribute("aria-busy"),
  ).toBe("true");
  for (const type of ["chat", "call log"]) {
    const other = screen.getByRole("button", {
      name: `Create synthetic ${type}`,
    });
    expect(other.disabled).toBe(true);
    expect(other.getAttribute("aria-busy")).toBe("false");
  }
  await act(async () =>
    resolve({ blob: async () => new Blob(["image"], { type: "image/png" }) }),
  );
  expect(setFiles.mock.calls[0][0]([])[0].kind).toBe("receipt");
  expect(
    screen.getByRole("button", { name: "Create synthetic receipt" }).disabled,
  ).toBe(false);
});

it("restores evidence controls after a generation failure", async () => {
  mock.request.mockRejectedValue(
    new Error("Sample generation failed. Try again."),
  );
  render(
    <SampleEvidence
      selected={["TX-1"]}
      narrative="A scam report"
      count={0}
      setFiles={vi.fn()}
    />,
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Create synthetic chat" }),
    ),
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Sample generation failed",
  );
  expect(
    screen.getByRole("button", { name: "Create synthetic chat" }).disabled,
  ).toBe(false);
});
