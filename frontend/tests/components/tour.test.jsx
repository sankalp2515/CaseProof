import React from "react";
import fs from "node:fs";
import path from "node:path";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
vi.mock("../../src/state/resources.jsx", async (original) => ({
  ...(await original()),
  useSession: () => ({ persona: "analyst" }),
}));
import TourOverlay, { TourButton } from "../../src/tour/Tour.jsx";
import { STEPS, CHAPTERS } from "../../src/tour/steps.js";
import { tour, caseFromRoute } from "../../src/tour/store.js";

beforeEach(() => {
  sessionStorage.clear();
  tour.reset();
  location.hash = "#/entry";
});
afterEach(cleanup);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? sources(full)
      : /\.jsx?$/.test(entry.name)
        ? [fs.readFileSync(full, "utf8")]
        : [];
  });
}

it("every step is well formed and every anchor exists in the application", () => {
  const code = sources(path.resolve(__dirname, "../../src")).join("\n");
  const anchors = new Set(
    [...code.matchAll(/data-tour="([a-z0-9-]+)"/g)].map((m) => m[1]),
  );
  // <CardH tour="..."> renders the same data-tour attribute.
  for (const m of code.matchAll(/(?<![-\w])tour="([a-z0-9-]+)"/g)) anchors.add(m[1]);
  for (const m of code.matchAll(/<CardH[^>]*?\btitle="([^"]+)"/gs))
    anchors.add(
      m[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
  const ids = STEPS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const step of STEPS) {
    expect(CHAPTERS[step.chapter], step.id).toBeTruthy();
    expect(step.title && step.body.length, step.id).toBeTruthy();
    if (step.target) {
      const name = step.target.match(/^\[data-tour="([a-z0-9-]+)"\]$/)?.[1];
      expect(name, step.id).toBeTruthy();
      expect(anchors.has(name), `${step.id}: ${name}`).toBe(true);
    }
    if (step.optional) expect(step.absent, step.id).toBeTruthy();
  }
});

it("covers every analyst tab and finishes on a summary", () => {
  for (const tab of [
    "overview",
    "evidence",
    "trail",
    "requests",
    "review",
    "delivery",
    "audit",
  ])
    expect(
      STEPS.some(
        (s) =>
          typeof s.go === "function" && s.go({ caseId: "C" }).endsWith(tab),
      ),
      tab,
    ).toBe(true);
  expect(STEPS.at(-1).id).toBe("finish");
  expect(STEPS.length).toBeLessThanOrEqual(12);
});

it("opens at the golden-hour introduction and moves forward and back", () => {
  render(<TourOverlay />);
  act(() => tour.start(0));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Welcome: the golden hour")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByText("Generate your own scam")).toBeTruthy();
  expect(location.hash).toBe("#/victim/start");
  fireEvent.click(screen.getByRole("button", { name: /Back/ }));
  expect(screen.getByText("Welcome: the golden hour")).toBeTruthy();
});

it("closes with Escape and resumes from the same step", () => {
  render(<TourOverlay />);
  act(() => tour.start(3));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => tour.start(tour.get().index));
  expect(screen.getByText(STEPS[3].title)).toBeTruthy();
});

it("jumps straight to an analyst chapter", async () => {
  render(<TourOverlay />);
  act(() => tour.start(0));
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Jump to chapter"), {
      target: { value: "trail" },
    });
  });
  expect(screen.getByRole("heading", { name: "Money trail" })).toBeTruthy();
});

it("remembers the case filed during the tour", () => {
  expect(caseFromRoute("/victim/complaints/CASE-abc123")).toBe("CASE-abc123");
  expect(caseFromRoute("/staff/cases/CASE-x/trail")).toBe("CASE-x");
  expect(caseFromRoute("/staff/queue")).toBeNull();
});

it("stays on the current entry point and cannot skip uncompleted intake actions", () => {
  location.hash = "#/victim/start";
  render(<TourOverlay />);
  act(() => tour.start(0));
  expect(location.hash).toBe("#/victim/start");
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("button", { name: /Next/ }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Minimise guidance" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Show guidance/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("allows Back/resume into an intake step whose action is already satisfied", () => {
  const evidence = document.createElement("h2");
  evidence.dataset.tour = "report-evidence";
  document.body.append(evidence);
  render(<TourOverlay />);
  act(() => tour.start(2));
  expect(screen.getByRole("button", { name: /Next/ }).disabled).toBe(false);
  evidence.remove();
});

it("launcher restarts an interrupted tour from the reporting entrance, not a stale step or case", () => {
  act(() => {
    tour.setCase("OLD");
    tour.start(3);
    tour.stop();
  });
  location.hash = "#/staff/cases/OLD/review";
  render(
    <>
      <TourButton />
      <TourOverlay />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Tour" }));
  expect(tour.get()).toMatchObject({ active: true, index: 0, caseId: null });
  expect(location.hash).toBe("#/victim/start");
  expect(screen.getByText("Welcome: the golden hour")).toBeTruthy();
});
it("shows loading guidance before declaring a missing target", async () => {
  vi.useFakeTimers();
  render(<TourOverlay />);
  act(() => tour.start(2));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText(/Preparing this step/)).toBeTruthy();
  expect(
    screen.queryByText(/This panel is not on the current screen yet/),
  ).toBeNull();
  cleanup();
  vi.useRealTimers();
});

it("global launcher reopens the welcome dialog even when guidance was minimised", () => {
  render(
    <>
      <TourButton />
      <TourOverlay />
    </>,
  );
  act(() => tour.start(2));
  fireEvent.click(screen.getByRole("button", { name: "Minimise guidance" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tour" }));
  expect(
    screen.getByRole("heading", { name: "Welcome: the golden hour" }),
  ).toBeTruthy();
});

it("keeps the combined evidence step valid while the customer reviews for over 30 seconds", async () => {
  vi.useFakeTimers();
  const review = document.createElement("h2");
  review.dataset.tour = "report-review";
  review.scrollIntoView = vi.fn();
  document.body.append(review);
  try {
    location.hash = "#/victim/report";
    render(<TourOverlay />);
    act(() => tour.start(STEPS.findIndex((item) => item.id === "evidence")));
    await act(async () => vi.advanceTimersByTime(32000));
    expect(
      screen.getByRole("heading", { name: "Review and submit your report" }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/This panel is not on the current screen yet/),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Next/ }).disabled).toBe(true);
    await act(async () => {
      location.hash = "#/victim/complaints/CASE-tour-test";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await act(async () => vi.advanceTimersByTime(600));
    expect(STEPS[tour.get().index].id).toBe("registered");
  } finally {
    cleanup();
    review.remove();
    vi.useRealTimers();
  }
});

it("places minimised victim guidance inside its header instead of over its buttons", () => {
  const slot = document.createElement("span");
  slot.id = "victim-tour-slot";
  document.body.append(slot);
  try {
    render(<TourOverlay />);
    act(() => tour.start(0));
    fireEvent.click(screen.getByRole("button", { name: "Minimise guidance" }));
    expect(slot.textContent).toBe("Resume tour");
    expect(document.querySelector(".tour-resume")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show guidance/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  } finally {
    cleanup();
    slot.remove();
  }
});
