/**
 * T3 FST-7 다음 세션 작업 중량 판정 (CALCULATION_RULES 8.1·8.3, H-09·H-10).
 *
 * 7세트 모두 완료 + 각 세트 12회 이상 + 실제 중량이 세션 시작 작업 중량 이상이면
 * 증가 단위만큼 한 단계 올리고, 하나라도 아니면 유지한다. 감량은 하지 않는다(8.5).
 * 판정 시점(하루 세션 완료)과 중복 적용 방지는 호출하는 쪽(저장 계층)이 책임진다.
 */
import { err, ok, type Mass, type Result } from "../types/weight";
import { isPositiveFinite, removeFloatNoise } from "./precision";

export const FST7_SET_COUNT = 7;
export const FST7_TARGET_REPS = 12;

export type Fst7SetResult = {
  readonly setNumber: number;
  readonly completed: boolean;
  readonly actualWeight: Mass | null;
  readonly actualReps: number | null;
};

export type Fst7HoldCode =
  | "SET_COUNT_MISMATCH"
  | "SET_INCOMPLETE"
  | "ACTUAL_WEIGHT_MISSING"
  | "ACTUAL_REPS_MISSING"
  | "REPS_BELOW_TARGET"
  | "WEIGHT_BELOW_TARGET";

export type Fst7HoldReason = { readonly setNumber: number | null; readonly code: Fst7HoldCode };

export type Fst7Decision = {
  readonly decision: "INCREASE" | "HOLD";
  readonly nextWorkingWeight: Mass;
  readonly reasons: readonly Fst7HoldReason[];
};

export type Fst7Error = "UNIT_MISMATCH" | "INVALID_WORKING_WEIGHT" | "INVALID_INCREMENT";

export function evaluateFST7Progress(input: {
  workingWeightAtSession: Mass;
  increment: Mass;
  sets: readonly Fst7SetResult[];
}): Result<Fst7Decision, Fst7Error> {
  const { workingWeightAtSession: working, increment, sets } = input;
  if (working.unit !== increment.unit) return err("UNIT_MISMATCH");
  if (sets.some((set) => set.actualWeight !== null && set.actualWeight.unit !== working.unit)) return err("UNIT_MISMATCH");
  if (!isPositiveFinite(working.value)) return err("INVALID_WORKING_WEIGHT");
  if (!isPositiveFinite(increment.value)) return err("INVALID_INCREMENT");

  const reasons: Fst7HoldReason[] = [];
  const setNumbers = new Set(sets.map((set) => set.setNumber));
  const hasExactSets =
    sets.length === FST7_SET_COUNT &&
    setNumbers.size === FST7_SET_COUNT &&
    Array.from({ length: FST7_SET_COUNT }, (_, i) => i + 1).every((n) => setNumbers.has(n));
  if (!hasExactSets) reasons.push({ setNumber: null, code: "SET_COUNT_MISMATCH" });

  for (const set of [...sets].sort((a, b) => a.setNumber - b.setNumber)) {
    if (!set.completed) {
      reasons.push({ setNumber: set.setNumber, code: "SET_INCOMPLETE" });
      continue;
    }
    if (set.actualWeight === null) reasons.push({ setNumber: set.setNumber, code: "ACTUAL_WEIGHT_MISSING" });
    else if (set.actualWeight.value < working.value) reasons.push({ setNumber: set.setNumber, code: "WEIGHT_BELOW_TARGET" });
    if (set.actualReps === null) reasons.push({ setNumber: set.setNumber, code: "ACTUAL_REPS_MISSING" });
    else if (set.actualReps < FST7_TARGET_REPS) reasons.push({ setNumber: set.setNumber, code: "REPS_BELOW_TARGET" });
  }

  if (reasons.length > 0) return ok({ decision: "HOLD", nextWorkingWeight: working, reasons });
  return ok({
    decision: "INCREASE",
    nextWorkingWeight: { value: removeFloatNoise(working.value + increment.value), unit: working.unit },
    reasons: [],
  });
}
