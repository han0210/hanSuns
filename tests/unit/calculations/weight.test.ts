import { describe, expect, it } from "vitest";
import { roundToIncrement, validateWeightInput } from "@/domain/calculations/weight";
import { parsePositiveKg } from "@/lib/weightInput";
import { kg, lb } from "@/domain/types/weight";

describe("validateWeightInput", () => {
  it.each([
    ["100", 100],
    ["62.5", 62.5],
    [" 80 ", 80],
    [0.5, 0.5],
  ])("유효한 값 %j → %d", (input, expected) => {
    expect(validateWeightInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    [null, "EMPTY"],
    [undefined, "EMPTY"],
    ["abc", "NOT_A_NUMBER"],
    ["1e3", "NOT_A_NUMBER"],
    ["Infinity", "NOT_A_NUMBER"],
    ["+5", "NOT_A_NUMBER"],
    ["0", "NON_POSITIVE"],
    ["-5", "NON_POSITIVE"],
    [0, "NON_POSITIVE"],
    [-2.5, "NON_POSITIVE"],
    [Number.NaN, "NOT_A_NUMBER"],
    [Number.POSITIVE_INFINITY, "NOT_FINITE"],
    [Number.NEGATIVE_INFINITY, "NOT_FINITE"],
  ])("차단 %j → %s", (input, error) => {
    expect(validateWeightInput(input)).toEqual({ ok: false, error });
  });

  it("문자열 입력은 기존 프로토타입 검증(parsePositiveKg)과 허용 여부가 같다", () => {
    for (const text of ["100", "62.5", " 7 ", "", "0", "-5", "abc", "1e3", "+5", "1.", ".5", "Infinity"]) {
      const result = validateWeightInput(text);
      expect(result.ok ? result.value : null).toBe(parsePositiveKg(text));
    }
  });
});

describe("roundToIncrement (CALCULATION_RULES 4.2, H-12 중간값 올림)", () => {
  it.each([
    [73.4, 2.5, 72.5],
    [62, 2.5, 62.5],
    [63, 2.5, 62.5],
    [64, 2.5, 65],
    [72.5, 2.5, 72.5],
    [13.3, 1, 13],
    [61.24, 2.5, 60],
    [61.26, 2.5, 62.5],
  ])("%d / %d → %d", (weight, increment, expected) => {
    expect(roundToIncrement(kg(weight), kg(increment))).toEqual({ ok: true, value: kg(expected) });
  });

  it("정확한 중간값은 높은 쪽 (61.25 → 62.5)", () => {
    expect(roundToIncrement(kg(61.25), kg(2.5))).toEqual({ ok: true, value: kg(62.5) });
  });

  it("부동소수점으로 만든 중간값도 내림되지 않는다 (87.5 × 0.7 → 62.5)", () => {
    const raw = 87.5 * 0.7; // 61.24999999999999
    expect(raw).not.toBe(61.25);
    expect(roundToIncrement(kg(raw), kg(2.5))).toEqual({ ok: true, value: kg(62.5) });
  });

  it("결과는 증가 단위의 정확한 배수 (소수 오차 없음)", () => {
    const result = roundToIncrement(kg(0.1 + 0.2), kg(0.2));
    expect(result).toEqual({ ok: true, value: kg(0.4) });
  });

  it("lb 값끼리는 lb로 계산한다", () => {
    expect(roundToIncrement(lb(136), lb(5))).toEqual({ ok: true, value: lb(135) });
  });

  it("kg와 lb를 섞으면 UNIT_MISMATCH", () => {
    expect(roundToIncrement(kg(62), lb(5))).toEqual({ ok: false, error: "UNIT_MISMATCH" });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("증가 단위 %d → INVALID_INCREMENT", (increment) => {
    expect(roundToIncrement(kg(60), kg(increment))).toEqual({ ok: false, error: "INVALID_INCREMENT" });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("중량 %d → INVALID_WEIGHT", (weight) => {
    expect(roundToIncrement(kg(weight), kg(2.5))).toEqual({ ok: false, error: "INVALID_WEIGHT" });
  });

  it("반올림 결과가 0 이하면 NON_POSITIVE_RESULT (4.5절)", () => {
    expect(roundToIncrement(kg(1), kg(2.5))).toEqual({ ok: false, error: "NON_POSITIVE_RESULT" });
  });
});
