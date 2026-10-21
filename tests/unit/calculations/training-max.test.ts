import { describe, expect, it } from "vitest";
import { calculateTM, INITIAL_TM_RATIO } from "@/domain/calculations/trainingMax";
import { kg, lb } from "@/domain/types/weight";

describe("calculateTM (H-01)", () => {
  it("비율은 0.9", () => {
    expect(INITIAL_TM_RATIO).toBe(0.9);
  });

  it("1RM 100kg → TM 90kg", () => {
    expect(calculateTM(kg(100))).toEqual({ ok: true, value: kg(90) });
  });

  it("소수 TM은 반올림하지 않는다 (82.5 → 74.25, 101 → 90.9, 62.5 → 56.25)", () => {
    for (const [oneRepMax, expected] of [
      [82.5, 74.25],
      [101, 90.9],
      [62.5, 56.25],
    ]) {
      const result = calculateTM(kg(oneRepMax));
      if (!result.ok) throw new Error(result.error);
      expect(result.value.value).toBeCloseTo(expected, 10);
      expect(result.value.unit).toBe("kg");
    }
  });

  it("단위를 유지한다 (lb 입력 → lb TM)", () => {
    expect(calculateTM(lb(200))).toEqual({ ok: true, value: lb(180) });
  });

  it("미입력은 MISSING_1RM", () => {
    expect(calculateTM(null)).toEqual({ ok: false, error: "MISSING_1RM" });
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("1RM %d → INVALID_1RM", (value) => {
    expect(calculateTM(kg(value))).toEqual({ ok: false, error: "INVALID_1RM" });
  });
});
