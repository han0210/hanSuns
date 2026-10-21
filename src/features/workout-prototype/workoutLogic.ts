/**
 * Workout 프로토타입의 순수 함수 모음.
 *
 * UI와 분리된 판단 로직(입력 검증, 현재 세트, 진행률, 잠금, 리셋 허용 여부)을
 * 한곳에 둔다. 저장 계층의 잠금 규칙도 여기서 흉내 낸다:
 * 완료된 세트는 일반 수정 경로(updateSetDraft 등)로 바뀌지 않는다.
 *
 * 중량 계산식(TM × 비율)이나 증량 규칙은 포함하지 않는다.
 */

import type {
  SessionExercise,
  SessionStatus,
  SetKey,
  SetRecord,
  WorkoutSession,
} from "./types";

export const toSetKey = (sessionExerciseId: string, setNumber: number): SetKey =>
  `${sessionExerciseId}#${setNumber}`;

// ---------------------------------------------------------------------------
// 입력 검증 (FUNCTIONS 9.2.1: 중량 > 0 유한수, 반복 0 이상 정수)
// ---------------------------------------------------------------------------

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const INTEGER_PATTERN = /^\d+$/;

export type ValidationResult =
  | { ok: true; weight: number; reps: number }
  | { ok: false; errors: { weight?: string; reps?: string } };

/**
 * 체크 시점의 실제 중량·반복 입력값을 검증한다.
 * @returns 통과 시 숫자로 변환한 값, 실패 시 필드별 오류 메시지
 */
export function validateSetCompletion(
  weightDraft: string,
  repsDraft: string,
): ValidationResult {
  const errors: { weight?: string; reps?: string } = {};
  const weightText = weightDraft.trim();
  const repsText = repsDraft.trim();

  const weight = Number(weightText);
  if (weightText === "") errors.weight = "실제 중량을 입력하세요";
  else if (!DECIMAL_PATTERN.test(weightText) || !Number.isFinite(weight) || weight <= 0)
    errors.weight = "0보다 큰 숫자를 입력하세요";

  const reps = Number(repsText);
  if (repsText === "") errors.reps = "반복 횟수를 입력하세요";
  else if (!INTEGER_PATTERN.test(repsText)) errors.reps = "0 이상의 정수를 입력하세요";

  if (errors.weight || errors.reps) return { ok: false, errors };
  return { ok: true, weight, reps };
}

/** 목표 중량 수정값 검증 (0보다 큰 숫자) */
export function parseTargetWeight(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// 진행 상태 계산 (현재 세트는 저장하지 않고 계산한다 — FUNCTIONS 9.2.1)
// ---------------------------------------------------------------------------

/** 완료되지 않은 첫 세트 번호. 모두 완료면 null */
export function getCurrentSetNumber(sets: readonly SetRecord[]): number | null {
  const first = [...sets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .find((set) => !set.completed);
  return first ? first.setNumber : null;
}

export const countCompletedSets = (sets: readonly SetRecord[]): number =>
  sets.filter((set) => set.completed).length;

export const isExerciseComplete = (exercise: SessionExercise): boolean =>
  exercise.sets.length > 0 && exercise.sets.every((set) => set.completed);

export function getSessionProgress(session: WorkoutSession) {
  const total = session.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  const completed = session.exercises.reduce(
    (sum, ex) => sum + countCompletedSets(ex.sets),
    0,
  );
  return { completed, total };
}

/** 세트 완료 전 수정값이 있으면 그 값, 없으면 스냅샷 목표 중량 */
export const getEffectiveTargetWeight = (set: SetRecord): number =>
  set.manualTargetWeight ?? set.targetWeight;

// ---------------------------------------------------------------------------
// 권한 판단
// ---------------------------------------------------------------------------

/** 세트 입력·체크는 하루 세션이 IN_PROGRESS이고 세트가 미완료일 때만 가능 */
export const canEditSet = (status: SessionStatus, set: SetRecord): boolean =>
  status === "IN_PROGRESS" && !set.completed;

export type ResetPermission = { allowed: true } | { allowed: false; reason: string };

/** 운동별 리셋 허용 여부 (CALCULATION_RULES 9.4, U-14/U-15) */
export function getResetPermission(status: SessionStatus): ResetPermission {
  switch (status) {
    case "IN_PROGRESS":
    case "PAUSED":
      return { allowed: true };
    case "COMPLETED":
      return { allowed: false, reason: "완료된 세션은 리셋할 수 없습니다 (정책 U-14 미확정)" };
    case "ABANDONED":
      return { allowed: false, reason: "중도 종료된 세션은 리셋할 수 없습니다 (정책 U-15 미확정)" };
    case "NOT_STARTED":
      return { allowed: false, reason: "시작 전인 세션입니다" };
  }
}

/** 리셋할 기록(완료 세트 또는 입력 중인 값)이 있는지 */
export const hasResettableRecord = (exercise: SessionExercise): boolean =>
  exercise.sets.some(
    (set) => set.completed || set.actualWeightDraft !== "" || set.actualRepsDraft !== "",
  );

// ---------------------------------------------------------------------------
// 상태 변경 (불변 업데이트). 대상 SessionExercise 외에는 건드리지 않는다.
// ---------------------------------------------------------------------------

function updateExercise(
  session: WorkoutSession,
  sessionExerciseId: string,
  update: (exercise: SessionExercise) => SessionExercise,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) =>
      exercise.sessionExerciseId === sessionExerciseId ? update(exercise) : exercise,
    ),
  };
}

function updateSet(
  exercise: SessionExercise,
  setNumber: number,
  update: (set: SetRecord) => SetRecord,
): SessionExercise {
  return {
    ...exercise,
    sets: exercise.sets.map((set) => (set.setNumber === setNumber ? update(set) : set)),
  };
}

export function findSet(
  session: WorkoutSession,
  sessionExerciseId: string,
  setNumber: number,
): { exercise: SessionExercise; set: SetRecord } | null {
  const exercise = session.exercises.find((ex) => ex.sessionExerciseId === sessionExerciseId);
  const set = exercise?.sets.find((s) => s.setNumber === setNumber);
  return exercise && set ? { exercise, set } : null;
}

/** 미완료 세트의 입력 초안 변경. 완료 세트는 거부(변경 없음) */
export function updateSetDraft(
  session: WorkoutSession,
  sessionExerciseId: string,
  setNumber: number,
  field: "weight" | "reps",
  value: string,
): WorkoutSession {
  const found = findSet(session, sessionExerciseId, setNumber);
  if (!found || !canEditSet(session.status, found.set)) return session;
  return updateExercise(session, sessionExerciseId, (exercise) =>
    updateSet(exercise, setNumber, (set) =>
      field === "weight" ? { ...set, actualWeightDraft: value } : { ...set, actualRepsDraft: value },
    ),
  );
}

/** 세트 완료 전 목표 중량 수정 (null이면 스냅샷 값으로 되돌림). 완료 세트는 거부 */
export function updateManualTarget(
  session: WorkoutSession,
  sessionExerciseId: string,
  setNumber: number,
  manualTargetWeight: number | null,
): WorkoutSession {
  const found = findSet(session, sessionExerciseId, setNumber);
  if (!found || !canEditSet(session.status, found.set)) return session;
  return updateExercise(session, sessionExerciseId, (exercise) =>
    updateSet(exercise, setNumber, (set) => ({ ...set, manualTargetWeight })),
  );
}

export type CompletionResult =
  | { ok: true; session: WorkoutSession }
  | { ok: false; reason: string };

/**
 * 저장 성공 후 완료를 확정한다. 저장 계층 트랜잭션의 재확인을 흉내 낸다:
 * 세션이 IN_PROGRESS가 아니거나 이미 완료된 세트면 거부한다.
 */
export function applySetCompletion(
  session: WorkoutSession,
  sessionExerciseId: string,
  setNumber: number,
  weight: number,
  reps: number,
  now: number,
): CompletionResult {
  const found = findSet(session, sessionExerciseId, setNumber);
  if (!found) return { ok: false, reason: "세트를 찾을 수 없습니다" };
  if (session.status !== "IN_PROGRESS")
    return { ok: false, reason: "세션 상태가 바뀌어 완료할 수 없습니다" };
  if (found.set.completed) return { ok: false, reason: "이미 완료된 세트입니다" };

  return {
    ok: true,
    session: updateExercise(session, sessionExerciseId, (exercise) =>
      updateSet(exercise, setNumber, (set) => ({
        ...set,
        actualWeight: weight,
        actualReps: reps,
        actualWeightDraft: String(weight),
        actualRepsDraft: String(reps),
        completed: true,
        completedAt: now,
      })),
    ),
  };
}

/**
 * 운동별 전체 세트 리셋 (CALCULATION_RULES 9.4).
 * 초기화: 실제값·입력 초안·완료 상태·완료 시각
 * 보존: 목표 중량·반복·세트 번호·manualTargetWeight(v0.6 정책)
 * 갱신: resetCount, lastResetAt
 */
export function applyExerciseReset(
  session: WorkoutSession,
  sessionExerciseId: string,
  now: number,
): WorkoutSession {
  if (!getResetPermission(session.status).allowed) return session;
  return updateExercise(session, sessionExerciseId, (exercise) => ({
    ...exercise,
    resetCount: exercise.resetCount + 1,
    lastResetAt: now,
    sets: exercise.sets.map((set) => ({
      ...set,
      actualWeightDraft: "",
      actualRepsDraft: "",
      actualWeight: null,
      actualReps: null,
      completed: false,
      completedAt: null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Accordion 자동 전환
// ---------------------------------------------------------------------------

const NEXT_TIER: Record<string, string | undefined> = { T1: "T2", T2: "T3" };

export type AutoAdvance =
  | { kind: "none" }
  | { kind: "expand"; sessionExerciseId: string }
  | { kind: "highlightFinish" };

/**
 * 세트 완료 확정 직후 Accordion 자동 전환을 결정한다.
 * 사용자의 선택을 우선하기 위해, 방금 완료된 운동이 현재 펼쳐진 운동일 때만 전환한다.
 */
export function getAutoAdvance(
  session: WorkoutSession,
  completedExerciseId: string,
  expandedExerciseId: string | null,
): AutoAdvance {
  if (completedExerciseId !== expandedExerciseId) return { kind: "none" };
  const exercise = session.exercises.find((ex) => ex.sessionExerciseId === completedExerciseId);
  if (!exercise || !isExerciseComplete(exercise)) return { kind: "none" };

  const nextTier = NEXT_TIER[exercise.tier];
  if (nextTier) {
    const next = session.exercises.find((ex) => ex.tier === nextTier);
    if (next) return { kind: "expand", sessionExerciseId: next.sessionExerciseId };
  }
  return exercise.tier === "T3" ? { kind: "highlightFinish" } : { kind: "none" };
}
