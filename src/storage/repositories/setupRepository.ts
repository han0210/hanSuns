/**
 * 최초 설정(Setup) 일괄 저장소.
 *
 * Setup은 운동 마스터 여러 개와 프로필 여러 개를 한 번에 확정한다. 운동마다 따로 저장하면 중간에 실패했을 때
 * 일부만 저장된 설정이 남으므로, 이 함수는 전체를 하나의 readwrite 트랜잭션으로 묶는다.
 * 개별 검증 규칙은 exerciseRepository의 saveExercise·initializeExerciseProfile을 그대로 재사용한다
 * (Dexie는 바깥 트랜잭션 안에서 연 트랜잭션을 같은 트랜잭션의 하위 작업으로 실행한다).
 */
import type { Exercise, ExerciseProfile } from "@/domain/types/model";
import type { NsunsDatabase } from "../db";
import { runStorage, ValidationStop, type StorageResult } from "../result";
import {
  initializeExerciseProfile,
  saveExercise,
  type ExerciseInput,
  type InitializeProfileError,
  type InitializeProfileInput,
  type RepositoryOptions,
  type SaveExerciseError,
} from "./exerciseRepository";

export type InitialSetupInput = {
  readonly exercises: readonly ExerciseInput[];
  readonly profiles: readonly InitializeProfileInput[];
};

export type SavedSetup = { readonly exercises: Exercise[]; readonly profiles: ExerciseProfile[] };

export type SaveInitialSetupError = "INVALID_SETUP" | "SETUP_ALREADY_EXISTS" | SaveExerciseError | InitializeProfileError;

/** 하위 작업이 실패했을 때 바깥 트랜잭션을 중단(롤백)시키기 위한 내부 예외 */
class SetupAbort extends Error {
  constructor(readonly code: SaveInitialSetupError | "STORAGE_ERROR", readonly detail?: string) {
    super(`setup aborted: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "SetupAbort";
  }
}

/** 운동 목록과 프로필 목록이 같은 exerciseId 집합인지 */
function isConsistent(input: InitialSetupInput): boolean {
  if (input.exercises.length === 0) return false;
  const exerciseIds = new Set(input.exercises.map((e) => e.exerciseId));
  const profileIds = new Set(input.profiles.map((p) => p.exerciseId));
  return (
    exerciseIds.size === input.exercises.length &&
    profileIds.size === input.profiles.length &&
    exerciseIds.size === profileIds.size &&
    [...exerciseIds].every((id) => profileIds.has(id))
  );
}

/**
 * 최초 설정을 한 번에 저장한다.
 * - 이미 프로필이 하나라도 있으면 SETUP_ALREADY_EXISTS (기존 설정 덮어쓰기 금지, 1RM 수정 정책 U-05 미확정)
 * - 항목 하나라도 실패하면 전체 롤백 (부분 저장 없음)
 * - 두 탭에서 동시에 저장해도 트랜잭션이 순서대로 실행되므로 하나만 성공한다
 */
export function saveInitialSetup(
  db: NsunsDatabase,
  input: InitialSetupInput,
  options?: RepositoryOptions,
): Promise<StorageResult<SavedSetup, SaveInitialSetupError>> {
  type E = SaveInitialSetupError;
  return runStorage<SavedSetup, E>(
    () =>
    db.transaction("rw", [db.exercises, db.exerciseProfiles, db.tmChanges], async () => {
      if (!isConsistent(input)) return new ValidationStop<E>("INVALID_SETUP");
      if ((await db.exerciseProfiles.count()) > 0) return new ValidationStop<E>("SETUP_ALREADY_EXISTS");

      const exercises: Exercise[] = [];
      for (const exerciseInput of input.exercises) {
        const saved = await saveExercise(db, exerciseInput, options);
        if (!saved.ok) throw new SetupAbort(saved.error, `${exerciseInput.exerciseId}${saved.message ? `: ${saved.message}` : ""}`);
        exercises.push(saved.value);
      }
      const profiles: ExerciseProfile[] = [];
      for (const profileInput of input.profiles) {
        const saved = await initializeExerciseProfile(db, profileInput, options);
        if (!saved.ok) throw new SetupAbort(saved.error, `${profileInput.exerciseId}${saved.message ? `: ${saved.message}` : ""}`);
        profiles.push(saved.value);
      }
      return { exercises, profiles };
    }),
    // 하위 작업의 검증 실패는 원래 오류 코드로, IndexedDB 오류는 STORAGE_ERROR로 돌려준다
    (error) => (error instanceof SetupAbort && error.code !== "STORAGE_ERROR" ? error.code : null),
  );
}

/** 저장된 운동 마스터와 프로필 전체. 설정 전이면 빈 목록 */
export function getSavedSetup(db: NsunsDatabase): Promise<StorageResult<SavedSetup, never>> {
  return runStorage(() =>
    db.transaction("r", [db.exercises, db.exerciseProfiles], async () => ({
      exercises: await db.exercises.toArray(),
      profiles: await db.exerciseProfiles.toArray(),
    })),
  );
}
