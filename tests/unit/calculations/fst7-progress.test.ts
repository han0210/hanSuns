import { describe, expect, it } from "vitest";
import { evaluateFST7Progress, FST7_SET_COUNT, FST7_TARGET_REPS, type Fst7SetResult } from "@/domain/calculations/fst7Progress";
import { kg, lb } from "@/domain/types/weight";

const fullSets = (weight = 30, reps = 12): Fst7SetResult[] =>
  Array.from({ length: 7 }, (_, index) => ({
    setNumber: index + 1,
    completed: true,
    actualWeight: kg(weight),
    actualReps: reps,
  }));

const evaluate = (sets: Fst7SetResult[], working = kg(30), increment = kg(2.5)) =>
  evaluateFST7Progress({ workingWeightAtSession: working, increment, sets });

describe("evaluateFST7Progress (H-09, H-10)", () => {
  it("구조 상수: 7세트 × 12회", () => {
    expect(FST7_SET_COUNT).toBe(7);
    expect(FST7_TARGET_REPS).toBe(12);
  });

  it("7세트 모두 30kg × 12회 → 32.5kg로 증량", () => {
    expect(evaluate(fullSets())).toEqual({ ok: true, value: { decision: "INCREASE", nextWorkingWeight: kg(32.5), reasons: [] } });
  });

  it("12회 초과도 한 단계만 증량 (30 × 15 → 32.5)", () => {
    const result = evaluate(fullSets(30, 15));
    expect(result.ok && result.value.nextWorkingWeight).toEqual(kg(32.5));
  });

  it("15kg / 증가 2kg → 17kg", () => {
    const result = evaluate(fullSets(15), kg(15), kg(2));
    expect(result.ok && result.value.nextWorkingWeight).toEqual(kg(17));
  });

  it("소수 증가 단위도 오차 없이 더한다 (1.1 + 0.1 = 1.2)", () => {
    const result = evaluate(fullSets(1.1), kg(1.1), kg(0.1));
    expect(result.ok && result.value.nextWorkingWeight).toEqual(kg(1.2));
  });

  const holdCases: [string, (sets: Fst7SetResult[]) => Fst7SetResult[], { setNumber: number | null; code: string }][] = [
    ["세트 미완료", (s) => s.map((x) => (x.setNumber === 7 ? { ...x, completed: false } : x)), { setNumber: 7, code: "SET_INCOMPLETE" }],
    ["실제 중량 누락", (s) => s.map((x) => (x.setNumber === 3 ? { ...x, actualWeight: null } : x)), { setNumber: 3, code: "ACTUAL_WEIGHT_MISSING" }],
    ["반복 누락", (s) => s.map((x) => (x.setNumber === 2 ? { ...x, actualReps: null } : x)), { setNumber: 2, code: "ACTUAL_REPS_MISSING" }],
    ["반복 미달 11회", (s) => s.map((x) => (x.setNumber === 1 ? { ...x, actualReps: 11 } : x)), { setNumber: 1, code: "REPS_BELOW_TARGET" }],
    ["실제 중량 부족 27.5", (s) => s.map((x) => (x.setNumber === 5 ? { ...x, actualWeight: kg(27.5) } : x)), { setNumber: 5, code: "WEIGHT_BELOW_TARGET" }],
    ["6세트만 기록", (s) => s.slice(0, 6), { setNumber: null, code: "SET_COUNT_MISMATCH" }],
  ];

  it.each(holdCases)("%s → 유지(30kg) + 사유 구분", (_name, mutate, reason) => {
    const result = evaluate(mutate(fullSets()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("HOLD");
    expect(result.value.nextWorkingWeight).toEqual(kg(30));
    expect(result.value.reasons).toContainEqual(reason);
  });

  it("여러 사유를 모두 돌려준다", () => {
    const sets = fullSets().map((x) =>
      x.setNumber === 1 ? { ...x, actualReps: 10 } : x.setNumber === 2 ? { ...x, completed: false } : x,
    );
    const result = evaluate(sets);
    expect(result.ok && result.value.reasons).toEqual([
      { setNumber: 1, code: "REPS_BELOW_TARGET" },
      { setNumber: 2, code: "SET_INCOMPLETE" },
    ]);
  });

  it("세트 번호 중복도 SET_COUNT_MISMATCH", () => {
    const sets = fullSets().map((x) => (x.setNumber === 7 ? { ...x, setNumber: 6 } : x));
    const result = evaluate(sets);
    expect(result.ok && result.value.reasons).toContainEqual({ setNumber: null, code: "SET_COUNT_MISMATCH" });
  });

  it("작업 중량과 증가 단위 단위가 다르면 UNIT_MISMATCH", () => {
    expect(evaluate(fullSets(), kg(30), lb(5))).toEqual({ ok: false, error: "UNIT_MISMATCH" });
  });

  it("세트 실제 중량 단위가 다르면 UNIT_MISMATCH", () => {
    const sets = fullSets().map((x) => (x.setNumber === 4 ? { ...x, actualWeight: lb(66) } : x));
    expect(evaluate(sets)).toEqual({ ok: false, error: "UNIT_MISMATCH" });
  });

  it.each([0, -1, Number.NaN])("작업 중량 %d → INVALID_WORKING_WEIGHT", (value) => {
    expect(evaluate(fullSets(), kg(value))).toEqual({ ok: false, error: "INVALID_WORKING_WEIGHT" });
  });

  it.each([0, Number.POSITIVE_INFINITY])("증가 단위 %d → INVALID_INCREMENT", (value) => {
    expect(evaluate(fullSets(), kg(30), kg(value))).toEqual({ ok: false, error: "INVALID_INCREMENT" });
  });
});
