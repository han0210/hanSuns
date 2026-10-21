import { describe, expect, it } from "vitest";
import { HYBRID_T1_TEMPLATE, HYBRID_T2_TEMPLATE, calculateTemplateSets } from "@/domain/templates/hybridTemplates";
import { kg, lb } from "@/domain/types/weight";

const sets = (result: ReturnType<typeof calculateTemplateSets>) => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("Hybrid T1 템플릿 (H-20, 원본 nSuns 공식 템플릿 아님)", () => {
  it("9세트, 세트별 TM 비율·목표 반복·AMRAP", () => {
    expect(HYBRID_T1_TEMPLATE).toMatchObject({ templateId: "hybrid-t1", templateVersion: 1, tier: "T1" });
    expect(HYBRID_T1_TEMPLATE.sets.map((s) => [s.setNumber, s.intensityRatio, s.targetReps, s.isAmrap])).toEqual([
      [1, 0.65, 8, false],
      [2, 0.75, 6, false],
      [3, 0.85, 4, false],
      [4, 0.9, 2, false],
      [5, 0.95, 1, true],
      [6, 0.9, 3, false],
      [7, 0.85, 5, false],
      [8, 0.8, 7, false],
      [9, 0.75, 4, true],
    ]);
  });
});

describe("Hybrid T2 템플릿 (H-21, 원본 nSuns 공식 템플릿 아님)", () => {
  it("8세트, 세트별 TM 비율·목표 반복, AMRAP 없음", () => {
    expect(HYBRID_T2_TEMPLATE).toMatchObject({ templateId: "hybrid-t2", templateVersion: 1, tier: "T2" });
    expect(HYBRID_T2_TEMPLATE.sets.map((s) => [s.setNumber, s.intensityRatio, s.targetReps, s.isAmrap])).toEqual([
      [1, 0.5, 5, false],
      [2, 0.6, 5, false],
      [3, 0.7, 3, false],
      [4, 0.7, 5, false],
      [5, 0.7, 7, false],
      [6, 0.7, 4, false],
      [7, 0.7, 6, false],
      [8, 0.7, 8, false],
    ]);
  });
});

describe("calculateTemplateSets — 목표 중량 = roundToIncrement(TM × 비율)", () => {
  it("벤치 1RM 100 → TM 90, 증가 단위 2.5kg", () => {
    const result = sets(calculateTemplateSets(HYBRID_T1_TEMPLATE, kg(90), kg(2.5)));
    // 58.5→57.5, 67.5, 76.5→77.5, 81→80, 85.5→85, 81→80, 76.5→77.5, 72→72.5, 67.5
    expect(result.map((s) => s.targetWeight)).toEqual([57.5, 67.5, 77.5, 80, 85, 80, 77.5, 72.5, 67.5]);
    expect(result.map((s) => s.targetReps)).toEqual([8, 6, 4, 2, 1, 3, 5, 7, 4]);
    expect(result.filter((s) => s.isAmrap).map((s) => s.setNumber)).toEqual([5, 9]);
  });

  it("TM 내부 정밀도 보존: OHP 1RM 62.5 → TM 56.25 (반올림 전 값으로 계산)", () => {
    const result = sets(calculateTemplateSets(HYBRID_T2_TEMPLATE, kg(56.25), kg(2.5)));
    // 28.125→27.5, 33.75→35 (13.5단계 정확한 중간값 → 높은 쪽), 39.375→40
    expect(result.map((s) => s.targetWeight)).toEqual([27.5, 35, 40, 40, 40, 40, 40, 40]);
  });

  it("정확한 중간값은 높은 쪽 (H-12): TM 75 × 65% = 48.75 → 50", () => {
    expect(sets(calculateTemplateSets(HYBRID_T1_TEMPLATE, kg(75), kg(2.5)))[0].targetWeight).toBe(50);
  });

  it("부동소수점 잡음 없이 증가 단위의 정확한 배수", () => {
    const result = sets(calculateTemplateSets(HYBRID_T1_TEMPLATE, kg(126), kg(2.5)));
    for (const set of result) expect(Number.isInteger(set.targetWeight / 2.5)).toBe(true);
    expect(result.map((s) => s.targetWeight)).toEqual([82.5, 95, 107.5, 112.5, 120, 112.5, 107.5, 100, 95]);
  });

  it("lb 단위·다른 증가 단위를 그대로 따른다 (단위 변환 없음)", () => {
    const result = sets(calculateTemplateSets(HYBRID_T2_TEMPLATE, lb(200), lb(5)));
    expect(result.map((s) => s.targetWeight)).toEqual([100, 120, 140, 140, 140, 140, 140, 140]);
  });

  it.each([
    [kg(0), kg(2.5), "INVALID_TM"],
    [kg(Number.NaN), kg(2.5), "INVALID_TM"],
    [kg(90), kg(0), "INVALID_INCREMENT"],
    [kg(90), lb(5), "UNIT_MISMATCH"],
    [kg(1), kg(2.5), "NON_POSITIVE_RESULT"],
  ] as const)("TM %o / 증가 %o → %s", (tm, increment, error) => {
    expect(calculateTemplateSets(HYBRID_T1_TEMPLATE, tm, increment)).toEqual({ ok: false, error });
  });
});
