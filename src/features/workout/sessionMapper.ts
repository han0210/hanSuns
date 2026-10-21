/**
 * 저장 계층 세션(SessionDetail) → Workout 화면 상태(프로토타입 UI 타입) 변환.
 *
 * 화면 컴포넌트(ExerciseAccordion·SetRow)는 프로토타입 타입을 쓰므로, 저장된 기록을 그 형태로 바꿔 재사용한다.
 * 완료 세트는 실제값을 그대로 보여준다. 미완료 세트의 입력칸은 저장된 초안이 있으면 그 값, 없으면 **그 세트 자체의**
 * 목표 중량·목표 반복으로 채운다(이전 세트 기록을 복사하지 않는다). 채워진 값은 완료를 누르기 전까지 미완료다.
 */
import type { SessionDetail, TMProgressionOutcome } from "@/storage/repositories/workoutRepository";
import { HYBRID_TM_INCREMENTS } from "@/domain/calculations/tmProgression";
import type { SessionExercise as UiExercise, WorkoutSession as UiSession } from "@/features/workout-prototype/types";

const TIER_LABEL = { T1: "Main Lift", T2: "Secondary Lift", T3: "FST-7" } as const;

/** 숫자 → 입력칸 문자열 (부동소수점 잡음 제거) */
const draftText = (value: number | null) => (value === null ? "" : String(Number(value.toPrecision(12))));
const toEpochMs = (iso: string | null) => (iso === null ? null : Date.parse(iso));

/**
 * @param names exerciseId → 화면 이름
 * @param dayLabel 화면 상단 표시 (예: "월 · T3 기록")
 */
export function toUiSession(detail: SessionDetail, names: (exerciseId: string) => string, dayLabel: string): UiSession {
  return {
    sessionId: detail.session.sessionId,
    dayLabel,
    status: detail.session.status,
    exercises: detail.exercises.map(
      ({ sessionExercise: se, sets }): UiExercise => ({
        sessionExerciseId: se.sessionExerciseId,
        exerciseId: se.exerciseId,
        exerciseName: names(se.exerciseId),
        tier: se.tier,
        tierLabel: TIER_LABEL[se.tier],
        restSeconds: se.restSeconds,
        resetCount: se.resetCount,
        lastResetAt: toEpochMs(se.lastResetAt),
        sets: sets.map((set) => ({
          setNumber: set.setNumber,
          targetWeight: set.targetWeight,
          targetReps: set.targetReps,
          isAmrap: set.isAmrap,
          manualTargetWeight: set.manualTargetWeight,
          actualWeightDraft: draftText(set.actualWeight ?? (set.completed ? null : set.manualTargetWeight ?? set.targetWeight)),
          actualRepsDraft: draftText(set.actualReps ?? (set.completed ? null : set.targetReps)),
          actualWeight: set.completed ? set.actualWeight : null,
          actualReps: set.completed ? set.actualReps : null,
          completed: set.completed,
          completedAt: toEpochMs(set.completedAt),
        })),
      }),
    ),
  };
}

/**
 * 세션 구성 구분.
 * - FULL: T1·T2가 포함된 전체 세션 (Hybrid 템플릿)
 * - T3_ONLY: STEP 10 Lite 시절의 T3 전용 세션. 기존 기록 그대로 보존·표시하며 T1·T2를 추가하지 않는다
 */
export type SessionScope = "FULL" | "T3_ONLY";
export const sessionScopeOf = (detail: SessionDetail): SessionScope =>
  detail.exercises.every((e) => e.sessionExercise.tier === "T3") ? "T3_ONLY" : "FULL";

/** 화면 세트 키(sessionExerciseId#setNumber)는 저장 계층 setRecordId와 같은 규칙이다 */
export const toSetRecordId = (sessionExerciseId: string, setNumber: number) => `${sessionExerciseId}#${setNumber}`;

/** 저장 계층 오류 코드 → 사용자 안내 문구 */
export function storageErrorMessage(error: string): string {
  switch (error) {
    case "SET_ALREADY_COMPLETED":
      return "이미 완료된 세트입니다. 다른 탭이나 이전 요청에서 저장되었습니다.";
    case "SESSION_NOT_EDITABLE":
      return "진행 중인 세션이 아니라 기록할 수 없습니다.";
    case "INVALID_ACTUAL_WEIGHT":
      return "실제 중량은 0보다 큰 숫자여야 합니다.";
    case "INVALID_ACTUAL_REPS":
      return "반복 횟수는 0 이상의 정수여야 합니다.";
    case "PROFILE_NOT_FOUND":
      return "이 Day 운동의 설정값이 없습니다. 초기 설정을 확인해 주세요.";
    case "TEMPLATE_CALCULATION_FAILED":
      return "TM이 너무 작아 목표 중량을 계산할 수 없습니다. 설정값을 확인해 주세요.";
    case "SESSION_HAS_INCOMPLETE_SETS":
      return "아직 완료하지 않은 세트가 있어 운동을 완료할 수 없습니다.";
    case "RESET_NOT_ALLOWED":
      return "이 세션 상태에서는 리셋할 수 없습니다.";
    case "STORAGE_ERROR":
      return "기기 저장소에 저장하지 못했습니다. 입력값은 유지됩니다. 다시 시도해 주세요.";
    default:
      return `저장하지 못했습니다 (${error}). 다시 시도해 주세요.`;
  }
}

const fmt = (value: number) => String(Math.round(value * 100) / 100);

const HOLD_REASON_TEXT: Record<TMProgressionOutcome["reasons"][number]["code"], string> = {
  NO_SETS: "세트 없음",
  SET_INCOMPLETE: "미완료",
  ACTUAL_WEIGHT_MISSING: "실제 중량 없음",
  ACTUAL_REPS_MISSING: "실제 반복 없음",
  WEIGHT_BELOW_TARGET: "중량 미달",
  REPS_BELOW_TARGET: "반복 미달",
};

/**
 * T1·T2 TM 증량 결과의 화면 문구 (H-22). 저장 계층이 돌려준 결과만 표시하며, 저장 전에 증량을 확정 표시하지 않는다.
 * @returns achieved: 목표 달성 여부(INCREASED), tmLine: TM 변화, reason: 유지 사유
 */
export function describeTmProgression(outcome: TMProgressionOutcome): { achieved: boolean; tmLine: string; reason: string | null } {
  const unit = outcome.unit;
  const from = outcome.fromTM === null ? "—" : `${fmt(outcome.fromTM)}${unit}`;
  const to = outcome.toTM === null ? "—" : `${fmt(outcome.toTM)}${unit}`;
  switch (outcome.status) {
    case "INCREASED":
      return { achieved: true, tmLine: `이전 TM ${from} → 다음 TM ${to}`, reason: null };
    case "HELD": {
      const details = outcome.reasons
        .slice(0, 3)
        .map((r) => `${r.tier} ${r.setNumber === null ? "" : `${r.setNumber}세트 `}${HOLD_REASON_TEXT[r.code]}`)
        .join(", ");
      const more = outcome.reasons.length > 3 ? ` 외 ${outcome.reasons.length - 3}건` : "";
      return { achieved: false, tmLine: `TM ${from} 유지`, reason: `목표 미달 — 다음 운동 중량 유지 (${details}${more})` };
    }
    case "NO_POLICY":
      return { achieved: false, tmLine: `TM ${from} 유지`, reason: "자동 증량값이 정해지지 않은 운동 — TM 유지" };
    case "UNIT_NOT_SUPPORTED":
      return { achieved: false, tmLine: `TM ${from} 유지`, reason: "lb 단위 증량 정책 확정 전 — TM 유지" };
    case "ALREADY_APPLIED":
      return { achieved: false, tmLine: `TM ${from}`, reason: "이 세션의 증량이 이미 반영됨" };
  }
}

/** 시작 화면 안내: 운동의 자동 증량값 (없으면 null) */
export const tmIncrementLabel = (exerciseId: string): string | null => {
  const inc = HYBRID_TM_INCREMENTS[exerciseId];
  return inc ? `목표 달성 시 TM +${fmt(inc.value)}${inc.unit}` : null;
};
