import { describe, expect, it } from "vitest";
import {
  estimateInitialOneRM,
  INITIAL_1RM_ESTIMATE_RULES,
  resolveInitialOneRepMaxes,
  type DirectOneRepMaxes,
} from "@/domain/calculations/initialOneRepMax";
import { kg, lb } from "@/domain/types/weight";

const direct: DirectOneRepMaxes = {
  bench_press: kg(100),
  deadlift: kg(140),
  squat: kg(120),
  ohp: kg(62.5),
};

const valueOf = (result: ReturnType<typeof estimateInitialOneRM>) => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("INITIAL_1RM_ESTIMATE_RULES (H-15 v0.8 승인, H-19 스모 v0.13 확정)", () => {
  it("승인된 5개 비율과 기준 운동", () => {
    expect(INITIAL_1RM_ESTIMATE_RULES).toMatchObject({
      front_squat: { baseExerciseId: "squat", ratio: 0.8 },
      barbell_row: { baseExerciseId: "deadlift", ratio: 0.55 },
      incline_bench_press: { baseExerciseId: "bench_press", ratio: 0.85 },
      barbell_shrug: { baseExerciseId: "barbell_row", ratio: 0.5 },
      sumo_deadlift: { baseExerciseId: "deadlift", ratio: 0.5, ruleId: "setup-sumo-deadlift-v1" },
    });
  });
});

describe("estimateInitialOneRM", () => {
  it.each([
    ["front_squat", 120, 96],
    ["barbell_row", 140, 77],
    ["incline_bench_press", 100, 85],
    ["barbell_shrug", 77, 38.5],
    ["sumo_deadlift", 140, 70],
    ["sumo_deadlift", 187.5, 93.75],
  ] as const)("%s: 기준 %d → %d", (liftId, base, expected) => {
    const estimate = valueOf(estimateInitialOneRM(liftId, kg(base)));
    expect(estimate.oneRepMax.value).toBeCloseTo(expected, 10);
    expect(estimate.oneRepMax.unit).toBe("kg");
    expect(estimate.ruleId).toBe(INITIAL_1RM_ESTIMATE_RULES[liftId].ruleId);
  });

  it("단위를 유지한다", () => {
    expect(valueOf(estimateInitialOneRM("front_squat", lb(300))).oneRepMax).toEqual(lb(240));
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("기준 %d → INVALID_BASE_1RM", (base) => {
    expect(estimateInitialOneRM("front_squat", kg(base))).toEqual({ ok: false, error: "INVALID_BASE_1RM" });
  });
});

describe("resolveInitialOneRepMaxes", () => {
  const resolve = (overrides: Parameters<typeof resolveInitialOneRepMaxes>[0]["overrides"] = {}) => {
    const result = resolveInitialOneRepMaxes({ direct, overrides });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it("직접 입력 4개는 DIRECT, 나머지는 자동 추정(출처 null) + 규칙 ID", () => {
    const resolved = resolve();
    expect(resolved.bench_press).toEqual({ oneRepMax: kg(100), source: "DIRECT", estimateRuleId: null, isEstimatePending: false });
    expect(resolved.barbell_row.source).toBeNull();
    expect(resolved.barbell_row.isEstimatePending).toBe(true);
    expect(resolved.barbell_row.estimateRuleId).toBe("setup-barbell-row-v1");
    expect(resolved.barbell_row.oneRepMax.value).toBeCloseTo(77, 10);
    expect(resolved.barbell_shrug.oneRepMax.value).toBeCloseTo(38.5, 10);
  });

  it("바벨 로우를 사용자가 90으로 수정하면 슈러그 추천값은 45", () => {
    const resolved = resolve({ barbell_row: { oneRepMax: kg(90), source: "USER_EDITED" } });
    expect(resolved.barbell_row).toEqual({
      oneRepMax: kg(90),
      source: "USER_EDITED",
      estimateRuleId: "setup-barbell-row-v1",
      isEstimatePending: false,
    });
    expect(resolved.barbell_shrug.oneRepMax.value).toBeCloseTo(45, 10);
  });

  it("사용자 확정·수정값은 기준 1RM이 바뀌어도 그대로다", () => {
    const overrides = {
      front_squat: { oneRepMax: kg(100), source: "USER_EDITED" as const },
      barbell_row: { oneRepMax: kg(77), source: "ESTIMATE_ACCEPTED" as const },
    };
    const result = resolveInitialOneRepMaxes({ direct: { ...direct, squat: kg(150), deadlift: kg(200) }, overrides });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.front_squat.oneRepMax).toEqual(kg(100));
    expect(result.value.barbell_row.oneRepMax).toEqual(kg(77));
    expect(result.value.barbell_row.source).toBe("ESTIMATE_ACCEPTED");
  });

  it("확정·수정해도 출처가 DIRECT(측정 1RM)로 바뀌지 않는다", () => {
    const resolved = resolve({ incline_bench_press: { oneRepMax: kg(85), source: "ESTIMATE_ACCEPTED" } });
    expect(resolved.incline_bench_press.source).toBe("ESTIMATE_ACCEPTED");
    expect(resolved.incline_bench_press.source).not.toBe("DIRECT");
  });

  it("다른 운동 값은 영향받지 않는다", () => {
    const base = resolve();
    const edited = resolve({ front_squat: { oneRepMax: kg(100), source: "USER_EDITED" } });
    expect(edited.incline_bench_press).toEqual(base.incline_bench_press);
    expect(edited.barbell_row).toEqual(base.barbell_row);
  });

  it("직접 입력값이 잘못되면 INVALID_DIRECT_1RM", () => {
    expect(resolveInitialOneRepMaxes({ direct: { ...direct, ohp: kg(0) }, overrides: {} })).toEqual({
      ok: false,
      error: "INVALID_DIRECT_1RM",
    });
  });

  it("수정값이 잘못되면 INVALID_OVERRIDE_1RM", () => {
    expect(
      resolveInitialOneRepMaxes({ direct, overrides: { barbell_row: { oneRepMax: kg(-1), source: "USER_EDITED" } } }),
    ).toEqual({ ok: false, error: "INVALID_OVERRIDE_1RM" });
  });
});

describe("스모 데드리프트 초기 추정 (U-18 → H-19)", () => {
  it("자동 추정: 컨벤셔널 데드리프트 1RM × 0.50, 확정 전에는 출처 없음(측정값 아님)", () => {
    const result = resolveInitialOneRepMaxes({ direct, overrides: {} });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.sumo_deadlift).toMatchObject({
      oneRepMax: kg(70),
      source: null,
      estimateRuleId: "setup-sumo-deadlift-v1",
      isEstimatePending: true,
    });
  });

  it("사용자가 확정·수정한 스모 값은 데드리프트 1RM이 바뀌어도 유지되고 DIRECT로 바뀌지 않는다", () => {
    const overrides = { sumo_deadlift: { oneRepMax: kg(80), source: "USER_EDITED" as const } };
    const before = resolveInitialOneRepMaxes({ direct, overrides });
    const after = resolveInitialOneRepMaxes({ direct: { ...direct, deadlift: kg(200) }, overrides });
    if (!before.ok || !after.ok) throw new Error("unexpected");
    expect(after.value.sumo_deadlift).toEqual(before.value.sumo_deadlift);
    expect(after.value.sumo_deadlift).toMatchObject({ oneRepMax: kg(80), source: "USER_EDITED", estimateRuleId: "setup-sumo-deadlift-v1" });
    // 확정하지 않은 다른 추정값(로우)은 새 기준으로 다시 계산된다
    expect(after.value.barbell_row.oneRepMax.value).toBeCloseTo(110, 10);
  });
});
