import { it, expect } from "vitest";
import {
  edgeCurve,
  trailTone,
  transferWindow,
  layoutTrail,
} from "../../src/pages/case/LiveTrail.jsx";
it("uses reference curved connectors without changing transfer values", () => {
  expect(
    edgeCurve([
      { x: 10, y: 20 },
      { x: 60, y: 90 },
    ]),
  ).toBe("M10,20 C35,20 35,90 60,90");
});
it("keeps sourced transfer and uncertain availability separate", () => {
  expect(
    trailTone({ kind: "beneficiary" }, [{ status: "unaccounted" }], null),
  ).toBe("uncertain");
  expect(trailTone({ kind: "customer" }, [], null)).toBe("victim");
  expect(
    trailTone({ kind: "beneficiary" }, [{ status: "recoverable" }], {
      balance_minor: 10,
    }),
  ).toBe("observed");
});

it("uses actual transfer times for replay spacing and handles unknown times", () => {
  expect(transferWindow([{ ts: "invalid" }])).toBeNull();
  const w = transferWindow([
    { ts: "2026-10-18T10:00:00Z" },
    { ts: "2026-10-18T10:20:00Z" },
  ]);
  expect(w.end - w.start).toBe(22 * 60000);
});
it("lays out branches, merges and cycles without dropping bank transfers", () => {
  const trail = {
    accounts: ["a", "b", "c", "d"].map((id) => ({ id })),
    transfers: [
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
      ["d", "a"],
    ].map(([from_account, to_account], i) => ({
      from_account,
      to_account,
      txn_id: String(i),
    })),
  };
  const g = layoutTrail(trail);
  expect(g.nodes).toHaveLength(4);
  expect(g.edges).toHaveLength(5);
  expect(
    g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
  ).toBe(true);
  expect(g.edges.every((e) => e.points.length >= 2)).toBe(true);
});
