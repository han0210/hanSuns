/**
 * 최초 설정의 초기 1RM 추천값 (CALCULATION_RULES 3.6, H-15 — v0.8 승인).
 *
 * 4대 운동은 사용자가 1RM을 직접 입력하고(DIRECT), 나머지 운동은 기준 1RM × 비율로 추천한다.
 * 비율은 nSuns Hybrid MVP 초기 추천값이며 원본 nSuns 공식 환산 비율이 아니다.
 * 추천값은 사용자가 직접 입력한 1RM(DIRECT)과 다른 출처(source)로 유지한다.
 */
import type { OneRepMaxSource } from "../types/model";
import { err, ok, type Mass, type Result } from "../types/weight";
import { isPositiveFinite } from "./precision";

export type DirectLiftId = "bench_press" | "deadlift" | "squat" | "ohp";
export type EstimatedLiftId = "front_squat" | "barbell_row" | "incline_bench_press" | "barbell_shrug";
export type InitialLiftId = DirectLiftId | EstimatedLiftId;

export type InitialEstimateRule = {
  readonly ruleId: string;
  readonly baseExerciseId: InitialLiftId;
  readonly ratio: number;
};

export const INITIAL_1RM_ESTIMATE_RULES: Readonly<Record<EstimatedLiftId, InitialEstimateRule>> = {
  front_squat: { ruleId: "setup-front-squat-v1", baseExerciseId: "squat", ratio: 0.8 },
  barbell_row: { ruleId: "setup-barbell-row-v1", baseExerciseId: "deadlift", ratio: 0.55 },
  incline_bench_press: { ruleId: "setup-incline-bench-v1", baseExerciseId: "bench_press", ratio: 0.85 },
  barbell_shrug: { ruleId: "setup-barbell-shrug-v1", baseExerciseId: "barbell_row", ratio: 0.5 },
};

/** 슈러그가 로우를 기준으로 하므로 기준 운동이 먼저 오도록 순서를 고정한다 */
const ESTIMATE_ORDER: readonly EstimatedLiftId[] = ["front_squat", "barbell_row", "incline_bench_press", "barbell_shrug"];

/**
 * 기준 1RM에서 초기 1RM 추천값을 계산한다. 반올림하지 않고 기준값의 단위를 유지한다.
 */
export function estimateInitialOneRM(
  liftId: EstimatedLiftId,
  base1RM: Mass,
): Result<{ oneRepMax: Mass; ruleId: string }, "INVALID_BASE_1RM"> {
  if (!isPositiveFinite(base1RM.value)) return err("INVALID_BASE_1RM");
  const rule = INITIAL_1RM_ESTIMATE_RULES[liftId];
  return ok({ oneRepMax: { value: base1RM.value * rule.ratio, unit: base1RM.unit }, ruleId: rule.ruleId });
}

export type DirectOneRepMaxes = Readonly<Record<DirectLiftId, Mass>>;

/** 사용자가 추천값을 확정하거나 수정한 값 */
export type InitialOneRepMaxOverride = {
  readonly oneRepMax: Mass;
  readonly source: Exclude<OneRepMaxSource, "DIRECT">;
};

export type ResolvedOneRepMax = {
  readonly oneRepMax: Mass;
  /** null이면 아직 사용자가 확정하지 않은 자동 추천값 */
  readonly source: OneRepMaxSource | null;
  readonly estimateRuleId: string | null;
  readonly isEstimatePending: boolean;
};

export type ResolveError = "INVALID_DIRECT_1RM" | "INVALID_OVERRIDE_1RM";

/**
 * Setup 입력 전체에서 운동별 초기 1RM을 정한다.
 * - 직접 입력 4개: DIRECT
 * - 추천 운동: 사용자 확정·수정값이 있으면 그 값(출처 유지), 없으면 자동 추천값(source null)
 * - 슈러그는 바벨 로우의 결정된 값(사용자 값 우선)을 기준으로 한다
 * 사용자 값은 기준 1RM이 바뀌어도 다시 계산하지 않는다.
 */
export function resolveInitialOneRepMaxes(input: {
  direct: DirectOneRepMaxes;
  overrides: Partial<Record<EstimatedLiftId, InitialOneRepMaxOverride>>;
}): Result<Record<InitialLiftId, ResolvedOneRepMax>, ResolveError> {
  const resolved = {} as Record<InitialLiftId, ResolvedOneRepMax>;

  for (const id of Object.keys(input.direct) as DirectLiftId[]) {
    const oneRepMax = input.direct[id];
    if (!isPositiveFinite(oneRepMax.value)) return err("INVALID_DIRECT_1RM");
    resolved[id] = { oneRepMax, source: "DIRECT", estimateRuleId: null, isEstimatePending: false };
  }

  for (const id of ESTIMATE_ORDER) {
    const rule = INITIAL_1RM_ESTIMATE_RULES[id];
    const override = input.overrides[id];
    if (override) {
      if (!isPositiveFinite(override.oneRepMax.value)) return err("INVALID_OVERRIDE_1RM");
      resolved[id] = { oneRepMax: override.oneRepMax, source: override.source, estimateRuleId: rule.ruleId, isEstimatePending: false };
      continue;
    }
    const estimate = estimateInitialOneRM(id, resolved[rule.baseExerciseId].oneRepMax);
    if (!estimate.ok) return err("INVALID_DIRECT_1RM");
    resolved[id] = { oneRepMax: estimate.value.oneRepMax, source: null, estimateRuleId: rule.ruleId, isEstimatePending: true };
  }

  return ok(resolved);
}
