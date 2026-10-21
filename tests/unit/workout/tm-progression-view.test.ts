import { describe, expect, it } from "vitest";
import { describeTmProgression, tmIncrementLabel } from "@/features/workout/sessionMapper";
import type { TMProgressionOutcome } from "@/storage/repositories/workoutRepository";

const base: TMProgressionOutcome = { exerciseId: "bench_press", tiers: ["T1"], sessionExerciseIds: ["s:T1:bench_press"], status: "INCREASED", fromTM: 90, toTM: 92.5, unit: "kg", reasons: [] };

describe("TM 증량 결과 화면 문구 (저장 결과만 표시)", () => {
  it("증량: 이전 TM 90kg → 다음 TM 92.5kg", () => {
    expect(describeTmProgression(base)).toEqual({ achieved: true, tmLine: "이전 TM 90kg → 다음 TM 92.5kg", reason: null });
  });

  it("목표 미달: '목표 미달 — 다음 운동 중량 유지'와 세트별 사유", () => {
    const view = describeTmProgression({ ...base, status: "HELD", toTM: 90, reasons: [{ tier: "T1", setNumber: 3, code: "REPS_BELOW_TARGET" }, { tier: "T1", setNumber: 5, code: "WEIGHT_BELOW_TARGET" }] });
    expect(view.achieved).toBe(false);
    expect(view.tmLine).toBe("TM 90kg 유지");
    expect(view.reason).toBe("목표 미달 — 다음 운동 중량 유지 (T1 3세트 반복 미달, T1 5세트 중량 미달)");
  });

  it("사유가 많으면 3개까지 보여주고 나머지는 건수로", () => {
    const reasons = [1, 2, 3, 4, 5].map((n) => ({ tier: "T2" as const, setNumber: n, code: "REPS_BELOW_TARGET" as const }));
    expect(describeTmProgression({ ...base, status: "HELD", toTM: 90, reasons }).reason).toContain("외 2건");
  });

  it("정책 없음·lb·이미 반영은 증량 없이 유지로 표시", () => {
    expect(describeTmProgression({ ...base, exerciseId: "front_squat", status: "NO_POLICY", fromTM: 86.4, toTM: 86.4 })).toMatchObject({ achieved: false, tmLine: "TM 86.4kg 유지" });
    expect(describeTmProgression({ ...base, status: "UNIT_NOT_SUPPORTED", unit: "lb", fromTM: 202.5, toTM: 202.5 }).reason).toContain("lb");
    expect(describeTmProgression({ ...base, status: "ALREADY_APPLIED", toTM: 90 }).achieved).toBe(false);
  });

  it("시작 화면 증량 안내: 정책 있는 운동만 +증량값", () => {
    expect(tmIncrementLabel("bench_press")).toBe("목표 달성 시 TM +2.5kg");
    expect(tmIncrementLabel("deadlift")).toBe("목표 달성 시 TM +5kg");
    expect(tmIncrementLabel("incline_bench_press")).toBeNull();
  });
});
