/**
 * nSuns Hybrid IndexedDB 스키마 (Dexie).
 *
 * - 브라우저 클라이언트에서만 연다. 모듈을 불러오는 것만으로는 IndexedDB에 접근하지 않으므로
 *   Next.js 서버 렌더링·빌드에서 오류가 나지 않는다 (getBrowserDatabase 참고).
 * - UI는 테이블을 직접 수정하지 않고 repositories의 함수만 쓴다.
 * - 완료 세트 잠금은 서비스 검증에 더해 테이블 훅에서도 강제한다 (readonly는 컴파일 시점 제약일 뿐).
 *
 * 잠금의 한계: 이 훅은 앱 코드가 실수로(또는 다른 경로로) 완료 세트를 바꾸는 것을 막는다.
 * 사용자가 브라우저 개발자 도구로 IndexedDB를 직접 고치거나 DB 자체를 삭제하는 것은 클라이언트 로컬 DB의
 * 특성상 막을 수 없다.
 */
import Dexie, { type DexieOptions, type EntityTable, type Transaction } from "dexie";
import type {
  Exercise,
  ExerciseProfile,
  SessionExercise,
  SetRecord,
  TMChange,
  WorkoutSession,
} from "@/domain/types/model";

export const DATABASE_NAME = "nsuns-hybrid";
export const SCHEMA_VERSION = 1;

/**
 * 테이블별 기본 키와 인덱스 (Dexie 문법: 첫 항목이 기본 키, &는 유일, [a+b]는 복합 인덱스).
 * boolean(completed)은 IndexedDB 키가 될 수 없어 인덱스로 쓰지 않는다.
 */
export const SCHEMA = {
  exercises: "exerciseId, equipment",
  exerciseProfiles: "exerciseId",
  workoutSessions: "sessionId, status, workoutDate, startedAt",
  // displayOrder: 세션 안 표시 순서. 같은 세션에서 같은 순서 번호가 두 번 나오지 않게 유일 인덱스로 둔다.
  sessionExercises: "sessionExerciseId, sessionId, exerciseId, &[sessionId+exerciseId+tier], &[sessionId+displayOrder]",
  setRecords: "setRecordId, sessionExerciseId, sessionId, &[sessionExerciseId+setNumber]",
  // 증량 중복 방지: 같은 (세션, 운동, 티어)에서 나온 TM 변경은 하나만 저장된다.
  // 최초 설정(INITIAL)처럼 sourceSessionId가 null이면 이 인덱스에 들어가지 않으므로 제약을 받지 않는다.
  tmChanges: "tmChangeId, exerciseId, appliedAt, &[sourceSessionId+exerciseId+sourceTier]",
} as const;

/** 완료 세트를 바꾸려는 쓰기를 거부할 때 던지는 오류 */
export class CompletedSetLockedError extends Error {
  constructor(setRecordId: string) {
    super(`완료된 세트는 개별 수정할 수 없습니다: ${setRecordId}`);
    this.name = "CompletedSetLockedError";
  }
}

/** 완료 세트가 아닌데 완료 상태로 만들려는 등 세트 레코드 형태가 잘못된 쓰기를 거부할 때 던지는 오류 */
export class InvalidSetRecordError extends Error {
  constructor(setRecordId: string, reason: string) {
    super(`잘못된 세트 기록입니다 (${reason}): ${setRecordId}`);
    this.name = "InvalidSetRecordError";
  }
}

/** 완료 상태(completed = true)면 실제 중량·반복·완료 시각이 모두 있어야 한다 (CompletedSetRecord 규칙의 런타임 검사) */
function assertCompletedShape(record: SetRecord, setRecordId: string): void {
  if (record.completed && (record.actualWeight === null || record.actualReps === null || record.completedAt === null)) {
    throw new InvalidSetRecordError(setRecordId, "완료 세트에 실제값·완료 시각 없음");
  }
}

/**
 * 운동별 리셋 허가 목록. 트랜잭션 객체를 키로 쓰므로 그 트랜잭션 안에서만 유효하고,
 * 트랜잭션이 끝나면 함께 사라진다(WeakMap). 모듈 밖에서는 NsunsDatabase.grantExerciseReset으로만 추가한다.
 */
type ResetGrant = { readonly sessionId: string; readonly sessionExerciseId: string };
const resetGrants = new WeakMap<Transaction, ResetGrant[]>();

const isGranted = (transaction: Transaction | undefined, record: SetRecord): boolean =>
  transaction !== undefined &&
  (resetGrants.get(transaction) ?? []).some((g) => g.sessionId === record.sessionId && g.sessionExerciseId === record.sessionExerciseId);

/** 운동별 리셋이 초기화하는 필드. 이 4개 외의 필드(목표값 등)는 리셋으로도 바꾸지 않는다 */
const RESET_FIELDS = ["completed", "actualWeight", "actualReps", "completedAt"] as const;

/**
 * 운동별 리셋이 쓰는 변경인지 확인한다.
 * 정확히 4개 필드만, 모두 초기값(false/null)으로 바꾸는 경우만 허용한다.
 * (Dexie는 put()으로 덮어쓸 때도 바뀐 필드만 modifications로 넘긴다.)
 */
function isFullResetModification(modifications: Record<string, unknown>): boolean {
  const keys = Object.keys(modifications);
  return (
    keys.length === RESET_FIELDS.length &&
    RESET_FIELDS.every((field) => field in modifications) &&
    modifications.completed === false &&
    modifications.actualWeight === null &&
    modifications.actualReps === null &&
    modifications.completedAt === null
  );
}

export class NsunsDatabase extends Dexie {
  exercises!: EntityTable<Exercise, "exerciseId">;
  exerciseProfiles!: EntityTable<ExerciseProfile, "exerciseId">;
  workoutSessions!: EntityTable<WorkoutSession, "sessionId">;
  sessionExercises!: EntityTable<SessionExercise, "sessionExerciseId">;
  setRecords!: EntityTable<SetRecord, "setRecordId">;
  tmChanges!: EntityTable<TMChange, "tmChangeId">;

  constructor(name: string = DATABASE_NAME, options?: DexieOptions) {
    super(name, options);
    this.version(SCHEMA_VERSION).stores(SCHEMA);

    // 런타임 잠금. 완료 세트의 변경은 아래 세 조건을 모두 만족할 때만 통과한다.
    //  1) 현재 트랜잭션에 resetSessionExercise()가 남긴 리셋 허가가 있다 (세션 상태 검증 후에만 남김)
    //  2) 허가된 세션·운동(sessionExerciseId)의 세트다 (다른 운동 세트는 같은 트랜잭션에서도 거부)
    //  3) 변경 내용이 정확히 4개 필드를 초기값으로 되돌리는 것이다 (목표값 등 다른 필드 변경 거부)
    // 삭제(delete, where().delete(), clear())는 완료 세트에 대해 항상 거부한다.
    this.setRecords.hook("creating", (primKey, record) => {
      assertCompletedShape(record, String(primKey));
      return undefined;
    });
    this.setRecords.hook("updating", (modifications, primKey, existing, transaction) => {
      const changes = modifications as Record<string, unknown>;
      if (existing.completed) {
        const allowed = isGranted(transaction, existing) && isFullResetModification(changes);
        if (!allowed) throw new CompletedSetLockedError(String(primKey));
        return undefined;
      }
      assertCompletedShape({ ...existing, ...changes } as SetRecord, String(primKey));
      return undefined;
    });
    this.setRecords.hook("deleting", (primKey, existing) => {
      if (existing.completed) throw new CompletedSetLockedError(String(primKey));
    });
  }

  /**
   * 현재 트랜잭션에서 운동 하나의 완료 세트 리셋을 허가한다.
   * resetSessionExercise()가 같은 트랜잭션 안에서 세션 상태(IN_PROGRESS·PAUSED)와 소속을 검증한 직후에만 호출한다.
   * @internal 저장 계층 전용. UI·기능 코드에서 호출하지 않는다.
   */
  grantExerciseReset(transaction: Transaction, grant: ResetGrant): void {
    resetGrants.set(transaction, [...(resetGrants.get(transaction) ?? []), grant]);
  }
}

let browserDatabase: NsunsDatabase | null = null;

/**
 * 브라우저에서 쓸 DB 인스턴스. IndexedDB가 없는 환경(서버 렌더링, 빌드, 일부 사생활 보호 모드)에서는 null.
 * 클라이언트 컴포넌트의 이벤트·effect 안에서만 호출한다.
 */
export function getBrowserDatabase(): NsunsDatabase | null {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") return null;
  browserDatabase ??= new NsunsDatabase();
  return browserDatabase;
}
