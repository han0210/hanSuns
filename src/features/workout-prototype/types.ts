/**
 * Workout UI 프로토타입 전용 타입.
 *
 * 운영 데이터 모델(FUNCTIONS.md 9·11장)의 WorkoutSession → SessionExercise → SetRecord
 * 관계를 따르되, 프로토타입 검증에 필요한 필드만 둔다.
 * Dexie 스키마나 계산 엔진 타입이 아니다.
 */

export type Tier = "T1" | "T2" | "T3";

/** 하루 세션 상태 (FUNCTIONS.md 9.3) */
export type SessionStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PAUSED"
  | "COMPLETED"
  | "ABANDONED";

/** 세트 하나의 목표값(스냅샷)과 실제 수행값 */
export type SetRecord = {
  setNumber: number;
  /** 세션 시작 시점 목표 중량 스냅샷 (Mock 값) */
  targetWeight: number;
  /** 목표 반복. AMRAP 세트는 최소 반복을 의미한다 */
  targetReps: number;
  isAmrap: boolean;
  /** 세트 완료 전 사용자가 수정한 목표 중량. 없으면 null */
  manualTargetWeight: number | null;
  /** 체크 전 입력 중인 값(문자열 그대로 보관해 입력 중 형식을 해치지 않는다) */
  actualWeightDraft: string;
  actualRepsDraft: string;
  /** 완료 확정 시 기록되는 실제 수행값 */
  actualWeight: number | null;
  actualReps: number | null;
  completed: boolean;
  completedAt: number | null;
};

/** 하루 세션 안의 운동 실행 단위 (FUNCTIONS.md 11.4.1) */
export type SessionExercise = {
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  tier: Tier;
  /** BASE.md 7.1 티어 라벨 */
  tierLabel: string;
  /** 티어 기본 휴식 시간(초) */
  restSeconds: number;
  resetCount: number;
  lastResetAt: number | null;
  sets: SetRecord[];
};

export type WorkoutSession = {
  sessionId: string;
  dayLabel: string;
  status: SessionStatus;
  exercises: SessionExercise[];
};

/** 세트를 식별하는 키: sessionExerciseId + setNumber */
export type SetKey = `${string}#${number}`;

export type SetFieldErrors = {
  weight?: string;
  reps?: string;
  save?: string;
};
