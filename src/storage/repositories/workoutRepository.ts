/**
 * 하루 세션·세션 운동·세트 기록 저장소.
 *
 * 핵심 규칙
 * - 세트 완료는 "검증 → 트랜잭션 안에서 최신 상태 재확인 → 저장 성공" 순서다. UI는 저장 결과(ok)를 받은 뒤에만
 *   완료로 표시한다(낙관적 완료 표시 금지). 저장이 실패하면 completed는 false 그대로다.
 * - 완료 세트는 이 파일의 서비스 검증(SET_LOCKED·SET_ALREADY_COMPLETED)과 db.ts의 테이블 훅으로 이중 잠금된다.
 *   훅은 resetSessionExercise()가 같은 트랜잭션에 남긴 리셋 허가가 있을 때만 완료 세트 초기화를 통과시킨다.
 * - 하루 세션 완료(COMPLETED)는 모든 예정 세트가 완료된 경우에만 허용한다 (U-21).
 * - 운동별 리셋은 SessionExercise 하나의 세트 전체와 리셋 이력을 한 트랜잭션으로 바꾼다(부분 리셋 없음).
 * - 진행 중(IN_PROGRESS·PAUSED) 세션은 한 번에 하나만 둔다. IndexedDB readwrite 트랜잭션은 같은 테이블을 쓰는
 *   다른 트랜잭션(다른 탭 포함)과 순서대로 실행되므로, 트랜잭션 안의 "조회 후 쓰기"가 탭 간 중복을 막는다.
 * - T1·T2 세트 목표값은 템플릿(SetTemplate)을 넘기면 트랜잭션 안에서 세션 시작 TM 스냅샷으로 계산하고,
 *   세트 목록을 넘기면 그 값을 그대로 보존한다.
 */
import type {
  CompletedSetRecord,
  IncompleteSetRecord,
  IsoDate,
  SessionExercise,
  SessionExerciseId,
  SessionId,
  SetRecord,
  SetRecordId,
  Tier,
  Weekday,
  WorkoutSession,
} from "@/domain/types/model";
import type { Mass } from "@/domain/types/weight";
import { isPositiveFinite } from "@/domain/calculations/precision";
import { evaluateFST7Progress, FST7_SET_COUNT, FST7_TARGET_REPS, type Fst7Decision } from "@/domain/calculations/fst7Progress";
import { calculateTemplateSets, type SetTemplate } from "@/domain/templates/hybridTemplates";
import type { NsunsDatabase } from "../db";
import { createId, systemClock, toIsoDateTime } from "../ids";
import { runStorage, ValidationStop, type StorageResult } from "../result";
import type { RepositoryOptions } from "./exerciseRepository";

const nowOf = (options?: RepositoryOptions): string => toIsoDateTime(options?.clock ?? systemClock);

/** 세트를 입력·완료할 수 있는 세션 상태 */
const EDITABLE_STATUS = "IN_PROGRESS";
/** 운동별 리셋이 허용되는 세션 상태 (COMPLETED는 U-14, ABANDONED는 U-15 확정 전 불허) */
const RESETTABLE_STATUSES: readonly WorkoutSession["status"][] = ["IN_PROGRESS", "PAUSED"];
const ACTIVE_STATUSES: readonly WorkoutSession["status"][] = ["IN_PROGRESS", "PAUSED"];

// ─── 조회 모델 ─────────────────────────────────────────────────────────────

export type SessionExerciseDetail = {
  readonly sessionExercise: SessionExercise;
  /** setNumber 오름차순 */
  readonly sets: SetRecord[];
  /** 현재 세트 = completed가 false인 가장 작은 setNumber. 모두 완료면 null (저장하지 않는 계산값) */
  readonly nextSetNumber: number | null;
};

export type SessionDetail = {
  readonly session: WorkoutSession;
  /** displayOrder 오름차순 (세션 생성 시 계획 순서) */
  readonly exercises: SessionExerciseDetail[];
};

const nextIncompleteSetNumber = (sets: readonly SetRecord[]): number | null =>
  sets.filter((s) => !s.completed).reduce<number | null>((min, s) => (min === null || s.setNumber < min ? s.setNumber : min), null);

function toExerciseDetail(sessionExercise: SessionExercise, sets: SetRecord[]): SessionExerciseDetail {
  const sorted = [...sets].sort((a, b) => a.setNumber - b.setNumber);
  return { sessionExercise, sets: sorted, nextSetNumber: nextIncompleteSetNumber(sorted) };
}

/** 트랜잭션 안·밖 어디서든 쓸 수 있는 세션 조립 함수 */
async function loadSessionDetail(db: NsunsDatabase, sessionId: SessionId): Promise<SessionDetail | null> {
  const session = await db.workoutSessions.get(sessionId);
  if (!session) return null;
  const [sessionExercises, sets] = await Promise.all([
    db.sessionExercises.where("sessionId").equals(sessionId).toArray(),
    db.setRecords.where("sessionId").equals(sessionId).toArray(),
  ]);
  const exercises = sessionExercises
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((se) => toExerciseDetail(se, sets.filter((s) => s.sessionExerciseId === se.sessionExerciseId)));
  return { session, exercises };
}

/** 세션 전체(세션·운동·세트)를 읽는다. 새로고침·앱 재시작 후 복원에 사용 */
export function getSessionDetail(db: NsunsDatabase, sessionId: SessionId): Promise<StorageResult<SessionDetail | null, never>> {
  return runStorage(() => db.transaction("r", [db.workoutSessions, db.sessionExercises, db.setRecords], () => loadSessionDetail(db, sessionId)));
}

/** 진행 중(IN_PROGRESS·PAUSED) 세션. 없으면 null */
export function getActiveSession(db: NsunsDatabase): Promise<StorageResult<SessionDetail | null, never>> {
  return runStorage(() =>
    db.transaction("r", [db.workoutSessions, db.sessionExercises, db.setRecords], async () => {
      const active = await db.workoutSessions.where("status").anyOf([...ACTIVE_STATUSES]).first();
      return active ? loadSessionDetail(db, active.sessionId) : null;
    }),
  );
}

// ─── 세션 시작 ─────────────────────────────────────────────────────────────

export type PlannedSet = {
  readonly setNumber: number;
  /** 반올림까지 끝난 최종 목표 중량 (운동 단위) */
  readonly targetWeight: number;
  readonly targetReps: number;
  readonly isAmrap: boolean;
};

export type SessionExercisePlan = {
  readonly exerciseId: string;
  readonly tier: Tier;
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  readonly restSeconds: number;
  /** T1·T2: sets 또는 template 중 하나만. T3는 둘 다 생략하며 FST-7 7×12 세트를 자동 생성한다 */
  readonly sets?: readonly PlannedSet[];
  /**
   * T1·T2 세트 템플릿 (Hybrid 자체 템플릿 H-20·H-21). 지정하면 세션 시작 시점 TM 스냅샷으로
   * 목표 중량 = roundToIncrement(TM × 비율)을 같은 트랜잭션에서 계산한다. templateId·templateVersion과 일치해야 한다.
   */
  readonly template?: SetTemplate;
};

export type StartSessionInput = {
  readonly scheduledDay: Weekday;
  readonly workoutDate: IsoDate;
  readonly exercises: readonly SessionExercisePlan[];
};

export type StartSessionError =
  | "INVALID_SESSION_PLAN"
  | "EXERCISE_NOT_FOUND"
  | "PROFILE_NOT_FOUND"
  | "UNIT_MISMATCH"
  | "MISSING_SNAPSHOT_VALUE"
  | "TEMPLATE_CALCULATION_FAILED"
  | "ACTIVE_SESSION_EXISTS";

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

/** 계획 자체의 형식 검증 (DB 조회 없이 판단 가능한 것) */
function isValidPlan(input: StartSessionInput): boolean {
  if (input.exercises.length === 0) return false;
  const keys = new Set(input.exercises.map((e) => `${e.exerciseId}|${e.tier}`));
  if (keys.size !== input.exercises.length) return false;
  return input.exercises.every((plan) => {
    if (!isNonNegativeInteger(plan.restSeconds)) return false;
    if (plan.tier === "T3") return plan.sets === undefined && plan.template === undefined;
    if (plan.template !== undefined) {
      return (
        plan.sets === undefined &&
        plan.template.tier === plan.tier &&
        plan.template.templateId === plan.templateId &&
        plan.template.templateVersion === plan.templateVersion
      );
    }
    const sets = plan.sets ?? [];
    if (sets.length === 0) return false;
    const numbers = new Set(sets.map((s) => s.setNumber));
    if (numbers.size !== sets.length) return false;
    return sets.every((s) => isPositiveInteger(s.setNumber) && isPositiveFinite(s.targetWeight) && isPositiveInteger(s.targetReps));
  });
}

/**
 * 하루 세션을 IN_PROGRESS로 시작하고 스냅샷을 고정한다 (CALCULATION_RULES 9.1).
 * - T1·T2: tmAtSession = 프로필 currentTM, T3: workingWeightAtSession = 프로필 t3WorkingWeight
 * - weightUnit·increment는 운동 마스터에서 복사한다. 이후 프로필·마스터가 바뀌어도 이 세션 값은 바뀌지 않는다.
 * - ID 규칙: sessionExerciseId = `${sessionId}:${tier}:${exerciseId}`, setRecordId = `${sessionExerciseId}#${setNumber}`
 * - displayOrder: 계획 배열 순서(0부터). 호출자가 화면에 보일 순서대로 exercises를 넘긴다.
 * - 같은 세션에서 (exerciseId, tier) 조합은 하나만 허용한다(INVALID_SESSION_PLAN). 같은 운동을 다른 티어로 넣는 것
 *   (예: 같은 날 T1·T2 모두 OHP)은 키가 달라 허용되며, 두 운동은 T1·T2 공통 currentTM을 각각 스냅샷한다(H-13).
 */
export function startWorkoutSession(
  db: NsunsDatabase,
  input: StartSessionInput,
  options?: RepositoryOptions,
): Promise<StorageResult<SessionDetail, StartSessionError>> {
  type E = StartSessionError;
  return runStorage(() =>
    db.transaction("rw", [db.exercises, db.exerciseProfiles, db.workoutSessions, db.sessionExercises, db.setRecords], async () => {
      if (!isValidPlan(input)) return new ValidationStop<E>("INVALID_SESSION_PLAN");
      const active = await db.workoutSessions.where("status").anyOf([...ACTIVE_STATUSES]).first();
      if (active) return new ValidationStop<E>("ACTIVE_SESSION_EXISTS", active.sessionId);

      const now = nowOf(options);
      const sessionId = createId();
      const sessionExercises: SessionExercise[] = [];
      const setRecords: SetRecord[] = [];

      // 1단계: 모든 운동을 검증하고 메모리에서 레코드를 만든다 (쓰기 전에 실패하면 아무것도 저장되지 않음)
      for (const [displayOrder, plan] of input.exercises.entries()) {
        const exercise = await db.exercises.get(plan.exerciseId);
        if (!exercise) return new ValidationStop<E>("EXERCISE_NOT_FOUND", plan.exerciseId);
        const profile = await db.exerciseProfiles.get(plan.exerciseId);
        if (!profile) return new ValidationStop<E>("PROFILE_NOT_FOUND", plan.exerciseId);
        if (profile.weightUnit !== exercise.weightUnit) return new ValidationStop<E>("UNIT_MISMATCH", plan.exerciseId);

        const isT3 = plan.tier === "T3";
        const snapshot = isT3 ? profile.t3WorkingWeight : profile.currentTM;
        if (snapshot === null) return new ValidationStop<E>("MISSING_SNAPSHOT_VALUE", `${plan.tier}:${plan.exerciseId}`);

        const sessionExerciseId = `${sessionId}:${plan.tier}:${plan.exerciseId}`;
        sessionExercises.push({
          sessionExerciseId,
          sessionId,
          exerciseId: plan.exerciseId,
          tier: plan.tier,
          weightUnit: exercise.weightUnit,
          increment: exercise.increment,
          templateId: plan.templateId,
          templateVersion: plan.templateVersion,
          tmAtSession: isT3 ? null : snapshot,
          workingWeightAtSession: isT3 ? snapshot : null,
          workingWeightRevisionAtSession: isT3 ? profile.t3WorkingWeightRevision : null,
          displayOrder,
          restSeconds: plan.restSeconds,
          resetCount: 0,
          lastResetAt: null,
          progressionEvaluatedAt: null,
        });

        let planned: readonly PlannedSet[];
        if (isT3) {
          planned = Array.from({ length: FST7_SET_COUNT }, (_, i) => ({ setNumber: i + 1, targetWeight: snapshot, targetReps: FST7_TARGET_REPS, isAmrap: false }));
        } else if (plan.template) {
          // 스냅샷 TM(반올림하지 않은 값)과 운동의 증가 단위로 계산 → 같은 트랜잭션이라 TM 변경과 어긋나지 않는다
          const calculated = calculateTemplateSets(
            plan.template,
            { value: snapshot, unit: exercise.weightUnit },
            { value: exercise.increment, unit: exercise.weightUnit },
          );
          if (!calculated.ok) return new ValidationStop<E>("TEMPLATE_CALCULATION_FAILED", `${plan.tier}:${plan.exerciseId}: ${calculated.error}`);
          planned = calculated.value;
        } else {
          planned = plan.sets ?? [];
        }
        for (const set of planned) {
          setRecords.push({
            setRecordId: `${sessionExerciseId}#${set.setNumber}`,
            sessionExerciseId,
            sessionId,
            exerciseId: plan.exerciseId,
            tier: plan.tier,
            setNumber: set.setNumber,
            weightUnit: exercise.weightUnit,
            targetWeight: set.targetWeight,
            targetReps: set.targetReps,
            isAmrap: set.isAmrap,
            manualTargetWeight: null,
            completed: false,
            actualWeight: null,
            actualReps: null,
            completedAt: null,
          });
        }
      }

      // 2단계: 한 트랜잭션에서 전부 저장
      const session: WorkoutSession = {
        sessionId,
        scheduledDay: input.scheduledDay,
        workoutDate: input.workoutDate,
        status: "IN_PROGRESS",
        startedAt: now,
        completedAt: null,
        schemaVersion: 1,
      };
      await db.workoutSessions.add(session);
      await db.sessionExercises.bulkAdd(sessionExercises);
      await db.setRecords.bulkAdd(setRecords);
      const detail = await loadSessionDetail(db, sessionId);
      if (!detail) throw new Error("저장 직후 세션을 읽지 못했습니다");
      return detail;
    }),
  );
}

// ─── 세트 입력·완료 ────────────────────────────────────────────────────────

export type SetDraftInput = {
  readonly actualWeight?: Mass | null;
  readonly actualReps?: number | null;
  readonly manualTargetWeight?: Mass | null;
};

export type UpdateSetDraftError =
  | "SET_NOT_FOUND"
  | "SET_LOCKED"
  | "SESSION_NOT_EDITABLE"
  | "UNIT_MISMATCH"
  | "INVALID_ACTUAL_WEIGHT"
  | "INVALID_ACTUAL_REPS"
  | "INVALID_TARGET_WEIGHT";

type WeightCheck = "OK" | "UNIT_MISMATCH" | "INVALID";
const checkWeight = (weight: Mass, unit: SetRecord["weightUnit"]): WeightCheck =>
  weight.unit !== unit ? "UNIT_MISMATCH" : isPositiveFinite(weight.value) ? "OK" : "INVALID";

/**
 * 미완료 세트의 입력 중 값(실제 중량·반복, 수동 목표 중량)을 저장한다. 완료 상태는 바꾸지 않는다.
 * 생략한 필드는 유지하고, null을 넘기면 지운다. 완료된 세트는 SET_LOCKED.
 */
export function updateSetDraft(
  db: NsunsDatabase,
  setRecordId: SetRecordId,
  input: SetDraftInput,
): Promise<StorageResult<IncompleteSetRecord, UpdateSetDraftError>> {
  type E = UpdateSetDraftError;
  return runStorage(() =>
    db.transaction("rw", [db.workoutSessions, db.setRecords], async () => {
      const set = await db.setRecords.get(setRecordId);
      if (!set) return new ValidationStop<E>("SET_NOT_FOUND");
      if (set.completed) return new ValidationStop<E>("SET_LOCKED");
      const session = await db.workoutSessions.get(set.sessionId);
      if (session?.status !== EDITABLE_STATUS) return new ValidationStop<E>("SESSION_NOT_EDITABLE");

      if (input.actualWeight) {
        const check = checkWeight(input.actualWeight, set.weightUnit);
        if (check !== "OK") return new ValidationStop<E>(check === "UNIT_MISMATCH" ? "UNIT_MISMATCH" : "INVALID_ACTUAL_WEIGHT");
      }
      if (input.manualTargetWeight) {
        const check = checkWeight(input.manualTargetWeight, set.weightUnit);
        if (check !== "OK") return new ValidationStop<E>(check === "UNIT_MISMATCH" ? "UNIT_MISMATCH" : "INVALID_TARGET_WEIGHT");
      }
      if (input.actualReps !== undefined && input.actualReps !== null && !isNonNegativeInteger(input.actualReps)) {
        return new ValidationStop<E>("INVALID_ACTUAL_REPS");
      }

      const updated: IncompleteSetRecord = {
        ...set,
        actualWeight: input.actualWeight === undefined ? set.actualWeight : (input.actualWeight?.value ?? null),
        actualReps: input.actualReps === undefined ? set.actualReps : input.actualReps,
        manualTargetWeight: input.manualTargetWeight === undefined ? set.manualTargetWeight : (input.manualTargetWeight?.value ?? null),
      };
      await db.setRecords.put(updated);
      return updated;
    }),
  );
}

export type CompleteSetInput = { readonly actualWeight: Mass; readonly actualReps: number };

export type CompleteSetError =
  | "SET_NOT_FOUND"
  | "SESSION_NOT_EDITABLE"
  | "SET_ALREADY_COMPLETED"
  | "UNIT_MISMATCH"
  | "INVALID_ACTUAL_WEIGHT"
  | "INVALID_ACTUAL_REPS";

export type CompleteSetOutcome = {
  readonly set: CompletedSetRecord;
  /** 같은 운동에서 다음으로 진행할 세트 번호. 없으면 null */
  readonly nextSetNumber: number | null;
  /** 남은 미완료 세트가 있으면 휴식 타이머를 시작한다 (CR-CK-09·10) */
  readonly startRestTimer: boolean;
};

/**
 * 세트 완료 체크 (CALCULATION_RULES 9.4, 10.11).
 * 트랜잭션 안에서 세트·세션 상태를 다시 읽어 판단하므로, 중복 탭·중복 클릭으로 두 번 호출돼도 한 번만 완료된다.
 * 실제 반복은 0 이상의 정수(0회 실패 세트 허용), 실제 중량은 세트 단위의 양수.
 */
export function completeSet(
  db: NsunsDatabase,
  setRecordId: SetRecordId,
  input: CompleteSetInput,
  options?: RepositoryOptions,
): Promise<StorageResult<CompleteSetOutcome, CompleteSetError>> {
  type E = CompleteSetError;
  return runStorage(() =>
    db.transaction("rw", [db.workoutSessions, db.setRecords], async () => {
      const set = await db.setRecords.get(setRecordId);
      if (!set) return new ValidationStop<E>("SET_NOT_FOUND");
      const session = await db.workoutSessions.get(set.sessionId);
      if (session?.status !== EDITABLE_STATUS) return new ValidationStop<E>("SESSION_NOT_EDITABLE");
      if (set.completed) return new ValidationStop<E>("SET_ALREADY_COMPLETED");

      const check = checkWeight(input.actualWeight, set.weightUnit);
      if (check !== "OK") return new ValidationStop<E>(check === "UNIT_MISMATCH" ? "UNIT_MISMATCH" : "INVALID_ACTUAL_WEIGHT");
      if (!isNonNegativeInteger(input.actualReps)) return new ValidationStop<E>("INVALID_ACTUAL_REPS");

      const completed: CompletedSetRecord = {
        ...set,
        completed: true,
        actualWeight: input.actualWeight.value,
        actualReps: input.actualReps,
        completedAt: nowOf(options),
      };
      await db.setRecords.put(completed);

      const siblings = await db.setRecords.where("sessionExerciseId").equals(set.sessionExerciseId).toArray();
      const nextSetNumber = nextIncompleteSetNumber(siblings);
      return { set: completed, nextSetNumber, startRestTimer: nextSetNumber !== null };
    }),
  );
}

// ─── 운동별 리셋 ───────────────────────────────────────────────────────────

export type ResetSessionExerciseError = "SESSION_EXERCISE_NOT_FOUND" | "RESET_NOT_ALLOWED";

/**
 * 운동 하나(SessionExercise)의 모든 세트를 리셋한다 (FUNCTIONS 9.4, CALCULATION_RULES 9.4).
 * - 초기화: completed, completedAt, actualWeight, actualReps
 * - 보존: 목표값, manualTargetWeight, 템플릿·TM/작업 중량·증가 단위 스냅샷
 * - 갱신: resetCount + 1, lastResetAt
 * - 변경 금지: 다른 운동, 세션 상태, 프로필, TM 이력
 * 세트 쓰기 → 운동 이력 쓰기 순서이며, 어느 쪽이든 실패하면 트랜잭션 전체가 롤백된다.
 *
 * 완료 세트 잠금 해제: 세션 상태·소속을 검증한 뒤 이 트랜잭션에만 유효한 리셋 허가를 db에 남긴다.
 * 테이블 훅은 허가된 운동의 세트를 정확히 4개 필드만 초기화하는 변경만 통과시킨다.
 */
export function resetSessionExercise(
  db: NsunsDatabase,
  target: { readonly sessionId: SessionId; readonly sessionExerciseId: SessionExerciseId },
  options?: RepositoryOptions,
): Promise<StorageResult<SessionExerciseDetail, ResetSessionExerciseError>> {
  type E = ResetSessionExerciseError;
  return runStorage(() =>
    db.transaction("rw", [db.workoutSessions, db.sessionExercises, db.setRecords], async (transaction) => {
      const sessionExercise = await db.sessionExercises.get(target.sessionExerciseId);
      if (!sessionExercise || sessionExercise.sessionId !== target.sessionId) return new ValidationStop<E>("SESSION_EXERCISE_NOT_FOUND");
      const session = await db.workoutSessions.get(target.sessionId);
      if (!session || !RESETTABLE_STATUSES.includes(session.status)) return new ValidationStop<E>("RESET_NOT_ALLOWED", session?.status);

      // 검증을 모두 통과한 뒤에만 허가. db.ts 훅이 허용하는 유일한 완료 세트 변경: 이 운동의 세트, 정확히 4개 필드를 초기값으로
      db.grantExerciseReset(transaction, { sessionId: target.sessionId, sessionExerciseId: target.sessionExerciseId });
      await db.setRecords
        .where("sessionExerciseId")
        .equals(target.sessionExerciseId)
        .modify({ completed: false, actualWeight: null, actualReps: null, completedAt: null });
      await db.sessionExercises.update(target.sessionExerciseId, {
        resetCount: sessionExercise.resetCount + 1,
        lastResetAt: nowOf(options),
      });

      const updated = await db.sessionExercises.get(target.sessionExerciseId);
      const sets = await db.setRecords.where("sessionExerciseId").equals(target.sessionExerciseId).toArray();
      if (!updated) throw new Error("리셋 직후 운동을 읽지 못했습니다");
      return toExerciseDetail(updated, sets);
    }),
  );
}

// ─── 하루 세션 완료 ────────────────────────────────────────────────────────

export type T3ProgressionOutcome = {
  readonly sessionExerciseId: SessionExerciseId;
  readonly exerciseId: string;
  readonly decision: Fst7Decision;
  /** 프로필 작업 중량을 실제로 바꿨는지 */
  readonly applied: boolean;
  /** INCREASE인데 적용하지 않은 이유. PROFILE_CHANGED = 세션 중 사용자가 작업 중량을 수정함 (U-22, 사용자 값 우선) */
  readonly skippedReason: "PROFILE_CHANGED" | null;
};

export type CompleteSessionOutcome = {
  readonly session: WorkoutSession;
  readonly t3Progressions: T3ProgressionOutcome[];
  /** 증량 규칙이 미확정이라 판정하지 않은 T1·T2 운동 (U-01·U-02·U-04) */
  readonly pendingProgressions: { sessionExerciseId: SessionExerciseId; exerciseId: string; tier: Tier }[];
};

export type CompleteSessionError =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_IN_PROGRESS"
  | "SESSION_HAS_INCOMPLETE_SETS"
  | "PROGRESSION_EVALUATION_FAILED";

/**
 * 하루 세션을 COMPLETED로 바꾸고 T3 FST-7 증량을 판정·반영한다 (CALCULATION_RULES 6.4·8.3·9.3).
 *
 * - IN_PROGRESS에서만 가능. 이미 COMPLETED면 SESSION_NOT_IN_PROGRESS이므로 증량이 두 번 반영되지 않는다.
 * - U-21: 세션의 모든 예정 세트가 완료되어야 한다. 하나라도 미완료면 SESSION_HAS_INCOMPLETE_SETS로 거부하고
 *   아무것도 바꾸지 않는다(T3 증량도 없음). 중간에 그만두는 경우는 ABANDONED로 별도 처리한다(후속 단계).
 * - 판정은 evaluateFST7Progress(순수 함수)를 재사용하고, 판정한 운동은 progressionEvaluatedAt을 기록한다.
 *   이미 값이 있는 운동은 건너뛴다(멱등성 보조 장치).
 * - U-22: INCREASE여도 세션 도중 사용자가 작업 중량을 바꿨다면(프로필 변경 번호가 세션 시작 스냅샷과 다름)
 *   덮어쓰지 않는다. 세션 스냅샷과 세트 기록은 어떤 경우에도 바꾸지 않는다.
 * - 세션 상태·판정 시각·프로필 변경은 한 트랜잭션이다.
 */
export function completeWorkoutSession(
  db: NsunsDatabase,
  sessionId: SessionId,
  options?: RepositoryOptions,
): Promise<StorageResult<CompleteSessionOutcome, CompleteSessionError>> {
  type E = CompleteSessionError;
  return runStorage(() =>
    db.transaction("rw", [db.workoutSessions, db.sessionExercises, db.setRecords, db.exerciseProfiles], async () => {
      const detail = await loadSessionDetail(db, sessionId);
      if (!detail) return new ValidationStop<E>("SESSION_NOT_FOUND");
      if (detail.session.status !== "IN_PROGRESS") return new ValidationStop<E>("SESSION_NOT_IN_PROGRESS", detail.session.status);
      const incomplete = detail.exercises.flatMap((e) => e.sets).filter((set) => !set.completed);
      if (incomplete.length > 0) return new ValidationStop<E>("SESSION_HAS_INCOMPLETE_SETS", `미완료 세트 ${incomplete.length}개`);

      const now = nowOf(options);
      const t3Progressions: T3ProgressionOutcome[] = [];
      const profileUpdates: { exerciseId: string; value: number; revision: number }[] = [];

      // 1단계: 판정 (쓰기 없음)
      for (const { sessionExercise: se, sets } of detail.exercises) {
        if (se.tier !== "T3" || se.progressionEvaluatedAt !== null || se.workingWeightAtSession === null) continue;
        const unit = se.weightUnit;
        const result = evaluateFST7Progress({
          workingWeightAtSession: { value: se.workingWeightAtSession, unit },
          increment: { value: se.increment, unit },
          sets: sets.map((s) => ({
            setNumber: s.setNumber,
            completed: s.completed,
            actualWeight: s.actualWeight === null ? null : { value: s.actualWeight, unit: s.weightUnit },
            actualReps: s.actualReps,
          })),
        });
        if (!result.ok) return new ValidationStop<E>("PROGRESSION_EVALUATION_FAILED", `${se.exerciseId}: ${result.error}`);

        let applied = false;
        let skippedReason: T3ProgressionOutcome["skippedReason"] = null;
        if (result.value.decision === "INCREASE") {
          const profile = await db.exerciseProfiles.get(se.exerciseId);
          const untouchedDuringSession =
            profile !== undefined &&
            profile.weightUnit === unit &&
            se.workingWeightRevisionAtSession !== null &&
            profile.t3WorkingWeightRevision === se.workingWeightRevisionAtSession;
          if (profile && untouchedDuringSession) {
            profileUpdates.push({ exerciseId: se.exerciseId, value: result.value.nextWorkingWeight.value, revision: profile.t3WorkingWeightRevision + 1 });
            applied = true;
          } else {
            skippedReason = "PROFILE_CHANGED";
          }
        }
        t3Progressions.push({ sessionExerciseId: se.sessionExerciseId, exerciseId: se.exerciseId, decision: result.value, applied, skippedReason });
      }

      // 2단계: 저장 (세션 → 판정 시각 → 프로필). 하나라도 실패하면 전부 롤백
      const session: WorkoutSession = { ...detail.session, status: "COMPLETED", completedAt: now };
      await db.workoutSessions.put(session);
      for (const outcome of t3Progressions) {
        await db.sessionExercises.update(outcome.sessionExerciseId, { progressionEvaluatedAt: now });
      }
      for (const update of profileUpdates) {
        await db.exerciseProfiles.update(update.exerciseId, { t3WorkingWeight: update.value, t3WorkingWeightRevision: update.revision, updatedAt: now });
      }

      const pendingProgressions = detail.exercises
        .filter((e) => e.sessionExercise.tier !== "T3")
        .map(({ sessionExercise: se }) => ({ sessionExerciseId: se.sessionExerciseId, exerciseId: se.exerciseId, tier: se.tier }));
      return { session, t3Progressions, pendingProgressions };
    }),
  );
}
