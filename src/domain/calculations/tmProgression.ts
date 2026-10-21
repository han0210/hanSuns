/**
 * T1·T2 목표 달성 기반 TM 자동 증량 (CALCULATION_RULES H-22, nSuns Hybrid 자체 증량 정책).
 *
 * 원본 nSuns의 AMRAP 증량 규칙이 아니다. Hybrid 자체 정책:
 * - 운동의 모든 예정 세트가 완료되고, 각 세트의 실제 중량 ≥ 목표 중량, 실제 반복 ≥ 목표 반복이면 증량.
 *   AMRAP 세트의 목표 반복은 최소 반복(1+ → 1, 4+ → 4)이다.
 * - 한 세트라도 미달이면 TM 유지. 감량하지 않는다.
 * - 증량값은 운동별 고정 kg 값(HYBRID_TM_INCREMENTS)이며 1RM이 아니라 currentTM에 더한다.
 * - 판정 시점(하루 세션 정상 완료)과 중복 방지는 저장 계층(completeWorkoutSession)이 맡는다.
 */
import { err, kg, ok, type Mass, type Result } from "../types/weight";
import { isPositiveFinite, removeFloatNoise } from "./precision";

/** 증량 규칙 식별자 (TMChange.ruleId·ruleVersion에 기록) */
export const TM_PROGRESSION_RULE = { ruleId: "hybrid-target-progression", ruleVersion: 1 } as const;

/**
 * 운동별 다음 세션 TM 증량값 (kg). 여기 없는 운동(프론트 스쿼트·스모 데드리프트·인클라인·슈러그 등)은
 * 증량값이 확정되기 전까지 자동 증량하지 않는다.
 */
export const HYBRID_TM_INCREMENTS: Readonly<Record<string, Mass>> = {
  bench_press: kg(2.5),
  ohp: kg(2.5),
  barbell_row: kg(2.5),
  squat: kg(5),
  deadlift: kg(5),
};

export type TargetSetResult = {
  readonly setNumber: number;
  readonly completed: boolean;
  readonly targetWeight: Mass;
  /** 목표 반복. AMRAP이면 최소 반복 */
  readonly targetReps: number;
  readonly isAmrap: boolean;
  readonly actualWeight: Mass | null;
  readonly actualReps: number | null;
};

export type TargetHoldCode =
  | "NO_SETS"
  | "SET_INCOMPLETE"
  | "ACTUAL_WEIGHT_MISSING"
  | "ACTUAL_REPS_MISSING"
  | "WEIGHT_BELOW_TARGET"
  | "REPS_BELOW_TARGET";

export type TargetHoldReason = { readonly setNumber: number | null; readonly code: TargetHoldCode };

export type TargetDecision = { readonly decision: "INCREASE" | "HOLD"; readonly reasons: readonly TargetHoldReason[] };

/**
 * 운동 하나의 모든 세트가 목표를 달성했는지 판정한다.
 * "세트 완료"(completed)와 "목표 달성"은 다른 개념이다: 완료됐어도 실제값이 목표 미만이면 HOLD.
 */
export function evaluateTargetProgress(sets: readonly TargetSetResult[]): Result<TargetDecision, "UNIT_MISMATCH"> {
  if (sets.length === 0) return ok({ decision: "HOLD", reasons: [{ setNumber: null, code: "NO_SETS" }] });
  const unit = sets[0].targetWeight.unit;
  if (sets.some((s) => s.targetWeight.unit !== unit || (s.actualWeight !== null && s.actualWeight.unit !== unit))) return err("UNIT_MISMATCH");

  const reasons: TargetHoldReason[] = [];
  for (const set of [...sets].sort((a, b) => a.setNumber - b.setNumber)) {
    if (!set.completed) {
      reasons.push({ setNumber: set.setNumber, code: "SET_INCOMPLETE" });
      continue;
    }
    if (set.actualWeight === null) reasons.push({ setNumber: set.setNumber, code: "ACTUAL_WEIGHT_MISSING" });
    else if (set.actualWeight.value < set.targetWeight.value) reasons.push({ setNumber: set.setNumber, code: "WEIGHT_BELOW_TARGET" });
    if (set.actualReps === null) reasons.push({ setNumber: set.setNumber, code: "ACTUAL_REPS_MISSING" });
    else if (set.actualReps < set.targetReps) reasons.push({ setNumber: set.setNumber, code: "REPS_BELOW_TARGET" });
  }
  return ok(reasons.length === 0 ? { decision: "INCREASE", reasons: [] } : { decision: "HOLD", reasons });
}

/**
 * 다음 TM = currentTM + 증량값. TM은 반올림하지 않고 부동소수점 잡음만 제거한다(H-03).
 * 단위가 다르면(예: lb 프로필에 kg 증량값) UNIT_MISMATCH — 자동 변환하지 않는다.
 */
export function nextTrainingMax(
  currentTM: Mass,
  increment: Mass,
): Result<Mass, "INVALID_TM" | "INVALID_INCREMENT" | "UNIT_MISMATCH"> {
  if (!isPositiveFinite(currentTM.value)) return err("INVALID_TM");
  if (!isPositiveFinite(increment.value)) return err("INVALID_INCREMENT");
  if (currentTM.unit !== increment.unit) return err("UNIT_MISMATCH");
  return ok({ value: removeFloatNoise(currentTM.value + increment.value), unit: currentTM.unit });
}
