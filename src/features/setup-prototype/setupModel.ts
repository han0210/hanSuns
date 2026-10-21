/**
 * 최초 설정(Setup) 프로토타입의 상태와 순수 계산.
 *
 * - 추정 비율은 nSuns Hybrid MVP 초기 1RM 추천값이다 (CALCULATION_RULES.md 3.6절, H-15).
 *   원본 nSuns 공식 환산 비율이 아니며, T1/T2 세트별 강도 비율(원본 템플릿)과도 무관하다.
 * - 이 파일은 화면 상태만 다룬다. 저장 변환은 setupPersistence.ts, 저장은 storage/repositories가 맡는다.
 *   (/prototype/setup은 저장하지 않는 Mock, /setup은 Dexie에 저장)
 */

import { parsePositiveKg } from "@/lib/weightInput";

/** 초기 TM 비율 [Hybrid H-01] */
export const INITIAL_TM_RATIO = 0.9;

export const initialTM = (oneRepMax: number): number => oneRepMax * INITIAL_TM_RATIO;

// ---------------------------------------------------------------------------
// 운동 목록
// ---------------------------------------------------------------------------

export type DirectLiftId = "bench_press" | "deadlift" | "squat" | "ohp";
export type EstimatedLiftId = "front_squat" | "barbell_row" | "incline_bench_press" | "barbell_shrug" | "sumo_deadlift";
export type T3ExerciseId =
  | "cable_fly"
  | "leg_curl"
  | "leg_extension"
  | "dumbbell_lateral_raise"
  | "lat_pulldown";

type LiftInfo = { name: string; usage: string };

/** 사용자가 1RM을 직접 입력하는 4대 운동 */
export const DIRECT_LIFTS: Record<DirectLiftId, LiftInfo> = {
  bench_press: { name: "벤치프레스", usage: "월 T1" },
  deadlift: { name: "데드리프트 (컨벤셔널)", usage: "화 T1" },
  squat: { name: "백 스쿼트", usage: "목 T1" },
  ohp: { name: "OHP", usage: "금 T1 · 월 T2 (공통 TM)" },
};
export const DIRECT_LIFT_IDS = Object.keys(DIRECT_LIFTS) as DirectLiftId[];

export type EstimateRule = LiftInfo & {
  /** 기준 운동. 슈러그는 바벨 로우의 기준 1RM(사용자 확정값 우선)을 쓴다 */
  baseId: DirectLiftId | EstimatedLiftId;
  ratio: number;
  /** 문서 추적용 규칙 ID (FUNCTIONS 3.4 estimate_rule_id 제안) */
  ruleId: string;
};

/** nSuns Hybrid MVP 초기 1RM 추천 비율 (STEP 07 승인, 스모는 H-19 확정). 원본 nSuns 공식 비율이 아니다. */
export const ESTIMATE_RULES: Record<EstimatedLiftId, EstimateRule> = {
  front_squat: { name: "프론트 스쿼트", usage: "화 T2", baseId: "squat", ratio: 0.8, ruleId: "setup-front-squat-v1" },
  barbell_row: { name: "바벨 로우", usage: "토 T1 (Hybrid)", baseId: "deadlift", ratio: 0.55, ruleId: "setup-barbell-row-v1" },
  incline_bench_press: { name: "인클라인 벤치프레스", usage: "금 T2", baseId: "bench_press", ratio: 0.85, ruleId: "setup-incline-bench-v1" },
  barbell_shrug: { name: "바벨 슈러그", usage: "토 T2", baseId: "barbell_row", ratio: 0.5, ruleId: "setup-barbell-shrug-v1" },
  sumo_deadlift: { name: "스모 데드리프트", usage: "목 T2", baseId: "deadlift", ratio: 0.5, ruleId: "setup-sumo-deadlift-v1" },
};
export const ESTIMATED_LIFT_IDS = Object.keys(ESTIMATE_RULES) as EstimatedLiftId[];

export const T3_EXERCISES: Record<T3ExerciseId, LiftInfo & { note?: string }> = {
  cable_fly: { name: "케이블 플라이", usage: "월 T3" },
  leg_curl: { name: "레그 컬", usage: "화 T3" },
  leg_extension: { name: "레그 익스텐션", usage: "목 T3" },
  dumbbell_lateral_raise: {
    name: "덤벨 사이드 레터럴 레이즈",
    usage: "금 T3",
    note: "한 손 기준 중량으로 입력 (양손 합산하지 않음)",
  },
  lat_pulldown: { name: "랫풀다운", usage: "토 T3" },
};
export const T3_IDS = Object.keys(T3_EXERCISES) as T3ExerciseId[];

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

/**
 * 추정 운동의 1RM 출처 (직접 입력한 4대 운동의 1RM과 구분한다)
 * - ESTIMATE: 자동 추정값 (기준 운동이 바뀌면 다시 계산)
 * - ACCEPTED: 추정값을 사용자가 확정 (이후 자동 변경 없음)
 * - EDITED: 사용자가 수정한 값 (이후 자동 변경 없음)
 * 확정·수정해도 측정 1RM(직접 입력)으로 바뀌지 않는다.
 */
export type EstimatedEntry =
  | { source: "ESTIMATE" }
  | { source: "ACCEPTED" | "EDITED"; text: string };

export type SetupStep = 1 | 2 | 3 | 4;

export type SetupState = {
  step: SetupStep;
  direct: Record<DirectLiftId, string>;
  estimated: Record<EstimatedLiftId, EstimatedEntry>;
  t3: Record<T3ExerciseId, string>;
  completed: boolean;
};

const mapIds = <K extends string, V>(ids: readonly K[], value: () => V) =>
  Object.fromEntries(ids.map((id) => [id, value()])) as Record<K, V>;

export function createInitialSetupState(): SetupState {
  return {
    step: 1,
    direct: mapIds(DIRECT_LIFT_IDS, () => ""),
    estimated: mapIds(ESTIMATED_LIFT_IDS, (): EstimatedEntry => ({ source: "ESTIMATE" })),
    t3: mapIds(T3_IDS, () => ""),
    completed: false,
  };
}

// ---------------------------------------------------------------------------
// 계산 (순수 함수)
// ---------------------------------------------------------------------------

/** 직접 입력 1RM. 유효하지 않으면 null */
export const getDirect1RM = (state: SetupState, id: DirectLiftId): number | null =>
  parsePositiveKg(state.direct[id]);

const isDirectId = (id: string): id is DirectLiftId => id in DIRECT_LIFTS;

/**
 * 운동의 현재 1RM 값.
 * - 직접 입력 운동: 입력값
 * - 추정 운동: 사용자 확정·수정값이 있으면 그 값, 없으면 기준 운동 1RM × 비율
 * 슈러그처럼 다른 추정 운동을 기준으로 하면 그 운동의 현재 1RM(사용자 확정값 우선)을 쓴다.
 */
export function getEffective1RM(state: SetupState, id: DirectLiftId | EstimatedLiftId): number | null {
  if (isDirectId(id)) return getDirect1RM(state, id);
  const entry = state.estimated[id];
  if (entry.source !== "ESTIMATE") return parsePositiveKg(entry.text);
  return getEstimate1RM(state, id);
}

/** 자동 추정값 (사용자 확정 여부와 무관하게 현재 기준값으로 계산) */
export function getEstimate1RM(state: SetupState, id: EstimatedLiftId): number | null {
  const rule = ESTIMATE_RULES[id];
  const base = getEffective1RM(state, rule.baseId);
  return base === null ? null : base * rule.ratio;
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

export const isStep1Valid = (state: SetupState) =>
  DIRECT_LIFT_IDS.every((id) => getDirect1RM(state, id) !== null);

export const isStep2Valid = (state: SetupState) =>
  ESTIMATED_LIFT_IDS.every((id) => getEffective1RM(state, id) !== null);

export const isStep3Valid = (state: SetupState) =>
  T3_IDS.every((id) => parsePositiveKg(state.t3[id]) !== null);

/** 입력칸 오류 메시지. 빈 값은 아직 입력 전이므로 showEmpty일 때만 안내 */
export function getInputError(text: string, showEmpty: boolean): string | null {
  if (text.trim() === "") return showEmpty ? "값을 입력하세요" : null;
  return parsePositiveKg(text) === null ? "0보다 큰 숫자(kg)를 입력하세요" : null;
}

// ---------------------------------------------------------------------------
// 상태 변경
// ---------------------------------------------------------------------------

export type SetupAction =
  | { type: "SET_DIRECT"; id: DirectLiftId; text: string }
  | { type: "EDIT_ESTIMATED"; id: EstimatedLiftId; text: string }
  | { type: "ACCEPT_ESTIMATE"; id: EstimatedLiftId }
  | { type: "REVERT_ESTIMATE"; id: EstimatedLiftId }
  | { type: "SET_T3"; id: T3ExerciseId; text: string }
  | { type: "GO_TO_STEP"; step: SetupStep }
  | { type: "COMPLETE" }
  /** 저장 계층에서 읽은(또는 방금 저장한) 확정 상태로 화면 전체를 바꾼다 */
  | { type: "RESTORE"; state: SetupState };

/** 부동소수점 잡음(77.00000000000001)만 제거하고 값 자체는 반올림하지 않는다 */
const valueText = (value: number) => String(Number(value.toPrecision(12)));

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  if (action.type === "RESTORE") return action.state;
  if (state.completed && action.type !== "GO_TO_STEP") return state;
  switch (action.type) {
    case "SET_DIRECT":
      // 기준값만 바꾼다. ESTIMATE 상태인 추정값은 계산 시 자동 반영되고, 확정·수정값은 그대로다.
      return { ...state, direct: { ...state.direct, [action.id]: action.text } };

    case "EDIT_ESTIMATED":
      return { ...state, estimated: { ...state.estimated, [action.id]: { source: "EDITED", text: action.text } } };

    case "ACCEPT_ESTIMATE": {
      const estimate = getEstimate1RM(state, action.id);
      if (estimate === null) return state;
      return {
        ...state,
        estimated: { ...state.estimated, [action.id]: { source: "ACCEPTED", text: valueText(estimate) } },
      };
    }

    case "REVERT_ESTIMATE":
      return { ...state, estimated: { ...state.estimated, [action.id]: { source: "ESTIMATE" } } };

    case "SET_T3":
      return { ...state, t3: { ...state.t3, [action.id]: action.text } };

    case "GO_TO_STEP": {
      // 앞 단계가 유효할 때만 다음 단계로 이동할 수 있다
      const canReach =
        action.step === 1 ||
        (action.step === 2 && isStep1Valid(state)) ||
        (action.step === 3 && isStep1Valid(state) && isStep2Valid(state)) ||
        (action.step === 4 && isStep1Valid(state) && isStep2Valid(state) && isStep3Valid(state));
      return canReach && !state.completed ? { ...state, step: action.step } : state;
    }

    case "COMPLETE": {
      if (!(isStep1Valid(state) && isStep2Valid(state) && isStep3Valid(state))) return state;
      // 아직 자동 추정 상태인 값은 사용자가 '이대로 확정'을 누른 시점의 값으로 확정한다
      const estimated = { ...state.estimated };
      for (const id of ESTIMATED_LIFT_IDS) {
        const entry = estimated[id];
        const value = getEffective1RM(state, id);
        if (entry.source === "ESTIMATE" && value !== null) {
          estimated[id] = { source: "ACCEPTED", text: valueText(value) };
        }
      }
      return { ...state, estimated, completed: true };
    }
  }
}
