/**
 * 운동 마스터·운동 프로필·TM 변경 이력 저장소.
 *
 * - 모든 함수는 예외 대신 StorageResult를 돌려준다(성공/실패를 ok로 구분).
 * - 검증은 쓰기 전에 끝내고, 여러 테이블을 바꾸는 작업은 하나의 readwrite 트랜잭션으로 묶는다.
 *   트랜잭션 안에서 예외가 나면 Dexie가 전부 롤백한다.
 * - 중량은 Mass({ value, unit })로 받아 운동 단위와 다르면 UNIT_MISMATCH. 자동 변환은 하지 않는다.
 * - T1·T2 증량 계산 규칙은 미확정(U-01·U-02·U-04)이므로 이 파일은 "계산된 TM을 안전하게 기록"하는
 *   저장 기능(applyTMChange)만 제공하고 증량 값을 스스로 계산하지 않는다.
 */
import type { Exercise, ExerciseId, ExerciseProfile, OneRepMaxSource, SessionId, TMChange } from "@/domain/types/model";
import type { Mass } from "@/domain/types/weight";
import { calculateTM } from "@/domain/calculations/trainingMax";
import { isPositiveFinite } from "@/domain/calculations/precision";
import type { NsunsDatabase } from "../db";
import { createId, systemClock, toIsoDateTime, type Clock } from "../ids";
import { runStorage, ValidationStop, type StorageResult } from "../result";

/** 테스트에서 시각을 고정하기 위한 선택 옵션 */
export type RepositoryOptions = { readonly clock?: Clock };

const nowOf = (options?: RepositoryOptions): string => toIsoDateTime(options?.clock ?? systemClock);

// ─── Exercise ──────────────────────────────────────────────────────────────

export type ExerciseInput = Omit<Exercise, "updatedAt">;
export type SaveExerciseError = "INVALID_EXERCISE" | "INVALID_INCREMENT" | "UNIT_CHANGE_NOT_ALLOWED";

/**
 * 운동 마스터를 저장(생성 또는 덮어쓰기)한다.
 * 이미 프로필이 있는 운동의 단위 변경은 거부한다. 기존 기록의 숫자를 다른 단위로 해석하게 되기 때문이며,
 * 단위 전환 정책은 U-20 미확정이다.
 */
export function saveExercise(db: NsunsDatabase, input: ExerciseInput, options?: RepositoryOptions): Promise<StorageResult<Exercise, SaveExerciseError>> {
  return runStorage(() =>
    db.transaction("rw", [db.exercises, db.exerciseProfiles], async () => {
      if (input.exerciseId.trim() === "" || input.name.trim() === "") return new ValidationStop<SaveExerciseError>("INVALID_EXERCISE");
      if (!isPositiveFinite(input.increment)) return new ValidationStop<SaveExerciseError>("INVALID_INCREMENT");

      const profile = await db.exerciseProfiles.get(input.exerciseId);
      if (profile && profile.weightUnit !== input.weightUnit) return new ValidationStop<SaveExerciseError>("UNIT_CHANGE_NOT_ALLOWED");

      const exercise: Exercise = { ...input, updatedAt: nowOf(options) };
      await db.exercises.put(exercise);
      return exercise;
    }),
  );
}

export function getExercise(db: NsunsDatabase, exerciseId: ExerciseId): Promise<StorageResult<Exercise | null, never>> {
  return runStorage(async () => (await db.exercises.get(exerciseId)) ?? null);
}

// ─── ExerciseProfile ───────────────────────────────────────────────────────

export type InitializeProfileInput = {
  readonly exerciseId: ExerciseId;
  /** T1·T2 기준 1RM. T3 전용 운동이면 null */
  readonly oneRepMax: Mass | null;
  readonly oneRepMaxSource: OneRepMaxSource | null;
  readonly estimateRuleId: string | null;
  /** T3 작업 중량. T1·T2 전용이면 null */
  readonly t3WorkingWeight: Mass | null;
};

export type InitializeProfileError =
  | "EXERCISE_NOT_FOUND"
  | "PROFILE_ALREADY_EXISTS"
  | "UNIT_MISMATCH"
  | "INVALID_1RM"
  | "INVALID_SOURCE"
  | "INVALID_WORKING_WEIGHT"
  | "EMPTY_PROFILE";

/** 1RM 출처와 규칙 ID 조합 검증 (DIRECT는 규칙 없음, 추정 기반은 규칙 필수) */
function isValidSource(input: InitializeProfileInput): boolean {
  if (input.oneRepMax === null) return input.oneRepMaxSource === null && input.estimateRuleId === null;
  if (input.oneRepMaxSource === null) return false;
  if (input.oneRepMaxSource === "DIRECT") return input.estimateRuleId === null;
  return input.estimateRuleId !== null && input.estimateRuleId.trim() !== "";
}

/**
 * Setup 확정 시 운동 프로필을 처음 만든다.
 * 1RM이 있으면 initialTM = currentTM = 1RM × 0.9(calculateTM, 반올림 없음)이고,
 * 같은 트랜잭션에서 INITIAL TM 변경 이력을 남긴다. 둘 중 하나라도 실패하면 둘 다 저장되지 않는다.
 * 1RM 수정 시 currentTM 처리(U-05)는 미확정이라 이 함수는 "최초 생성"만 허용한다.
 */
export function initializeExerciseProfile(
  db: NsunsDatabase,
  input: InitializeProfileInput,
  options?: RepositoryOptions,
): Promise<StorageResult<ExerciseProfile, InitializeProfileError>> {
  type E = InitializeProfileError;
  return runStorage(() =>
    db.transaction("rw", [db.exercises, db.exerciseProfiles, db.tmChanges], async () => {
      const exercise = await db.exercises.get(input.exerciseId);
      if (!exercise) return new ValidationStop<E>("EXERCISE_NOT_FOUND");
      if (await db.exerciseProfiles.get(input.exerciseId)) return new ValidationStop<E>("PROFILE_ALREADY_EXISTS");
      if (input.oneRepMax === null && input.t3WorkingWeight === null) return new ValidationStop<E>("EMPTY_PROFILE");
      const unit = exercise.weightUnit;
      if ((input.oneRepMax && input.oneRepMax.unit !== unit) || (input.t3WorkingWeight && input.t3WorkingWeight.unit !== unit)) {
        return new ValidationStop<E>("UNIT_MISMATCH");
      }
      if (!isValidSource(input)) return new ValidationStop<E>("INVALID_SOURCE");

      let tm: number | null = null;
      if (input.oneRepMax) {
        const result = calculateTM(input.oneRepMax);
        if (!result.ok) return new ValidationStop<E>("INVALID_1RM");
        tm = result.value.value;
      }
      if (input.t3WorkingWeight && !isPositiveFinite(input.t3WorkingWeight.value)) return new ValidationStop<E>("INVALID_WORKING_WEIGHT");

      const now = nowOf(options);
      const profile: ExerciseProfile = {
        exerciseId: input.exerciseId,
        weightUnit: unit,
        oneRepMax: input.oneRepMax?.value ?? null,
        oneRepMaxSource: input.oneRepMaxSource,
        estimateRuleId: input.estimateRuleId,
        initialTM: tm,
        currentTM: tm,
        t3WorkingWeight: input.t3WorkingWeight?.value ?? null,
        t3WorkingWeightRevision: 0,
        updatedAt: now,
      };
      await db.exerciseProfiles.add(profile);
      if (tm !== null) {
        await db.tmChanges.add({
          tmChangeId: createId(),
          exerciseId: input.exerciseId,
          weightUnit: unit,
          fromTM: null,
          toTM: tm,
          reason: "INITIAL",
          sourceSessionId: null,
          sourceTier: null,
          ruleId: null,
          ruleVersion: null,
          appliedAt: now,
        });
      }
      return profile;
    }),
  );
}

export function getExerciseProfile(db: NsunsDatabase, exerciseId: ExerciseId): Promise<StorageResult<ExerciseProfile | null, never>> {
  return runStorage(async () => (await db.exerciseProfiles.get(exerciseId)) ?? null);
}

export type UpdateWorkingWeightError = "PROFILE_NOT_FOUND" | "UNIT_MISMATCH" | "INVALID_WORKING_WEIGHT";

/**
 * 사용자가 T3 작업 중량을 직접 수정한다.
 * - 진행 중 세션의 스냅샷(workingWeightAtSession)과 이미 저장된 세트 기록은 바뀌지 않는다.
 * - 같은 값을 다시 저장해도 t3WorkingWeightRevision을 올린다. 사용자의 명시적 결정으로 보고,
 *   진행 중 세션이 끝날 때 자동 증량이 이 값을 덮어쓰지 않게 한다 (U-22).
 */
export function updateT3WorkingWeight(
  db: NsunsDatabase,
  exerciseId: ExerciseId,
  weight: Mass,
  options?: RepositoryOptions,
): Promise<StorageResult<ExerciseProfile, UpdateWorkingWeightError>> {
  type E = UpdateWorkingWeightError;
  return runStorage(() =>
    db.transaction("rw", [db.exerciseProfiles], async () => {
      const profile = await db.exerciseProfiles.get(exerciseId);
      if (!profile) return new ValidationStop<E>("PROFILE_NOT_FOUND");
      if (weight.unit !== profile.weightUnit) return new ValidationStop<E>("UNIT_MISMATCH");
      if (!isPositiveFinite(weight.value)) return new ValidationStop<E>("INVALID_WORKING_WEIGHT");
      const updated: ExerciseProfile = {
        ...profile,
        t3WorkingWeight: weight.value,
        t3WorkingWeightRevision: profile.t3WorkingWeightRevision + 1,
        updatedAt: nowOf(options),
      };
      await db.exerciseProfiles.put(updated);
      return updated;
    }),
  );
}

// ─── TMChange ──────────────────────────────────────────────────────────────

export type ApplyTMChangeInput = {
  readonly exerciseId: ExerciseId;
  readonly sourceSessionId: SessionId;
  /** T1·T2만. T3는 TM이 아니라 작업 중량을 쓴다 */
  readonly sourceTier: "T1" | "T2";
  /** 호출자가 확정 규칙으로 계산한 새 TM (이 함수는 계산하지 않음) */
  readonly toTM: Mass;
  readonly ruleId: string;
  readonly ruleVersion: number;
};

export type ApplyTMChangeError =
  | "PROFILE_NOT_FOUND"
  | "MISSING_CURRENT_TM"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_COMPLETED"
  | "SESSION_EXERCISE_NOT_FOUND"
  | "UNIT_MISMATCH"
  | "INVALID_TM"
  | "DUPLICATE_PROGRESSION";

/** 같은 키의 이력이 이미 있으면 IndexedDB 유일 인덱스가 ConstraintError를 낸다 (최후 방어선) */
const mapTMConstraintError = (error: unknown): ApplyTMChangeError | null =>
  error instanceof Error && (error.name === "ConstraintError" || error.name === "BulkError") ? "DUPLICATE_PROGRESSION" : null;

/**
 * AMRAP 증량으로 바뀐 TM을 기록한다 (CALCULATION_RULES 6.4·9.3).
 *
 * - 증량은 하루 세션이 COMPLETED일 때만 확정되므로 원천 세션이 COMPLETED여야 한다.
 * - 중복 방지 키 (sourceSessionId, exerciseId, sourceTier): 트랜잭션 안에서 먼저 조회하고,
 *   동시에 두 탭이 쓰더라도 유일 인덱스가 두 번째 쓰기를 거부한다.
 * - currentTM 갱신과 이력 추가는 한 트랜잭션이다. 이력 저장이 실패하면 currentTM도 되돌아간다.
 * - T1·T2 증량 규칙(U-01·U-02·U-04)은 미확정이므로 현재 앱 코드는 이 함수를 호출하지 않는다.
 */
export function applyTMChange(
  db: NsunsDatabase,
  input: ApplyTMChangeInput,
  options?: RepositoryOptions,
): Promise<StorageResult<{ profile: ExerciseProfile; change: TMChange }, ApplyTMChangeError>> {
  type E = ApplyTMChangeError;
  return runStorage(
    () =>
      db.transaction("rw", [db.exerciseProfiles, db.tmChanges, db.workoutSessions, db.sessionExercises], async () => {
        const session = await db.workoutSessions.get(input.sourceSessionId);
        if (!session) return new ValidationStop<E>("SESSION_NOT_FOUND");
        if (session.status !== "COMPLETED") return new ValidationStop<E>("SESSION_NOT_COMPLETED");
        const sessionExercise = await db.sessionExercises
          .where("[sessionId+exerciseId+tier]")
          .equals([input.sourceSessionId, input.exerciseId, input.sourceTier])
          .first();
        if (!sessionExercise) return new ValidationStop<E>("SESSION_EXERCISE_NOT_FOUND");

        const profile = await db.exerciseProfiles.get(input.exerciseId);
        if (!profile) return new ValidationStop<E>("PROFILE_NOT_FOUND");
        if (profile.currentTM === null) return new ValidationStop<E>("MISSING_CURRENT_TM");
        if (input.toTM.unit !== profile.weightUnit) return new ValidationStop<E>("UNIT_MISMATCH");
        if (!isPositiveFinite(input.toTM.value)) return new ValidationStop<E>("INVALID_TM");

        const duplicate = await db.tmChanges
          .where("[sourceSessionId+exerciseId+sourceTier]")
          .equals([input.sourceSessionId, input.exerciseId, input.sourceTier])
          .first();
        if (duplicate) return new ValidationStop<E>("DUPLICATE_PROGRESSION");

        const now = nowOf(options);
        const updated: ExerciseProfile = { ...profile, currentTM: input.toTM.value, updatedAt: now };
        const change: TMChange = {
          tmChangeId: createId(),
          exerciseId: input.exerciseId,
          weightUnit: profile.weightUnit,
          fromTM: profile.currentTM,
          toTM: input.toTM.value,
          reason: "AMRAP_PROGRESSION",
          sourceSessionId: input.sourceSessionId,
          sourceTier: input.sourceTier,
          ruleId: input.ruleId,
          ruleVersion: input.ruleVersion,
          appliedAt: now,
        };
        // 순서: 프로필 → 이력. 이력 쓰기가 실패하면 트랜잭션 전체가 중단되어 프로필 변경도 취소된다.
        await db.exerciseProfiles.put(updated);
        await db.tmChanges.add(change);
        return { profile: updated, change };
      }),
    mapTMConstraintError,
  );
}

/** 운동의 TM 변경 이력 (적용 시각 오름차순) */
export function listTMChanges(db: NsunsDatabase, exerciseId: ExerciseId): Promise<StorageResult<TMChange[], never>> {
  return runStorage(() => db.tmChanges.where("exerciseId").equals(exerciseId).sortBy("appliedAt"));
}
