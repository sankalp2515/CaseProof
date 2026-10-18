import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
const mock = vi.hoisted(() => ({ data: null }));
vi.mock("../../src/state/resources.jsx", async (original) => ({
  ...(await original()),
  useResource: () => ({ data: mock.data, reload: vi.fn() }),
  useSession: () => ({ config: null }),
}));
import Victim from "../../src/pages/victim/Victim.jsx";
const customer = { account: "SYNTH-C1", display_name: "Asha Rao (synthetic)" };
afterEach(cleanup);
it("shows the API customer display name in the selection card", () => {
  mock.data = { customers: [customer] };
  render(<Victim route="/victim/start" />);
  expect(screen.getByRole("button", { name: /Asha Rao/ })).toBeTruthy();
});
it("greets the scoped customer using the API display name", () => {
  mock.data = { customer, complaints: [], transactions: [] };
  render(<Victim route="/victim/home" />);
  expect(
    screen.getByRole("heading", { name: "Hello, Asha Rao." }),
  ).toBeTruthy();
});
it("keeps payment consent explicit and moves keyboard focus with the report step", () => {
  Element.prototype.scrollIntoView = vi.fn();
  mock.data = { customer, complaints: [], transactions: [] };
  render(<Victim route="/victim/report" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Continue", exact: true }),
  );
  expect(screen.getByRole("alert").textContent).toContain("Select a payment");
  expect(screen.queryByRole("textbox", { name: "What happened?" })).toBeNull();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "I cannot identify the payment yet" }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue", exact: true }),
  );
  expect(document.activeElement.dataset.tour).toBe("report-narrative");
  expect(
    screen
      .getByRole("list", { name: "Report progress" })
      .querySelector('[aria-current="step"]').textContent,
  ).toContain("What happened");
  fireEvent.change(screen.getByRole("textbox", { name: "What happened?" }), {
    target: { value: "A caller asked me to move money to a safe account." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Back", exact: true }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue", exact: true }),
  );
  expect(
    screen.getByRole("textbox", { name: "What happened?" }).value,
  ).toContain("safe account");
});
