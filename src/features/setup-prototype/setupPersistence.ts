/**
 * Setup 화면 상태 ↔ 저장 계층(saveInitialSetup) 변환.
 *
 * - 화면 상태(SetupState, 문자열 입력)를 저장 입력(InitialSetupInput, 숫자·출처)으로 바꾸고,
 *   저장된 프로필을 다시 화면 상태로 복원한다.
 * - 1RM 출처: 4대 운동은 DIRECT(사용자 직접 입력, 측정 검증 아님), 추정 운동은
 *   ESTIMATE_ACCEPTED(추정값 확정) / USER_EDITED(사용자 수정) + 추정 규칙 ID. 확정 후에도 DIRECT로 바꾸지 않는다.
 * - 증가 단위(increment)는 FUNCTIONS 7.1의 "초기 제안값"이다. Setup에서 수정하는 UI는 아직 없다(SETUP.md 9장 미확정).
 */
import type { EquipmentType, ExerciseProfile, OneRepMaxSource } from "@/domain/types/model";
import { kg } from "@/domain/types/weight";
import type { ExerciseInput, InitializeProfileInput } from "@/storage/repositories/exerciseRepository";
import type { InitialSetupInput, SavedSetup } from "@/storage/repositories/setupRepository";
import { parsePositiveKg } from "@/lib/weightInput";
import {
  createInitialSetupState,
  DIRECT_LIFT_IDS,
  DIRECT_LIFTS,
  ESTIMATE_RULES,
  ESTIMATED_LIFT_IDS,
  getEffective1RM,
  T3_EXERCISES,
  T3_IDS,
  type DirectLiftId,
  type EstimatedLiftId,
  type SetupState,
  type T3ExerciseId,
} from "./setupModel";

type SetupExerciseId = DirectLiftId | EstimatedLiftId | T3ExerciseId;

/**
 * 운동별 장비와 증가 단위 초기 제안값 (FUNCTIONS 7.1 예시 범위 안에서 가장 작은 단계).
 * 덤벨은 한 손 기준(H-16). 실제 보유 장비와 다르면 후속 단계에서 수정 기능이 필요하다.
 */
export const SETUP_EQUIPMENT: Record<SetupExerciseId, { equipment: EquipmentType; increment: number }> = {
  bench_press: { equipment: "BARBELL", increment: 2.5 },
  deadlift: { equipment: "BARBELL", increment: 2.5 },
  squat: { equipment: "BARBELL", increment: 2.5 },
  ohp: { equipment: "BARBELL", increment: 2.5 },
  front_squat: { equipment: "BARBELL", increment: 2.5 },
  barbell_row: { equipment: "BARBELL", increment: 2.5 },
  incline_bench_press: { equipment: "BARBELL", increment: 2.5 },
  barbell_shrug: { equipment: "BARBELL", increment: 2.5 },
  cable_fly: { equipment: "CABLE", increment: 2.5 },
  leg_curl: { equipment: "MACHINE", increment: 2.5 },
  leg_extension: { equipment: "MACHINE", increment: 2.5 },
  dumbbell_lateral_raise: { equipment: "DUMBBELL", increment: 1 },
  lat_pulldown: { equipment: "CABLE", increment: 2.5 },
};

export const SETUP_EXERCISE_IDS: readonly SetupExerciseId[] = [...DIRECT_LIFT_IDS, ...ESTIMATED_LIFT_IDS, ...T3_IDS];

export const exerciseName = (id: string): string =>
  (DIRECT_LIFTS as Record<string, { name: string }>)[id]?.name ??
  (ESTIMATE_RULES as Record<string, { name: string }>)[id]?.name ??
  (T3_EXERCISES as Record<string, { name: string }>)[id]?.name ??
  id;

const exerciseInput = (id: SetupExerciseId): ExerciseInput => ({
  exerciseId: id,
  name: exerciseName(id),
  weightUnit: "kg",
  ...SETUP_EQUIPMENT[id],
});

/**
 * 확정된 Setup 상태를 저장 입력으로 바꾼다.
 * @returns 값이 하나라도 유효하지 않거나 확정 전 상태면 null (저장하지 않는다)
 */
export function buildInitialSetupInput(state: SetupState): InitialSetupInput | null {
  if (!state.completed) return null;
  const profiles: InitializeProfileInput[] = [];

  for (const id of DIRECT_LIFT_IDS) {
    const value = parsePositiveKg(state.direct[id]);
    if (value === null) return null;
    profiles.push({ exerciseId: id, oneRepMax: kg(value), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null });
  }
  for (const id of ESTIMATED_LIFT_IDS) {
    const entry = state.estimated[id];
    const value = getEffective1RM(state, id);
    // 확정 처리(COMPLETE) 후에는 자동 추정(ESTIMATE) 상태가 남지 않는다
    if (entry.source === "ESTIMATE" || value === null) return null;
    const source: OneRepMaxSource = entry.source === "ACCEPTED" ? "ESTIMATE_ACCEPTED" : "USER_EDITED";
    profiles.push({ exerciseId: id, oneRepMax: kg(value), oneRepMaxSource: source, estimateRuleId: ESTIMATE_RULES[id].ruleId, t3WorkingWeight: null });
  }
  for (const id of T3_IDS) {
    const value = parsePositiveKg(state.t3[id]);
    if (value === null) return null;
    profiles.push({ exerciseId: id, oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: kg(value) });
  }
  return { exercises: SETUP_EXERCISE_IDS.map(exerciseInput), profiles };
}

export type RestoredSetup =
  | { readonly kind: "none" }
  | { readonly kind: "complete"; readonly state: SetupState }
  /** 일부만 저장된 비정상 상태 (일괄 저장이라 정상 경로로는 생기지 않음) */
  | { readonly kind: "partial"; readonly missing: readonly string[] };

/** 숫자를 입력칸 문자열로 (부동소수점 잡음만 제거, 반올림 없음) */
const toText = (value: number) => String(Number(value.toPrecision(12)));

/** 저장된 설정을 완료 상태의 Setup 화면 상태로 복원한다 */
export function restoreSetupState(saved: SavedSetup): RestoredSetup {
  if (saved.profiles.length === 0) return { kind: "none" };
  const byId = new Map<string, ExerciseProfile>(saved.profiles.map((p) => [p.exerciseId, p]));
  const missing = SETUP_EXERCISE_IDS.filter((id) => !byId.has(id));
  if (missing.length > 0) return { kind: "partial", missing };

  const state = createInitialSetupState();
  for (const id of DIRECT_LIFT_IDS) state.direct[id] = toText(byId.get(id)?.oneRepMax ?? 0);
  for (const id of ESTIMATED_LIFT_IDS) {
    const profile = byId.get(id);
    const text = toText(profile?.oneRepMax ?? 0);
    state.estimated[id] = profile?.oneRepMaxSource === "USER_EDITED" ? { source: "EDITED", text } : { source: "ACCEPTED", text };
  }
  for (const id of T3_IDS) state.t3[id] = toText(byId.get(id)?.t3WorkingWeight ?? 0);
  return { kind: "complete", state: { ...state, step: 4, completed: true } };
}

export type ConfirmSetupResult =
  | { readonly ok: true; readonly state: SetupState }
  | { readonly ok: false; readonly message: string; readonly alreadySaved: boolean };

const SAVE_ERROR_MESSAGE: Partial<Record<string, string>> = {
  SETUP_ALREADY_EXISTS: "이미 저장된 설정이 있습니다. 기존 설정을 덮어쓰지 않았습니다.",
  STORAGE_ERROR: "기기 저장소에 저장하지 못했습니다. 저장 공간·사생활 보호 모드를 확인한 뒤 다시 시도해 주세요.",
};

/**
 * '이대로 확정' 처리. 확정될 값으로 저장을 먼저 시도하고, 성공했을 때만 완료 상태를 돌려준다.
 * 실패하면 화면 상태를 바꾸지 않도록 ok:false와 안내 문구만 돌려준다 (완료 화면으로 이동 금지).
 * @param completedState setupReducer(state, { type: "COMPLETE" }) 결과
 * @param save 저장 함수 (saveInitialSetup을 db에 묶은 것). 테스트에서 실패를 주입할 수 있다.
 */
export async function confirmSetup(
  completedState: SetupState,
  save: (input: InitialSetupInput) => Promise<{ ok: true } | { ok: false; error: string; message?: string }>,
): Promise<ConfirmSetupResult> {
  const input = buildInitialSetupInput(completedState);
  if (!input) return { ok: false, message: "입력값을 확인해 주세요.", alreadySaved: false };
  try {
    const result = await save(input);
    if (result.ok) return { ok: true, state: completedState };
    return {
      ok: false,
      message: SAVE_ERROR_MESSAGE[result.error] ?? `설정을 저장하지 못했습니다 (${result.error}). 다시 시도해 주세요.`,
      alreadySaved: result.error === "SETUP_ALREADY_EXISTS",
    };
  } catch {
    return { ok: false, message: SAVE_ERROR_MESSAGE.STORAGE_ERROR ?? "", alreadySaved: false };
  }
}
