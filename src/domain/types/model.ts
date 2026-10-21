/**
 * nSuns Hybrid 데이터 모델 (Dexie 연동 전 TypeScript 타입).
 *
 * - 모든 엔티티는 JSON으로 직렬화 가능한 평범한 객체다(Date 대신 ISO 문자열).
 * - 필드 이름은 TypeScript·저장 모델 모두 camelCase (DATAMODEL.md 2장).
 * - 관계: Exercise 1 ─ 1 ExerciseProfile 1 ─ N TMChange (exerciseId 기준, T1·T2 공통 프로필)
 *         WorkoutSession 1 ─ N SessionExercise 1 ─ N SetRecord
 * - readonly는 컴파일 시점 제약일 뿐이다. 실제 데이터 수정 차단(완료 세트 잠금 등)은
 *   STEP 09 서비스 계층과 Dexie 트랜잭션에서 검증한다.
 * - 중량 숫자는 각 엔티티의 weightUnit 단위다. 단위가 다른 값끼리 섞어 계산하지 않는다.
 * - 덤벨 운동(equipment: DUMBBELL)의 모든 중량 값은 한 손 기준이다 (U-19 확정, 양손 합산 없음, kg·lb 공통).
 * - 미확정 정책(lb 지원 범위, 완료·중도 종료 세션 리셋 등)은 타입으로 확정하지 않는다.
 *   docs/architecture/DATAMODEL.md 참고.
 */

import type { WeightUnit } from "./weight";

/** ISO 8601 날짜·시각 문자열 (예: 2026-10-21T09:00:00.000Z) */
export type IsoDateTime = string;
/** ISO 8601 날짜 문자열 (예: 2026-10-21) */
export type IsoDate = string;

export type ExerciseId = string;
export type SessionId = string;
export type SessionExerciseId = string;
export type SetRecordId = string;
export type TMChangeId = string;

/** 운동 단계 역할. 같은 운동(exerciseId)이 T1과 T2에 모두 쓰일 수 있다 (예: OHP) */
export type Tier = "T1" | "T2" | "T3";

export type Weekday = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

/** 하루 세션 상태 (FUNCTIONS 9.3) */
export type SessionStatus = "NOT_STARTED" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "ABANDONED";

/**
 * 1RM 출처 (FUNCTIONS 3.4, CALCULATION_RULES 3.6)
 * - DIRECT: 사용자가 1RM을 직접 입력함 (4대 운동). 실제 측정이 검증되었다는 뜻은 아니다.
 * - ESTIMATE_ACCEPTED: 초기 추천값을 사용자가 그대로 확정
 * - USER_EDITED: 사용자가 추천값을 수정
 * ESTIMATE_ACCEPTED·USER_EDITED는 확정·수정 후에도 DIRECT로 바꾸지 않는다.
 */
export type OneRepMaxSource = "DIRECT" | "ESTIMATE_ACCEPTED" | "USER_EDITED";

export type EquipmentType = "BARBELL" | "DUMBBELL" | "MACHINE" | "CABLE";

/**
 * 운동 마스터. 운동 이름·장비·중량 단위·증가 단위처럼 사용자 기록과 무관한 정보를 담는다.
 * 덤벨은 모든 운동에서 한 손 기준(U-19 확정)이므로 운동별 표기 기준 필드를 두지 않는다.
 */
export type Exercise = {
  readonly exerciseId: ExerciseId;
  readonly name: string;
  readonly equipment: EquipmentType;
  /** 이 운동의 중량 입력·표시 단위 */
  readonly weightUnit: WeightUnit;
  /** 반올림·T3 증량 단위 (weightUnit 기준, 0보다 큼) */
  readonly increment: number;
  readonly updatedAt: IsoDateTime;
};

/**
 * 운동별 사용자 기준 중량. exerciseId당 하나이며 T1·T2가 공유한다 (H-13).
 * weightUnit은 이 프로필 값들의 단위이며 Exercise.weightUnit과 같아야 한다
 * (불일치 검증은 STEP 09 서비스 계층 책임).
 */
export type ExerciseProfile = {
  readonly exerciseId: ExerciseId;
  /** oneRepMax·initialTM·currentTM·t3WorkingWeight의 단위 */
  readonly weightUnit: WeightUnit;
  /** T1·T2 기준 1RM. T3 전용 운동이면 null */
  readonly oneRepMax: number | null;
  readonly oneRepMaxSource: OneRepMaxSource | null;
  /** 추천값에서 출발한 경우 규칙 ID (예: setup-barbell-row-v1). DIRECT면 null */
  readonly estimateRuleId: string | null;
  /** oneRepMax × 0.9 (파생값, 반올림하지 않음) */
  readonly initialTM: number | null;
  /** 다음 세션 계산에 쓰는 현재 TM (독립 저장값) */
  readonly currentTM: number | null;
  /** T3 작업 중량. T1·T2 전용 운동이면 null */
  readonly t3WorkingWeight: number | null;
  /**
   * t3WorkingWeight가 바뀔 때마다 1씩 증가하는 변경 번호 (최초 0).
   * 세션 시작 시 SessionExercise.workingWeightRevisionAtSession으로 복사해 두고, 세션 완료 시 번호가 같을 때만
   * 자동 증량을 반영한다. 세션 도중 사용자가 값을 바꿨다면(같은 값으로 되돌렸더라도) 사용자 값을 우선한다 (U-22).
   * 시각 비교 대신 번호를 쓰는 이유: 휴대폰 시계가 바뀌어도 판단이 흔들리지 않는다.
   */
  readonly t3WorkingWeightRevision: number;
  readonly updatedAt: IsoDateTime;
};

/** 하루 운동 세션 */
export type WorkoutSession = {
  readonly sessionId: SessionId;
  readonly scheduledDay: Weekday;
  /** 실제 수행 날짜 */
  readonly workoutDate: IsoDate;
  readonly status: SessionStatus;
  readonly startedAt: IsoDateTime | null;
  readonly completedAt: IsoDateTime | null;
  readonly schemaVersion: 1;
};

/**
 * 하루 세션 안의 운동 실행 단위. 운동별 리셋 대상 식별자다.
 * 세션 시작 시점의 계산 기준(TM·작업 중량·템플릿·증가 단위)을 스냅샷으로 보존한다.
 * 현재 세트 위치와 진행 상태는 저장하지 않고 SetRecord에서 계산한다.
 */
export type SessionExercise = {
  readonly sessionExerciseId: SessionExerciseId;
  readonly sessionId: SessionId;
  readonly exerciseId: ExerciseId;
  readonly tier: Tier;
  readonly weightUnit: WeightUnit;
  readonly increment: number;
  /** 원본 템플릿 미확정 운동은 null (임의 템플릿 생성 금지) */
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  /** T1·T2: 세션 시작 시점 TM */
  readonly tmAtSession: number | null;
  /** T3: 세션 시작 시점 작업 중량 */
  readonly workingWeightAtSession: number | null;
  /** T3: 세션 시작 시점 ExerciseProfile.t3WorkingWeightRevision (U-22 판단용). T1·T2는 null */
  readonly workingWeightRevisionAtSession: number | null;
  /**
   * 세션 안 표시 순서 (0부터). 세션 생성 시 계획 순서대로 저장하며, 조회는 이 값으로 정렬한다.
   * 같은 세션 안에서 유일하다.
   */
  readonly displayOrder: number;
  readonly restSeconds: number;
  /** 운동별 전체 세트 리셋 이력 */
  readonly resetCount: number;
  readonly lastResetAt: IsoDateTime | null;
  /**
   * 하루 세션 완료 시 이 운동의 증량 판정을 마친 시각 (CALCULATION_RULES 9.3 멱등성).
   * 판정 규칙이 확정된 운동(현재 T3 FST-7)만 기록하며, 이미 값이 있으면 다시 판정하지 않는다.
   */
  readonly progressionEvaluatedAt: IsoDateTime | null;
};

type SetRecordBase = {
  readonly setRecordId: SetRecordId;
  readonly sessionExerciseId: SessionExerciseId;
  readonly sessionId: SessionId;
  readonly exerciseId: ExerciseId;
  readonly tier: Tier;
  readonly setNumber: number;
  readonly weightUnit: WeightUnit;
  /** 세션 시작 스냅샷의 목표 중량 (반올림 완료값) */
  readonly targetWeight: number;
  readonly targetReps: number;
  readonly isAmrap: boolean;
  /** 세트 완료 전 사용자가 수정한 목표 중량 */
  readonly manualTargetWeight: number | null;
};

/** 미완료 세트: 실제값은 입력 중일 수 있다 */
export type IncompleteSetRecord = SetRecordBase & {
  readonly completed: false;
  readonly actualWeight: number | null;
  readonly actualReps: number | null;
  readonly completedAt: null;
};

/**
 * 완료 세트: 저장 성공 후 잠긴다. 실제값이 반드시 있고, 개별 수정하지 않는다.
 * 타입의 readonly는 코드 실수만 막는다. 저장된 데이터의 수정 거부는 서비스 계층·Dexie 트랜잭션이 맡는다.
 */
export type CompletedSetRecord = SetRecordBase & {
  readonly completed: true;
  readonly actualWeight: number;
  readonly actualReps: number;
  readonly completedAt: IsoDateTime;
};

export type SetRecord = IncompleteSetRecord | CompletedSetRecord;

export type TMChangeReason = "INITIAL" | "AMRAP_PROGRESSION" | "USER_RESET";

/** currentTM 변경 이력. (sourceSessionId, exerciseId, sourceTier)로 증량 중복을 막는다 */
export type TMChange = {
  readonly tmChangeId: TMChangeId;
  readonly exerciseId: ExerciseId;
  readonly weightUnit: WeightUnit;
  /** 최초 설정이면 null */
  readonly fromTM: number | null;
  readonly toTM: number;
  readonly reason: TMChangeReason;
  readonly sourceSessionId: SessionId | null;
  readonly sourceTier: Tier | null;
  readonly ruleId: string | null;
  readonly ruleVersion: number | null;
  readonly appliedAt: IsoDateTime;
};
