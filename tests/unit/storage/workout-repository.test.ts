import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompletedSetLockedError, InvalidSetRecordError, NsunsDatabase } from "@/storage/db";
import { getExerciseProfile, listTMChanges, updateT3WorkingWeight } from "@/storage/repositories/exerciseRepository";
import {
  completeSet,
  completeWorkoutSession,
  getActiveSession,
  getSessionDetail,
  resetSessionExercise,
  startWorkoutSession,
  updateSetDraft,
  type SessionDetail,
} from "@/storage/repositories/workoutRepository";
import { kg, lb } from "@/domain/types/weight";
import type { Clock } from "@/storage/ids";
import type { SetRecord } from "@/domain/types/model";
import { completeEverySet, createTestClock, createTestDatabase, destroyDatabase, expectOk, openSameDatabase, FIXTURE_T1_SETS, FIXTURE_T2_SETS, fixturePlan, seedProfiles } from "./helpers";

let db: NsunsDatabase;
let clock: Clock;

beforeEach(async () => {
  db = createTestDatabase();
  clock = createTestClock();
  await seedProfiles(db, clock);
});
afterEach(async () => {
  await destroyDatabase(db);
});

const startFixture = async (): Promise<SessionDetail> => expectOk(await startWorkoutSession(db, fixturePlan(), { clock }));
const byExercise = (detail: SessionDetail, exerciseId: string) => {
  const found = detail.exercises.find((e) => e.sessionExercise.exerciseId === exerciseId);
  if (!found) throw new Error(`missing ${exerciseId}`);
  return found;
};
const reload = async (sessionId: string): Promise<SessionDetail> => {
  const detail = expectOk(await getSessionDetail(db, sessionId));
  if (!detail) throw new Error("session missing");
  return detail;
};
/** 한 운동의 모든 세트를 목표값대로 완료 */
async function completeAll(sets: readonly SetRecord[], weight = (s: SetRecord) => s.targetWeight, reps = (s: SetRecord) => s.targetReps) {
  for (const set of sets) {
    expectOk(await completeSet(db, set.setRecordId, { actualWeight: { value: weight(set), unit: set.weightUnit }, actualReps: reps(set) }, { clock }));
  }
}

describe("startWorkoutSession — 세션 생성과 스냅샷", () => {
  it("IN_PROGRESS 세션과 운동별 스냅샷·세트를 저장한다", async () => {
    const detail = await startFixture();
    expect(detail.session).toMatchObject({ status: "IN_PROGRESS", scheduledDay: "MONDAY", workoutDate: "2026-10-21", completedAt: null, schemaVersion: 1 });
    expect(detail.session.startedAt).not.toBeNull();
    expect(detail.exercises.map((e) => `${e.sessionExercise.tier}:${e.sessionExercise.exerciseId}`)).toEqual(["T1:bench", "T2:ohp", "T3:latPulldown", "T3:dbCurl"]);

    const bench = byExercise(detail, "bench");
    expect(bench.sessionExercise).toMatchObject({ tmAtSession: 90, workingWeightAtSession: null, weightUnit: "kg", increment: 2.5, templateId: "fixture-t1", templateVersion: 1, resetCount: 0, lastResetAt: null, progressionEvaluatedAt: null });
    expect(bench.sets.map((s) => [s.setNumber, s.targetWeight, s.targetReps, s.isAmrap, s.completed])).toEqual(
      FIXTURE_T1_SETS.map((s) => [s.setNumber, s.targetWeight, s.targetReps, s.isAmrap, false]),
    );
    expect(bench.nextSetNumber).toBe(1);
  });

  it("T3는 프로필 작업 중량으로 FST-7 (7세트 × 12회)을 생성한다", async () => {
    const lat = byExercise(await startFixture(), "latPulldown");
    expect(lat.sessionExercise).toMatchObject({ tmAtSession: null, workingWeightAtSession: 50, templateId: null });
    expect(lat.sets).toHaveLength(7);
    expect(lat.sets.every((s) => s.targetWeight === 50 && s.targetReps === 12 && !s.isAmrap)).toBe(true);
  });

  it("덤벨 lb 운동은 한 손 기준 lb 값 그대로 스냅샷한다 (U-19)", async () => {
    const curl = byExercise(await startFixture(), "dbCurl");
    expect(curl.sessionExercise).toMatchObject({ weightUnit: "lb", increment: 5, workingWeightAtSession: 25 });
    expect(curl.sets.every((s) => s.weightUnit === "lb" && s.targetWeight === 25)).toBe(true);
  });

  it("세션 시작 후 프로필이 바뀌어도 스냅샷은 그대로다", async () => {
    const detail = await startFixture();
    expectOk(await updateT3WorkingWeight(db, "latPulldown", kg(60), { clock }));
    const lat = byExercise(await reload(detail.session.sessionId), "latPulldown");
    expect(lat.sessionExercise.workingWeightAtSession).toBe(50);
    expect(lat.sets[0].targetWeight).toBe(50);
  });

  it("진행 중 세션이 있으면 ACTIVE_SESSION_EXISTS", async () => {
    await startFixture();
    expect(await startWorkoutSession(db, fixturePlan(), { clock })).toMatchObject({ ok: false, error: "ACTIVE_SESSION_EXISTS" });
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it("두 탭에서 동시에 시작해도 진행 중 세션은 하나만 생긴다", async () => {
    const otherTab = openSameDatabase(db);
    const results = await Promise.all([startWorkoutSession(db, fixturePlan(), { clock }), startWorkoutSession(otherTab, fixturePlan(), { clock })]);
    otherTab.close();
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "ACTIVE_SESSION_EXISTS" });
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it.each([
    ["빈 계획", { exercises: [] }, "INVALID_SESSION_PLAN"],
    ["T1 세트 없음", { exercises: [{ exerciseId: "bench", tier: "T1", templateId: null, templateVersion: null, restSeconds: 180, sets: [] }] }, "INVALID_SESSION_PLAN"],
    ["T3에 세트 지정", { exercises: [{ exerciseId: "latPulldown", tier: "T3", templateId: null, templateVersion: null, restSeconds: 45, sets: [{ setNumber: 1, targetWeight: 50, targetReps: 12, isAmrap: false }] }] }, "INVALID_SESSION_PLAN"],
    ["세트 번호 중복", { exercises: [{ exerciseId: "bench", tier: "T1", templateId: null, templateVersion: null, restSeconds: 180, sets: [{ setNumber: 1, targetWeight: 50, targetReps: 5, isAmrap: false }, { setNumber: 1, targetWeight: 50, targetReps: 5, isAmrap: false }] }] }, "INVALID_SESSION_PLAN"],
    ["목표 중량 0", { exercises: [{ exerciseId: "bench", tier: "T1", templateId: null, templateVersion: null, restSeconds: 180, sets: [{ setNumber: 1, targetWeight: 0, targetReps: 5, isAmrap: false }] }] }, "INVALID_SESSION_PLAN"],
    ["운동·티어 중복", { exercises: [{ exerciseId: "latPulldown", tier: "T3", templateId: null, templateVersion: null, restSeconds: 45 }, { exerciseId: "latPulldown", tier: "T3", templateId: null, templateVersion: null, restSeconds: 45 }] }, "INVALID_SESSION_PLAN"],
    ["운동 없음", { exercises: [{ exerciseId: "none", tier: "T3", templateId: null, templateVersion: null, restSeconds: 45 }] }, "EXERCISE_NOT_FOUND"],
    ["T1인데 TM 없음", { exercises: [{ exerciseId: "latPulldown", tier: "T1", templateId: null, templateVersion: null, restSeconds: 45, sets: FIXTURE_T1_SETS }] }, "MISSING_SNAPSHOT_VALUE"],
    ["T3인데 작업 중량 없음", { exercises: [{ exerciseId: "bench", tier: "T3", templateId: null, templateVersion: null, restSeconds: 45 }] }, "MISSING_SNAPSHOT_VALUE"],
  ] as const)("%s → %s, 아무것도 저장하지 않음", async (_label, override, error) => {
    const result = await startWorkoutSession(db, { ...fixturePlan(), ...override }, { clock });
    expect(result).toMatchObject({ ok: false, error });
    expect(await db.workoutSessions.count()).toBe(0);
    expect(await db.sessionExercises.count()).toBe(0);
    expect(await db.setRecords.count()).toBe(0);
  });

  it("프로필이 없으면 PROFILE_NOT_FOUND", async () => {
    await db.exercises.put({ exerciseId: "row", name: "로우", equipment: "BARBELL", weightUnit: "kg", increment: 2.5, updatedAt: "2026-10-21T00:00:00.000Z" });
    const result = await startWorkoutSession(db, { ...fixturePlan(), exercises: [{ exerciseId: "row", tier: "T3", templateId: null, templateVersion: null, restSeconds: 45 }] }, { clock });
    expect(result).toMatchObject({ ok: false, error: "PROFILE_NOT_FOUND" });
  });

  it("프로필 단위가 운동 단위와 다르면 UNIT_MISMATCH", async () => {
    const profile = expectOk(await getExerciseProfile(db, "latPulldown"))!;
    await db.exerciseProfiles.put({ ...profile, weightUnit: "lb" });
    const result = await startWorkoutSession(db, fixturePlan(), { clock });
    expect(result).toMatchObject({ ok: false, error: "UNIT_MISMATCH" });
  });

  it("세트 저장이 실패하면 세션도 만들어지지 않는다 (롤백)", async () => {
    db.setRecords.hook("creating", () => {
      throw new Error("forced setRecords failure");
    });
    expect(await startWorkoutSession(db, fixturePlan(), { clock })).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(await db.workoutSessions.count()).toBe(0);
    expect(await db.sessionExercises.count()).toBe(0);
  });
});

describe("세션 조회·복원", () => {
  it("getActiveSession은 진행 중 세션을 돌려주고, 없으면 null", async () => {
    expect(expectOk(await getActiveSession(db))).toBeNull();
    const detail = await startFixture();
    expect(expectOk(await getActiveSession(db))?.session.sessionId).toBe(detail.session.sessionId);
  });

  it("DB를 닫고 다시 열어도(새로고침·앱 재시작 가정) 입력·완료 상태가 복원된다", async () => {
    const detail = await startFixture();
    const [first, second] = byExercise(detail, "bench").sets;
    expectOk(await completeSet(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock }));
    expectOk(await updateSetDraft(db, second.setRecordId, { actualWeight: kg(77.5) }));
    db.close();

    const reopened = openSameDatabase(db);
    const restored = expectOk(await getActiveSession(reopened));
    reopened.close();
    const bench = byExercise(restored!, "bench");
    expect(bench.sets[0]).toMatchObject({ completed: true, actualWeight: 67.5, actualReps: 5 });
    expect(bench.sets[1]).toMatchObject({ completed: false, actualWeight: 77.5, actualReps: null });
    expect(bench.nextSetNumber).toBe(2);
    await db.open();
  });

  it("저장된 데이터는 JSON 왕복 후에도 같다 (Date·undefined 없음)", async () => {
    const detail = await startFixture();
    expectOk(await completeSet(db, byExercise(detail, "dbCurl").sets[0].setRecordId, { actualWeight: lb(25), actualReps: 12 }, { clock }));
    const loaded = await reload(detail.session.sessionId);
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded);
    const profile = expectOk(await getExerciseProfile(db, "bench"));
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });

  it("없는 세션은 null", async () => {
    expect(expectOk(await getSessionDetail(db, "none"))).toBeNull();
  });
});

describe("updateSetDraft — 미완료 세트 입력", () => {
  it("실제값·수동 목표 중량을 저장한다 (completed는 false 유지)", async () => {
    const set = byExercise(await startFixture(), "bench").sets[0];
    const saved = expectOk(await updateSetDraft(db, set.setRecordId, { actualWeight: kg(70), actualReps: 4, manualTargetWeight: kg(70) }));
    expect(saved).toMatchObject({ completed: false, actualWeight: 70, actualReps: 4, manualTargetWeight: 70, targetWeight: 67.5, completedAt: null });
  });

  it("null로 입력을 지울 수 있다", async () => {
    const set = byExercise(await startFixture(), "bench").sets[0];
    expectOk(await updateSetDraft(db, set.setRecordId, { actualWeight: kg(70) }));
    expect(expectOk(await updateSetDraft(db, set.setRecordId, { actualWeight: null })).actualWeight).toBeNull();
  });

  it.each([
    [{ actualWeight: kg(0) }, "INVALID_ACTUAL_WEIGHT"],
    [{ actualWeight: kg(Number.NaN) }, "INVALID_ACTUAL_WEIGHT"],
    [{ actualWeight: lb(150) }, "UNIT_MISMATCH"],
    [{ actualReps: -1 }, "INVALID_ACTUAL_REPS"],
    [{ actualReps: 2.5 }, "INVALID_ACTUAL_REPS"],
    [{ manualTargetWeight: kg(-10) }, "INVALID_TARGET_WEIGHT"],
  ] as const)("%o → %s, 저장하지 않음", async (input, error) => {
    const set = byExercise(await startFixture(), "bench").sets[0];
    expect(await updateSetDraft(db, set.setRecordId, input)).toMatchObject({ ok: false, error });
    expect(await db.setRecords.get(set.setRecordId)).toEqual(set);
  });

  it("완료된 세트는 SET_LOCKED", async () => {
    const set = byExercise(await startFixture(), "bench").sets[0];
    expectOk(await completeSet(db, set.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock }));
    expect(await updateSetDraft(db, set.setRecordId, { actualReps: 3 })).toMatchObject({ ok: false, error: "SET_LOCKED" });
    expect((await db.setRecords.get(set.setRecordId))?.actualReps).toBe(5);
  });

  it("없는 세트는 SET_NOT_FOUND", async () => {
    await startFixture();
    expect(await updateSetDraft(db, "none", { actualReps: 3 })).toMatchObject({ ok: false, error: "SET_NOT_FOUND" });
  });
});

describe("completeSet — 세트 완료 트랜잭션", () => {
  it("저장 성공 시에만 completed = true, completedAt 기록", async () => {
    const [first] = byExercise(await startFixture(), "bench").sets;
    const result = expectOk(await completeSet(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock }));
    expect(result.set).toMatchObject({ completed: true, actualWeight: 67.5, actualReps: 5 });
    expect(result.set.completedAt).toMatch(/Z$/);
    expect(await db.setRecords.get(first.setRecordId)).toEqual(result.set);
  });

  it("다음 미완료 세트가 남아 있으면 휴식 타이머 신호, 마지막 세트면 신호 없음", async () => {
    const sets = byExercise(await startFixture(), "bench").sets;
    const first = expectOk(await completeSet(db, sets[0].setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock }));
    expect(first).toMatchObject({ nextSetNumber: 2, startRestTimer: true });
    expectOk(await completeSet(db, sets[1].setRecordId, { actualWeight: kg(77.5), actualReps: 3 }, { clock }));
    const last = expectOk(await completeSet(db, sets[2].setRecordId, { actualWeight: kg(85), actualReps: 4 }, { clock }));
    expect(last).toMatchObject({ nextSetNumber: null, startRestTimer: false });
  });

  it("실제 반복 0회는 완료로 저장할 수 있다 (음수·소수만 거부, CR-CK-03)", async () => {
    const [first] = byExercise(await startFixture(), "bench").sets;
    expect(expectOk(await completeSet(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 0 }, { clock })).set.actualReps).toBe(0);
  });

  it("이미 완료된 세트를 다시 완료하면 SET_ALREADY_COMPLETED, completedAt 불변", async () => {
    const [first] = byExercise(await startFixture(), "bench").sets;
    const done = expectOk(await completeSet(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock }));
    const again = await completeSet(db, first.setRecordId, { actualWeight: kg(70), actualReps: 6 }, { clock });
    expect(again).toMatchObject({ ok: false, error: "SET_ALREADY_COMPLETED" });
    expect(await db.setRecords.get(first.setRecordId)).toEqual(done.set);
  });

  it("두 탭에서 같은 세트를 동시에 완료해도 하나만 성공한다", async () => {
    const [first] = byExercise(await startFixture(), "bench").sets;
    const otherTab = openSameDatabase(db);
    const results = await Promise.all([
      completeSet(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock }),
      completeSet(otherTab, first.setRecordId, { actualWeight: kg(70), actualReps: 6 }, { clock }),
    ]);
    otherTab.close();
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "SET_ALREADY_COMPLETED" });
  });

  it.each([
    [{ actualWeight: kg(0), actualReps: 5 }, "INVALID_ACTUAL_WEIGHT"],
    [{ actualWeight: kg(Number.POSITIVE_INFINITY), actualReps: 5 }, "INVALID_ACTUAL_WEIGHT"],
    [{ actualWeight: lb(150), actualReps: 5 }, "UNIT_MISMATCH"],
    [{ actualWeight: kg(67.5), actualReps: -1 }, "INVALID_ACTUAL_REPS"],
    [{ actualWeight: kg(67.5), actualReps: 4.5 }, "INVALID_ACTUAL_REPS"],
    [{ actualWeight: kg(67.5), actualReps: Number.NaN }, "INVALID_ACTUAL_REPS"],
  ] as const)("%o → %s, 완료되지 않음", async (input, error) => {
    const [first] = byExercise(await startFixture(), "bench").sets;
    expect(await completeSet(db, first.setRecordId, input, { clock })).toMatchObject({ ok: false, error });
    expect((await db.setRecords.get(first.setRecordId))?.completed).toBe(false);
  });

  it("저장 실패 시 completed = false와 기존 입력값을 유지한다 (CR-CK-04)", async () => {
    const [first] = byExercise(await startFixture(), "bench").sets;
    expectOk(await updateSetDraft(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }));
    db.setRecords.hook("updating", () => {
      throw new Error("forced setRecords failure");
    });
    expect(await completeSet(db, first.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock })).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(await db.setRecords.get(first.setRecordId)).toMatchObject({ completed: false, completedAt: null, actualWeight: 67.5, actualReps: 5 });
  });

  it("다른 운동의 세트는 바뀌지 않는다 (CR-CK-11)", async () => {
    const detail = await startFixture();
    const before = await db.setRecords.where("sessionExerciseId").notEqual(byExercise(detail, "ohp").sessionExercise.sessionExerciseId).toArray();
    expectOk(await completeSet(db, byExercise(detail, "ohp").sets[0].setRecordId, { actualWeight: kg(27.5), actualReps: 6 }, { clock }));
    const after = await db.setRecords.where("sessionExerciseId").notEqual(byExercise(detail, "ohp").sessionExercise.sessionExerciseId).toArray();
    expect(after).toEqual(before);
  });

  it.each(["PAUSED", "COMPLETED", "ABANDONED"] as const)("%s 세션에서는 SESSION_NOT_EDITABLE", async (status) => {
    const detail = await startFixture();
    await db.workoutSessions.update(detail.session.sessionId, { status });
    const set = byExercise(detail, "bench").sets[0];
    expect(await completeSet(db, set.setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock })).toMatchObject({ ok: false, error: "SESSION_NOT_EDITABLE" });
    expect(await updateSetDraft(db, set.setRecordId, { actualReps: 5 })).toMatchObject({ ok: false, error: "SESSION_NOT_EDITABLE" });
  });
});

describe("완료 세트 잠금 우회 방지 (서비스를 거치지 않은 직접 쓰기)", () => {
  /** bench 1세트와 ohp 1세트를 완료한 세션 */
  async function sessionWithCompletedSets() {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench");
    const ohp = byExercise(detail, "ohp");
    const benchSet = expectOk(await completeSet(db, bench.sets[0].setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock })).set;
    const ohpSet = expectOk(await completeSet(db, ohp.sets[0].setRecordId, { actualWeight: kg(27.5), actualReps: 6 }, { clock })).set;
    return { detail, bench, ohp, benchSet, ohpSet };
  }
  const RESET_CHANGES = { completed: false, actualWeight: null, actualReps: null, completedAt: null } as const;

  it("update로 실제값을 바꾸면 CompletedSetLockedError", async () => {
    const { benchSet } = await sessionWithCompletedSets();
    await expect(db.setRecords.update(benchSet.setRecordId, { actualReps: 1 })).rejects.toBeInstanceOf(CompletedSetLockedError);
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
  });

  it("체크 해제만 하는 update도 거부", async () => {
    const { benchSet } = await sessionWithCompletedSets();
    await expect(db.setRecords.update(benchSet.setRecordId, { completed: false })).rejects.toBeInstanceOf(CompletedSetLockedError);
  });

  it("리셋과 똑같은 4개 필드 초기화라도 resetSessionExercise를 거치지 않으면 거부", async () => {
    const { benchSet } = await sessionWithCompletedSets();
    await expect(db.setRecords.update(benchSet.setRecordId, RESET_CHANGES)).rejects.toBeInstanceOf(CompletedSetLockedError);
    await expect(db.setRecords.put({ ...benchSet, ...RESET_CHANGES })).rejects.toBeInstanceOf(CompletedSetLockedError);
    await expect(db.setRecords.where("sessionExerciseId").equals(benchSet.sessionExerciseId).modify(RESET_CHANGES)).rejects.toThrow();
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
  });

  it("직접 연 트랜잭션 안에서도 허가 없이는 거부", async () => {
    const { benchSet } = await sessionWithCompletedSets();
    const attempt = db.transaction("rw", [db.workoutSessions, db.setRecords], async () => {
      await db.setRecords.update(benchSet.setRecordId, RESET_CHANGES);
    });
    await expect(attempt).rejects.toBeInstanceOf(CompletedSetLockedError);
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
  });

  it("허가는 지정한 운동에만 유효하다: 같은 트랜잭션에서 다른 운동 세트를 초기화하면 거부, 전체 롤백", async () => {
    const { detail, bench, benchSet, ohpSet } = await sessionWithCompletedSets();
    const attempt = db.transaction("rw", [db.setRecords], async (transaction) => {
      db.grantExerciseReset(transaction, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId });
      await db.setRecords.update(benchSet.setRecordId, RESET_CHANGES); // 허가된 운동 — 통과
      await db.setRecords.update(ohpSet.setRecordId, RESET_CHANGES); // 다른 운동 — 거부
    });
    await expect(attempt).rejects.toBeInstanceOf(CompletedSetLockedError);
    // 앞서 통과한 bench 초기화도 롤백되어야 한다
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
    expect(await db.setRecords.get(ohpSet.setRecordId)).toEqual(ohpSet);
  });

  it("허가가 있어도 목표값을 함께 바꾸면 거부", async () => {
    const { detail, bench, benchSet } = await sessionWithCompletedSets();
    const attempt = db.transaction("rw", [db.setRecords], async (transaction) => {
      db.grantExerciseReset(transaction, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId });
      await db.setRecords.update(benchSet.setRecordId, { ...RESET_CHANGES, targetWeight: 10 });
    });
    await expect(attempt).rejects.toBeInstanceOf(CompletedSetLockedError);
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
  });

  it("허가는 그 트랜잭션에서만 유효하다: 다음 트랜잭션에서는 다시 거부", async () => {
    const { detail, bench, benchSet } = await sessionWithCompletedSets();
    await db.transaction("rw", [db.setRecords], async (transaction) => {
      db.grantExerciseReset(transaction, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId });
    });
    await expect(db.setRecords.update(benchSet.setRecordId, RESET_CHANGES)).rejects.toBeInstanceOf(CompletedSetLockedError);
  });

  it("미완료 트랜잭션 쓰기도 함께 롤백된다 (잠금 위반이 섞인 트랜잭션)", async () => {
    const { bench, benchSet } = await sessionWithCompletedSets();
    const draft = bench.sets[1];
    const attempt = db.transaction("rw", [db.setRecords], async () => {
      await db.setRecords.update(draft.setRecordId, { actualReps: 3 });
      await db.setRecords.update(benchSet.setRecordId, { actualReps: 1 });
    });
    await expect(attempt).rejects.toBeInstanceOf(CompletedSetLockedError);
    expect((await db.setRecords.get(draft.setRecordId))?.actualReps).toBeNull();
  });

  it("delete·bulkDelete·where().delete()·clear() 모두 완료 세트를 지우지 못한다", async () => {
    const { benchSet } = await sessionWithCompletedSets();
    const before = await db.setRecords.count();
    await expect(db.setRecords.delete(benchSet.setRecordId)).rejects.toBeInstanceOf(CompletedSetLockedError);
    await expect(db.setRecords.bulkDelete([benchSet.setRecordId])).rejects.toThrow();
    await expect(db.setRecords.where("sessionId").equals(benchSet.sessionId).delete()).rejects.toThrow();
    await expect(db.setRecords.clear()).rejects.toThrow();
    expect(await db.setRecords.count()).toBe(before);
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
  });

  it("bulkPut으로 덮어쓰기도 거부", async () => {
    const { benchSet } = await sessionWithCompletedSets();
    await expect(db.setRecords.bulkPut([{ ...benchSet, actualReps: 1 }])).rejects.toThrow();
    expect(await db.setRecords.get(benchSet.setRecordId)).toEqual(benchSet);
  });

  it("실제값 없이 completed = true로 만드는 직접 쓰기는 InvalidSetRecordError", async () => {
    const { bench } = await sessionWithCompletedSets();
    const draft = bench.sets[1];
    await expect(db.setRecords.update(draft.setRecordId, { completed: true })).rejects.toBeInstanceOf(InvalidSetRecordError);
    await expect(db.setRecords.add({ ...draft, setRecordId: "fake", setNumber: 99, completed: true } as unknown as SetRecord)).rejects.toBeInstanceOf(InvalidSetRecordError);
    expect(await db.setRecords.get(draft.setRecordId)).toEqual(draft);
  });
});

describe("resetSessionExercise — 운동별 전체 세트 리셋", () => {
  it("대상 운동의 실제값·완료 상태만 초기화하고 목표·스냅샷·수동 목표는 보존한다", async () => {
    const detail = await startFixture();
    const ohp = byExercise(detail, "ohp");
    expectOk(await updateSetDraft(db, ohp.sets[1].setRecordId, { manualTargetWeight: kg(30) }));
    await completeAll(ohp.sets);

    const reset = expectOk(await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: ohp.sessionExercise.sessionExerciseId }, { clock }));
    expect(reset.sets.every((s) => !s.completed && s.actualWeight === null && s.actualReps === null && s.completedAt === null)).toBe(true);
    expect(reset.sets.map((s) => [s.setNumber, s.targetWeight, s.targetReps, s.isAmrap])).toEqual(ohp.sets.map((s) => [s.setNumber, s.targetWeight, s.targetReps, s.isAmrap]));
    expect(reset.sets[1].manualTargetWeight).toBe(30);
    expect(reset.nextSetNumber).toBe(1);
    const { resetCount, lastResetAt, ...snapshot } = reset.sessionExercise;
    const { resetCount: beforeCount, lastResetAt: beforeAt, ...beforeSnapshot } = ohp.sessionExercise;
    expect(snapshot).toEqual(beforeSnapshot);
    expect(resetCount).toBe(beforeCount + 1);
    expect(beforeAt).toBeNull();
    expect(lastResetAt).not.toBeNull();
  });

  it("두 번 리셋하면 resetCount 2, lastResetAt 갱신", async () => {
    const detail = await startFixture();
    const id = { sessionId: detail.session.sessionId, sessionExerciseId: byExercise(detail, "bench").sessionExercise.sessionExerciseId };
    const first = expectOk(await resetSessionExercise(db, id, { clock }));
    const second = expectOk(await resetSessionExercise(db, id, { clock }));
    expect(second.sessionExercise.resetCount).toBe(2);
    expect(second.sessionExercise.lastResetAt! > first.sessionExercise.lastResetAt!).toBe(true);
  });

  it("두 탭에서 동시에 리셋해도 이력이 유실되지 않는다 (resetCount 2)", async () => {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench");
    await completeAll(bench.sets);
    const otherTab = openSameDatabase(db);
    const id = { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId };
    const results = await Promise.all([resetSessionExercise(db, id, { clock }), resetSessionExercise(otherTab, id, { clock })]);
    otherTab.close();
    expect(results.every((r) => r.ok)).toBe(true);
    const after = byExercise(await reload(detail.session.sessionId), "bench");
    expect(after.sessionExercise.resetCount).toBe(2);
    expect(after.sets.every((s) => !s.completed)).toBe(true);
  });

  it("다른 운동·세션 상태·프로필·TM 이력은 바뀌지 않는다", async () => {
    const detail = await startFixture();
    await completeAll(byExercise(detail, "bench").sets);
    await completeAll(byExercise(detail, "ohp").sets);
    const before = await reload(detail.session.sessionId);
    const profilesBefore = await db.exerciseProfiles.toArray();
    const historyBefore = await db.tmChanges.toArray();

    expectOk(await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: byExercise(detail, "ohp").sessionExercise.sessionExerciseId }, { clock }));
    const after = await reload(detail.session.sessionId);
    expect(after.session).toEqual(before.session);
    expect(byExercise(after, "bench")).toEqual(byExercise(before, "bench"));
    expect(byExercise(after, "latPulldown")).toEqual(byExercise(before, "latPulldown"));
    expect(byExercise(after, "dbCurl")).toEqual(byExercise(before, "dbCurl"));
    expect(await db.exerciseProfiles.toArray()).toEqual(profilesBefore);
    expect(await db.tmChanges.toArray()).toEqual(historyBefore);
  });

  it("PAUSED 세션에서도 허용", async () => {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench");
    await completeAll(bench.sets);
    await db.workoutSessions.update(detail.session.sessionId, { status: "PAUSED" });
    const result = expectOk(await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId }, { clock }));
    expect(result.sets.every((s) => !s.completed)).toBe(true);
  });

  it.each(["COMPLETED", "ABANDONED"] as const)("%s 세션은 RESET_NOT_ALLOWED (U-14·U-15), 기록 불변", async (status) => {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench");
    await completeAll(bench.sets);
    await db.workoutSessions.update(detail.session.sessionId, { status });
    const before = await reload(detail.session.sessionId);
    const result = await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId }, { clock });
    expect(result).toMatchObject({ ok: false, error: "RESET_NOT_ALLOWED" });
    expect(await reload(detail.session.sessionId)).toEqual(before);
  });

  it("요청 세션에 속하지 않는 운동이면 SESSION_EXERCISE_NOT_FOUND (CR-RS-18)", async () => {
    const detail = await startFixture();
    const result = await resetSessionExercise(db, { sessionId: "other-session", sessionExerciseId: byExercise(detail, "bench").sessionExercise.sessionExerciseId }, { clock });
    expect(result).toMatchObject({ ok: false, error: "SESSION_EXERCISE_NOT_FOUND" });
  });

  it("리셋 이력 저장이 실패하면 세트도 리셋되지 않는다 (부분 리셋 없음)", async () => {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench");
    await completeAll(bench.sets);
    const before = await reload(detail.session.sessionId);
    db.sessionExercises.hook("updating", () => {
      throw new Error("forced sessionExercises failure");
    });
    const result = await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId }, { clock });
    expect(result).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(await reload(detail.session.sessionId)).toEqual(before);
  });

  it("세트 일부 초기화 중 실패해도 전부 롤백된다", async () => {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench");
    await completeAll(bench.sets);
    const before = await reload(detail.session.sessionId);
    let calls = 0;
    db.setRecords.hook("updating", () => {
      calls += 1;
      if (calls === 2) throw new Error("forced failure on second set");
      return undefined;
    });
    const result = await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: bench.sessionExercise.sessionExerciseId }, { clock });
    expect(result).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(await reload(detail.session.sessionId)).toEqual(before);
  });
});

describe("completeWorkoutSession — 세션 완료(U-21)와 T3 FST-7 증량(U-22)", () => {
  it("미완료 세트가 하나라도 있으면 SESSION_HAS_INCOMPLETE_SETS, 아무것도 바꾸지 않는다", async () => {
    const detail = await startFixture();
    await completeAll(byExercise(detail, "latPulldown").sets); // T3는 증량 조건을 만족하지만
    const before = await reload(detail.session.sessionId);
    const profilesBefore = await db.exerciseProfiles.toArray();

    const result = await completeWorkoutSession(db, detail.session.sessionId, { clock });
    expect(result).toMatchObject({ ok: false, error: "SESSION_HAS_INCOMPLETE_SETS" });
    expect(await reload(detail.session.sessionId)).toEqual(before); // IN_PROGRESS, progressionEvaluatedAt null
    expect(await db.exerciseProfiles.toArray()).toEqual(profilesBefore); // T3 증량 없음
  });

  it("마지막 한 세트만 남아도 거부한다", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    const lastSet = byExercise(detail, "dbCurl").sets[6];
    await db.transaction("rw", [db.setRecords], async (transaction) => {
      db.grantExerciseReset(transaction, { sessionId: lastSet.sessionId, sessionExerciseId: lastSet.sessionExerciseId });
      await db.setRecords.update(lastSet.setRecordId, { completed: false, actualWeight: null, actualReps: null, completedAt: null });
    });
    expect(await completeWorkoutSession(db, detail.session.sessionId, { clock })).toMatchObject({ ok: false, error: "SESSION_HAS_INCOMPLETE_SETS" });
  });

  it("모든 세트 완료 + T3 12회 이상이면 COMPLETED, T3 작업 중량 한 단계 증가", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));

    expect(result.session).toMatchObject({ status: "COMPLETED" });
    expect(result.session.completedAt).not.toBeNull();
    expect(result.t3Progressions.find((p) => p.exerciseId === "latPulldown")).toMatchObject({ applied: true, skippedReason: null, decision: { decision: "INCREASE", nextWorkingWeight: { value: 52.5, unit: "kg" } } });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))).toMatchObject({ t3WorkingWeight: 52.5, t3WorkingWeightRevision: 1 });
    // 덤벨 lb: 한 손 25 → 30 (lb 증가 단위 5, 단위 변환 없음)
    expect(expectOk(await getExerciseProfile(db, "dbCurl"))).toMatchObject({ weightUnit: "lb", t3WorkingWeight: 30 });
  });

  it("모든 세트를 완료했지만 12회 미만이 있으면 유지, 감량하지 않는다", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock, (s) => (s.tier === "T3" && s.setNumber === 7 ? 10 : s.targetReps));
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.t3Progressions.find((p) => p.exerciseId === "latPulldown")).toMatchObject({ applied: false, decision: { decision: "HOLD" } });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))).toMatchObject({ t3WorkingWeight: 50, t3WorkingWeightRevision: 0 });
  });

  it("T3 판정 시각을 기록하고, T1·T2는 규칙 미확정으로 보류 목록에만 담는다 (TM 불변)", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.pendingProgressions.map((p) => `${p.tier}:${p.exerciseId}`)).toEqual(["T1:bench", "T2:ohp"]);
    const after = await reload(detail.session.sessionId);
    expect(byExercise(after, "latPulldown").sessionExercise.progressionEvaluatedAt).not.toBeNull();
    expect(byExercise(after, "bench").sessionExercise.progressionEvaluatedAt).toBeNull();
    expect(expectOk(await getExerciseProfile(db, "bench"))?.currentTM).toBe(90);
    expect(expectOk(await listTMChanges(db, "bench"))).toHaveLength(1);
  });

  it("U-22: 세션 도중 사용자가 바꾼 T3 중량을 우선한다 — 증량으로 덮어쓰지 않고, 스냅샷·완료 세트도 그대로", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    const before = await reload(detail.session.sessionId);
    expectOk(await updateT3WorkingWeight(db, "latPulldown", kg(45), { clock }));

    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.t3Progressions.find((p) => p.exerciseId === "latPulldown")).toMatchObject({ applied: false, skippedReason: "PROFILE_CHANGED", decision: { decision: "INCREASE" } });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))?.t3WorkingWeight).toBe(45);

    const after = await reload(detail.session.sessionId);
    const lat = byExercise(after, "latPulldown");
    expect(lat.sessionExercise.workingWeightAtSession).toBe(50);
    expect(lat.sets).toEqual(byExercise(before, "latPulldown").sets);
    // 다른 T3(덤벨 컬)는 사용자가 건드리지 않았으므로 정상 증량
    expect(expectOk(await getExerciseProfile(db, "dbCurl"))?.t3WorkingWeight).toBe(30);
  });

  it("U-22: 세션 도중 값을 바꿨다가 시작 값으로 되돌려도 사용자 결정으로 보고 덮어쓰지 않는다", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    expectOk(await updateT3WorkingWeight(db, "latPulldown", kg(55), { clock }));
    expectOk(await updateT3WorkingWeight(db, "latPulldown", kg(50), { clock }));
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.t3Progressions.find((p) => p.exerciseId === "latPulldown")).toMatchObject({ applied: false, skippedReason: "PROFILE_CHANGED" });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))?.t3WorkingWeight).toBe(50);
  });

  it("다음 세션은 증량된 값·변경 번호를 새 스냅샷으로 쓴다", async () => {
    const first = await startFixture();
    await completeEverySet(db, first, clock);
    expectOk(await completeWorkoutSession(db, first.session.sessionId, { clock }));
    const second = await startFixture();
    expect(byExercise(second, "latPulldown").sessionExercise).toMatchObject({ workingWeightAtSession: 52.5, workingWeightRevisionAtSession: 1 });
    expect(byExercise(second, "latPulldown").sets.every((s) => s.targetWeight === 52.5)).toBe(true);
    // 첫 세션 기록은 그대로
    const firstAfter = await reload(first.session.sessionId);
    expect(byExercise(firstAfter, "latPulldown").sets.every((s) => s.targetWeight === 50 && s.actualWeight === 50)).toBe(true);
  });

  it("두 번 완료하면 SESSION_NOT_IN_PROGRESS, 증량은 한 번만 반영", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(await completeWorkoutSession(db, detail.session.sessionId, { clock })).toMatchObject({ ok: false, error: "SESSION_NOT_IN_PROGRESS" });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))?.t3WorkingWeight).toBe(52.5);
  });

  it("두 탭에서 동시에 완료해도 증량은 한 번만 반영", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    const otherTab = openSameDatabase(db);
    const results = await Promise.all([completeWorkoutSession(db, detail.session.sessionId, { clock }), completeWorkoutSession(otherTab, detail.session.sessionId, { clock })]);
    otherTab.close();
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "SESSION_NOT_IN_PROGRESS" });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))).toMatchObject({ t3WorkingWeight: 52.5, t3WorkingWeightRevision: 1 });
  });

  it("리셋 → 재입력 → 완료 시 증량은 한 번만 (CR-RS-17)", async () => {
    const detail = await startFixture();
    const lat = byExercise(detail, "latPulldown");
    await completeAll(lat.sets);
    expectOk(await resetSessionExercise(db, { sessionId: detail.session.sessionId, sessionExerciseId: lat.sessionExercise.sessionExerciseId }, { clock }));
    await completeEverySet(db, await reload(detail.session.sessionId), clock);
    expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))?.t3WorkingWeight).toBe(52.5);
  });

  it("프로필 저장 실패 시 세션 상태도 롤백 (IN_PROGRESS 유지)", async () => {
    const detail = await startFixture();
    await completeEverySet(db, detail, clock);
    db.exerciseProfiles.hook("updating", () => {
      throw new Error("forced profile failure");
    });
    expect(await completeWorkoutSession(db, detail.session.sessionId, { clock })).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    const after = await reload(detail.session.sessionId);
    expect(after.session.status).toBe("IN_PROGRESS");
    expect(byExercise(after, "latPulldown").sessionExercise.progressionEvaluatedAt).toBeNull();
  });

  it("없는 세션은 SESSION_NOT_FOUND", async () => {
    expect(await completeWorkoutSession(db, "none", { clock })).toMatchObject({ ok: false, error: "SESSION_NOT_FOUND" });
  });
});

describe("운동 표시 순서 (displayOrder)", () => {
  it("계획 순서대로 0부터 저장하고, 조회는 ID가 아닌 displayOrder로 정렬한다", async () => {
    const plan = fixturePlan();
    // ID 문자열 순서(T1 < T2 < T3, 알파벳)와 다른 순서로 계획
    const reordered = { ...plan, exercises: [plan.exercises[3], plan.exercises[1], plan.exercises[0], plan.exercises[2]] };
    const detail = expectOk(await startWorkoutSession(db, reordered, { clock }));
    expect(detail.exercises.map((e) => [e.sessionExercise.displayOrder, e.sessionExercise.exerciseId])).toEqual([
      [0, "dbCurl"],
      [1, "ohp"],
      [2, "bench"],
      [3, "latPulldown"],
    ]);
    db.close();
    const reopened = openSameDatabase(db);
    const restored = expectOk(await getSessionDetail(reopened, detail.session.sessionId));
    reopened.close();
    await db.open();
    expect(restored!.exercises.map((e) => e.sessionExercise.exerciseId)).toEqual(["dbCurl", "ohp", "bench", "latPulldown"]);
  });

  it("같은 운동을 다른 티어로 같은 세션에 넣을 수 있고, 각각 공통 currentTM을 스냅샷한다 (H-13)", async () => {
    const detail = expectOk(
      await startWorkoutSession(
        db,
        {
          ...fixturePlan(),
          exercises: [
            { exerciseId: "ohp", tier: "T1", templateId: "fixture-t1", templateVersion: 1, restSeconds: 180, sets: FIXTURE_T1_SETS },
            { exerciseId: "ohp", tier: "T2", templateId: "fixture-t2", templateVersion: 1, restSeconds: 120, sets: FIXTURE_T2_SETS },
          ],
        },
        { clock },
      ),
    );
    expect(detail.exercises.map((e) => [e.sessionExercise.displayOrder, e.sessionExercise.tier, e.sessionExercise.tmAtSession])).toEqual([
      [0, "T1", 54],
      [1, "T2", 54],
    ]);
    expect(new Set(detail.exercises.map((e) => e.sessionExercise.sessionExerciseId)).size).toBe(2);
  });

  it("같은 세션에서 같은 표시 순서를 직접 넣으면 유일 인덱스가 거부한다", async () => {
    const detail = await startFixture();
    const bench = byExercise(detail, "bench").sessionExercise;
    await expect(
      db.sessionExercises.add({ ...bench, sessionExerciseId: "dup", exerciseId: "other", displayOrder: bench.displayOrder }),
    ).rejects.toMatchObject({ name: "ConstraintError" });
  });
});

describe("IndexedDB 오류 처리", () => {
  it("닫힌 DB에 쓰면 예외 대신 STORAGE_ERROR 결과를 돌려준다", async () => {
    const detail = await startFixture();
    db.close({ disableAutoOpen: true });
    const result = await completeSet(db, byExercise(detail, "bench").sets[0].setRecordId, { actualWeight: kg(67.5), actualReps: 5 }, { clock });
    expect(result).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(result.ok ? "" : result.message).toMatch(/DatabaseClosed/);
    await db.open();
  });
});
