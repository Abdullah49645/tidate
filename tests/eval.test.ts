import { describe, expect, it } from "vitest";
import { auc } from "../scripts/eval-run";

describe("evaluation statistics", () => {
  it("computes Mann–Whitney AUC with ties", () => {
    expect(auc([3, 4], [1, 2])).toBe(1);
    expect(auc([1, 2], [3, 4])).toBe(0);
    expect(auc([1, 2], [1, 2])).toBe(0.5);
    expect(auc([2], [1, 2, 3])).toBeCloseTo(0.5, 10);
    expect(auc([], [1])).toBeNull();
  });
});
