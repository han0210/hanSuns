/**
 * 저장 계층 테스트 공통 도구.
 * fake-indexeddb는 Node 메모리에서 IndexedDB API를 흉내 낸다.
 * 트랜잭션·인덱스·롤백 동작 검증용이며, iOS Safari 등 실제 브라우저의 저장 공간 정책(용량 제한,
 * 자동 삭제)은 재현하지 않는다.
 */
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { NsunsDatabase } from "@/storage/db";
import type { Clock } from "@/storage/ids";
import { saveExercise, initializeExerciseProfile } from "@/storage/repositories/exerciseRepository";
import { completeSet, type SessionDetail } from "@/storage/repositories/workoutRepository";
import type { SetRecord } from "@/domain/types/model";
import { kg, lb } from "@/domain/types/weight";

let counter = 0;

/** 전역 indexedDB를 건드리지 않고 fake-indexeddb를 Dexie에 직접 주입한다 */
const FAKE_DEPS = { indexedDB, IDBKeyRange };

/** 테스트마다 이름이 다른 DB를 만든다 (테스트 간 데이터 공유 방지) */
export function createTestDatabase(): NsunsDatabase {
  counter += 1;
  return new NsunsDatabase(`nsuns-test-${Date.now()}-${counter}`, FAKE_DEPS);
}

/** 같은 이름의 DB를 새 연결로 연다. 다른 브라우저 탭 또는 새로고침 후 다시 연 상황을 흉내 낸다 */
export function openSameDatabase(db: NsunsDatabase): NsunsDatabase {
  return new NsunsDatabase(db.name, FAKE_DEPS);
}

export async function destroyDatabase(db: NsunsDatabase): Promise<void> {
  await db.delete();
}

/** 호출할 때마다 1초씩 증가하는 고정 시계 */
export function createTestClock(start = "2026-10-21T09:00:00.000Z"): Clock {
  let time = Date.parse(start);
  return () => {
    const now = new Date(time);
    time += 1000;
    return now;
  };
}

export function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: string; message?: string }): T {
  if (!result.ok) throw new Error(`expected ok but got ${result.error}${result.message ? `: ${result.message}` : ""}`);
  return result.value;
}

/**
 * 공통 운동 데이터.
 * - bench / ohp: T1·T2용 바벨 (kg, 2.5)
 * - latPulldown: T3 케이블 (kg, 2.5)
 * - dbCurl: T3 덤벨 (lb, 5, 한 손 기준)
 */
export async function seedExercises(db: NsunsDatabase, clock: Clock): Promise<void> {
  expectOk(await saveExercise(db, { exerciseId: "bench", name: "벤치 프레스", equipment: "BARBELL", weightUnit: "kg", increment: 2.5 }, { clock }));
  expectOk(await saveExercise(db, { exerciseId: "ohp", name: "오버헤드 프레스", equipment: "BARBELL", weightUnit: "kg", increment: 2.5 }, { clock }));
  expectOk(await saveExercise(db, { exerciseId: "latPulldown", name: "랫풀다운", equipment: "CABLE", weightUnit: "kg", increment: 2.5 }, { clock }));
  expectOk(await saveExercise(db, { exerciseId: "dbCurl", name: "덤벨 컬", equipment: "DUMBBELL", weightUnit: "lb", increment: 5 }, { clock }));
}

/** 운동 + 프로필 (bench 1RM 100 → TM 90, ohp 1RM 60 → TM 54, 랫풀다운 50kg, 덤벨 컬 25lb 한 손) */
export async function seedProfiles(db: NsunsDatabase, clock: Clock): Promise<void> {
  await seedExercises(db, clock);
  expectOk(await initializeExerciseProfile(db, { exerciseId: "bench", oneRepMax: kg(100), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, { clock }));
  expectOk(await initializeExerciseProfile(db, { exerciseId: "ohp", oneRepMax: kg(60), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, { clock }));
  expectOk(await initializeExerciseProfile(db, { exerciseId: "latPulldown", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: kg(50) }, { clock }));
  expectOk(await initializeExerciseProfile(db, { exerciseId: "dbCurl", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: lb(25) }, { clock }));
}

/**
 * 테스트용 T1·T2 세트 계획. 실제 nSuns 템플릿 값이 아니다(U-01·U-02 미확정).
 * 저장 계층은 호출자가 계산한 목표값을 그대로 보존하는지만 검증한다.
 */
export const FIXTURE_T1_SETS = [
  { setNumber: 1, targetWeight: 67.5, targetReps: 5, isAmrap: false },
  { setNumber: 2, targetWeight: 77.5, targetReps: 3, isAmrap: false },
  { setNumber: 3, targetWeight: 85, targetReps: 1, isAmrap: true },
] as const;

export const FIXTURE_T2_SETS = [
  { setNumber: 1, targetWeight: 27.5, targetReps: 6, isAmrap: false },
  { setNumber: 2, targetWeight: 32.5, targetReps: 5, isAmrap: false },
] as const;

/** 진행 중 세션 하나를 시작한다: T1 벤치, T2 OHP, T3 랫풀다운, T3 덤벨 컬 */
export function fixturePlan() {
  return {
    scheduledDay: "MONDAY" as const,
    workoutDate: "2026-10-21",
    exercises: [
      { exerciseId: "bench", tier: "T1" as const, templateId: "fixture-t1", templateVersion: 1, restSeconds: 180, sets: FIXTURE_T1_SETS },
      { exerciseId: "ohp", tier: "T2" as const, templateId: "fixture-t2", templateVersion: 1, restSeconds: 120, sets: FIXTURE_T2_SETS },
      { exerciseId: "latPulldown", tier: "T3" as const, templateId: null, templateVersion: null, restSeconds: 45 },
      { exerciseId: "dbCurl", tier: "T3" as const, templateId: null, templateVersion: null, restSeconds: 45 },
    ],
  };
}

/**
 * 세션의 모든 세트를 목표값대로 완료한다 (U-21: 세션 완료 전제 조건).
 * @param reps 세트별 실제 반복을 바꾸고 싶을 때 (기본: 목표 반복)
 */
export async function completeEverySet(
  db: NsunsDatabase,
  detail: SessionDetail,
  clock: Clock,
  reps: (set: SetRecord) => number = (set) => set.targetReps,
): Promise<void> {
  for (const { sets } of detail.exercises) {
    for (const set of sets) {
      if (set.completed) continue;
      expectOk(await completeSet(db, set.setRecordId, { actualWeight: { value: set.targetWeight, unit: set.weightUnit }, actualReps: reps(set) }, { clock }));
    }
  }
}
