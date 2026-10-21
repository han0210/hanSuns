import { describe, expect, it } from "vitest";
import {
  evaluateTargetProgress,
  HYBRID_TM_INCREMENTS,
  nextTrainingMax,
  TM_PROGRESSION_RULE,
  type TargetSetResult,
} from "@/domain/calculations/tmProgression";
import { kg, lb } from "@/domain/types/weight";

/** 벤치 TM 90 Hybrid T1 목표 (57.5×8 … 67.5×4+) */
const TARGETS: [number, number][] = [[57.5, 8], [67.5, 6], [77.5, 4], [80, 2], [85, 1], [80, 3], [77.5, 5], [72.5, 7], [67.5, 4]];
const AMRAP = new Set([5, 9]);
const allHit = (): TargetSetResult[] =>
  TARGETS.map(([w, r], i) => ({ setNumber: i + 1, completed: true, targetWeight: kg(w), targetReps: r, isAmrap: AMRAP.has(i + 1), actualWeight: kg(w), actualReps: r }));
const decide = (sets: TargetSetResult[]) => {
  const result = evaluateTargetProgress(sets);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("Hybrid T1·T2 TM 증량값 (H-22, nSuns Hybrid 자체 정책)", () => {
  it("벤치·OHP·바벨 로우 +2.5kg, 백 스쿼트·컨벤셔널 데드리프트 +5kg, 그 외는 정책 없음", () => {
    expect(HYBRID_TM_INCREMENTS).toEqual({
      bench_press: kg(2.5),
      ohp: kg(2.5),
      barbell_row: kg(2.5),
      squat: kg(5),
      deadlift: kg(5),
    });
    for (const id of ["front_squat", "sumo_deadlift", "incline_bench_press", "barbell_shrug"]) {
      expect((HYBRID_TM_INCREMENTS as Record<string, unknown>)[id]).toBeUndefined();
    }
    expect(TM_PROGRESSION_RULE).toEqual({ ruleId: "hybrid-target-progression", ruleVersion: 1 });
  });
});

describe("evaluateTargetProgress — 모든 세트 목표 달성 판정", () => {
  it("모든 세트가 목표 중량·반복 이상이면 INCREASE", () => {
    expect(decide(allHit())).toEqual({ decision: "INCREASE", reasons: [] });
  });

  it("목표보다 더 많이·더 무겁게 해도 INCREASE", () => {
    const sets = allHit().map((s) => ({ ...s, actualWeight: kg(s.targetWeight.value + 2.5), actualReps: s.targetReps + 2 }));
    expect(decide(sets).decision).toBe("INCREASE");
  });

  it("AMRAP 세트는 최소 반복(1+, 4+) 이상이면 성공, 많이 해도 성공", () => {
    const sets = allHit().map((s) => (s.isAmrap ? { ...s, actualReps: s.targetReps + 5 } : s));
    expect(decide(sets).decision).toBe("INCREASE");
  });

  it("AMRAP 최소 반복 미달(4+ 세트에서 3회)이면 HOLD", () => {
    const sets = allHit().map((s) => (s.setNumber === 9 ? { ...s, actualReps: 3 } : s));
    expect(decide(sets)).toEqual({ decision: "HOLD", reasons: [{ setNumber: 9, code: "REPS_BELOW_TARGET" }] });
  });

  it("반복 1회 부족이면 HOLD", () => {
    const sets = allHit().map((s) => (s.setNumber === 1 ? { ...s, actualReps: 7 } : s));
    expect(decide(sets)).toEqual({ decision: "HOLD", reasons: [{ setNumber: 1, code: "REPS_BELOW_TARGET" }] });
  });

  it("실제 중량이 목표보다 낮으면 HOLD (반복은 충족해도)", () => {
    const sets = allHit().map((s) => (s.setNumber === 4 ? { ...s, actualWeight: kg(77.5), actualReps: 5 } : s));
    expect(decide(sets)).toEqual({ decision: "HOLD", reasons: [{ setNumber: 4, code: "WEIGHT_BELOW_TARGET" }] });
  });

  it("세트 완료와 목표 달성은 다르다: 미완료 세트·실제값 누락은 각각 사유로 HOLD", () => {
    const sets = allHit().map((s) => {
      if (s.setNumber === 2) return { ...s, completed: false, actualWeight: null, actualReps: null };
      if (s.setNumber === 3) return { ...s, actualWeight: null };
      if (s.setNumber === 6) return { ...s, actualReps: null };
      return s;
    });
    expect(decide(sets)).toEqual({
      decision: "HOLD",
      reasons: [
        { setNumber: 2, code: "SET_INCOMPLETE" },
        { setNumber: 3, code: "ACTUAL_WEIGHT_MISSING" },
        { setNumber: 6, code: "ACTUAL_REPS_MISSING" },
      ],
    });
  });

  it("세트가 없으면 HOLD (NO_SETS)", () => {
    expect(decide([])).toEqual({ decision: "HOLD", reasons: [{ setNumber: null, code: "NO_SETS" }] });
  });

  it("목표·실제 중량 단위가 섞이면 UNIT_MISMATCH 오류 (자동 변환 없음)", () => {
    const sets = allHit().map((s) => (s.setNumber === 1 ? { ...s, actualWeight: lb(130) } : s));
    expect(evaluateTargetProgress(sets)).toEqual({ ok: false, error: "UNIT_MISMATCH" });
  });
});

describe("nextTrainingMax — currentTM + 증량값 (TM 정밀도 유지, 반올림 없음)", () => {
  it("90 + 2.5 = 92.5, 126 + 5 = 131", () => {
    expect(nextTrainingMax(kg(90), kg(2.5))).toEqual({ ok: true, value: kg(92.5) });
    expect(nextTrainingMax(kg(126), kg(5))).toEqual({ ok: true, value: kg(131) });
  });

  it("반올림하지 않은 TM의 소수 정밀도를 유지하고 부동소수점 잡음만 제거", () => {
    expect(nextTrainingMax(kg(56.25), kg(2.5))).toEqual({ ok: true, value: kg(58.75) });
    expect(nextTrainingMax(kg(0.1 + 0.2), kg(2.5))).toEqual({ ok: true, value: kg(2.8) });
  });

  it("lb TM에 kg 증량값은 UNIT_MISMATCH (lb 정책 확정 전 자동 증량 금지)", () => {
    expect(nextTrainingMax(lb(200), kg(2.5))).toEqual({ ok: false, error: "UNIT_MISMATCH" });
  });

  it("잘못된 TM·증량값은 오류", () => {
    expect(nextTrainingMax(kg(0), kg(2.5))).toEqual({ ok: false, error: "INVALID_TM" });
    expect(nextTrainingMax(kg(90), kg(0))).toEqual({ ok: false, error: "INVALID_INCREMENT" });
  });
});
