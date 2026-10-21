/**
 * 저장 계층 세션(SessionDetail) → Workout 화면 상태(프로토타입 UI 타입) 변환.
 *
 * 화면 컴포넌트(ExerciseAccordion·SetRow)는 프로토타입 타입을 쓰므로, 저장된 기록을 그 형태로 바꿔 재사용한다.
 * 완료 세트는 실제값을 그대로, 미완료 세트는 저장된 입력값이 있으면 입력칸 초안으로 채운다.
 */
import type { SessionDetail } from "@/storage/repositories/workoutRepository";
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
          actualWeightDraft: draftText(set.actualWeight),
          actualRepsDraft: draftText(set.actualReps),
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
      return "이 요일 운동의 설정값이 없습니다. 초기 설정을 확인해 주세요.";
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
