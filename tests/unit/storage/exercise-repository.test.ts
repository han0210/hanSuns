import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NsunsDatabase } from "@/storage/db";
import {
  applyTMChange,
  getExercise,
  getExerciseProfile,
  initializeExerciseProfile,
  listTMChanges,
  saveExercise,
  updateT3WorkingWeight,
} from "@/storage/repositories/exerciseRepository";
import { completeWorkoutSession, startWorkoutSession } from "@/storage/repositories/workoutRepository";
import { kg, lb } from "@/domain/types/weight";
import type { Clock } from "@/storage/ids";
import { completeEverySet, createTestClock, createTestDatabase, destroyDatabase, expectOk, openSameDatabase, fixturePlan, seedExercises, seedProfiles } from "./helpers";

let db: NsunsDatabase;
let clock: Clock;

beforeEach(() => {
  db = createTestDatabase();
  clock = createTestClock();
});
afterEach(async () => {
  await destroyDatabase(db);
});

describe("saveExercise / getExercise", () => {
  it("운동을 저장하고 같은 값으로 다시 읽는다", async () => {
    const saved = expectOk(await saveExercise(db, { exerciseId: "bench", name: "벤치 프레스", equipment: "BARBELL", weightUnit: "kg", increment: 2.5 }, { clock }));
    expect(saved.updatedAt).toBe("2026-10-21T09:00:00.000Z");
    expect(expectOk(await getExercise(db, "bench"))).toEqual(saved);
  });

  it("없는 운동은 null", async () => {
    expect(expectOk(await getExercise(db, "none"))).toBeNull();
  });

  it("증가 단위가 0 이하·NaN이면 INVALID_INCREMENT", async () => {
    for (const increment of [0, -2.5, Number.NaN]) {
      const result = await saveExercise(db, { exerciseId: "x", name: "x", equipment: "BARBELL", weightUnit: "kg", increment }, { clock });
      expect(result).toMatchObject({ ok: false, error: "INVALID_INCREMENT" });
    }
    expect(await db.exercises.count()).toBe(0);
  });

  it("이름·ID가 비어 있으면 INVALID_EXERCISE", async () => {
    const result = await saveExercise(db, { exerciseId: " ", name: "", equipment: "BARBELL", weightUnit: "kg", increment: 2.5 }, { clock });
    expect(result).toMatchObject({ ok: false, error: "INVALID_EXERCISE" });
  });

  it("프로필이 있는 운동의 단위는 바꿀 수 없다 (U-20 미확정, 자동 변환 없음)", async () => {
    await seedProfiles(db, clock);
    const result = await saveExercise(db, { exerciseId: "bench", name: "벤치 프레스", equipment: "BARBELL", weightUnit: "lb", increment: 5 }, { clock });
    expect(result).toMatchObject({ ok: false, error: "UNIT_CHANGE_NOT_ALLOWED" });
    expect(expectOk(await getExercise(db, "bench"))?.weightUnit).toBe("kg");
  });
});

describe("initializeExerciseProfile", () => {
  beforeEach(async () => {
    await seedExercises(db, clock);
  });

  it("직접 입력 1RM → initialTM·currentTM = 1RM × 0.9 (반올림 없음), INITIAL 이력 1건을 같은 트랜잭션에 저장", async () => {
    const profile = expectOk(
      await initializeExerciseProfile(db, { exerciseId: "ohp", oneRepMax: kg(62.5), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, { clock }),
    );
    expect(profile).toMatchObject({ exerciseId: "ohp", weightUnit: "kg", oneRepMax: 62.5, initialTM: 56.25, currentTM: 56.25, t3WorkingWeight: null, oneRepMaxSource: "DIRECT" });
    expect(expectOk(await getExerciseProfile(db, "ohp"))).toEqual(profile);

    const history = expectOk(await listTMChanges(db, "ohp"));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ reason: "INITIAL", fromTM: null, toTM: 56.25, weightUnit: "kg", sourceSessionId: null, sourceTier: null });
  });

  it("추정값 확정은 출처·규칙 ID를 보존한다 (DIRECT로 바꾸지 않음)", async () => {
    const profile = expectOk(
      await initializeExerciseProfile(
        db,
        { exerciseId: "bench", oneRepMax: kg(85), oneRepMaxSource: "ESTIMATE_ACCEPTED", estimateRuleId: "setup-incline-bench-v1", t3WorkingWeight: null },
        { clock },
      ),
    );
    expect(profile.oneRepMaxSource).toBe("ESTIMATE_ACCEPTED");
    expect(profile.estimateRuleId).toBe("setup-incline-bench-v1");
  });

  it("T3 전용 운동은 1RM·TM 없이 작업 중량만 저장하고 TM 이력을 만들지 않는다", async () => {
    const profile = expectOk(
      await initializeExerciseProfile(db, { exerciseId: "latPulldown", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: kg(50) }, { clock }),
    );
    expect(profile).toMatchObject({ oneRepMax: null, initialTM: null, currentTM: null, t3WorkingWeight: 50, t3WorkingWeightRevision: 0 });
    expect(expectOk(await listTMChanges(db, "latPulldown"))).toHaveLength(0);
  });

  it("덤벨 lb 작업 중량은 한 손 기준 값 그대로 저장한다 (U-19, 합산·변환 없음)", async () => {
    const profile = expectOk(
      await initializeExerciseProfile(db, { exerciseId: "dbCurl", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: lb(25) }, { clock }),
    );
    expect(profile).toMatchObject({ weightUnit: "lb", t3WorkingWeight: 25 });
  });

  it.each([
    ["운동 없음", { exerciseId: "none", oneRepMax: kg(100), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, "EXERCISE_NOT_FOUND"],
    ["단위 불일치", { exerciseId: "bench", oneRepMax: lb(225), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, "UNIT_MISMATCH"],
    ["1RM 0", { exerciseId: "bench", oneRepMax: kg(0), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, "INVALID_1RM"],
    ["DIRECT인데 규칙 ID", { exerciseId: "bench", oneRepMax: kg(100), oneRepMaxSource: "DIRECT", estimateRuleId: "rule", t3WorkingWeight: null }, "INVALID_SOURCE"],
    ["추정인데 규칙 ID 없음", { exerciseId: "bench", oneRepMax: kg(100), oneRepMaxSource: "USER_EDITED", estimateRuleId: null, t3WorkingWeight: null }, "INVALID_SOURCE"],
    ["1RM 있는데 출처 없음", { exerciseId: "bench", oneRepMax: kg(100), oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: null }, "INVALID_SOURCE"],
    ["작업 중량 음수", { exerciseId: "latPulldown", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: kg(-5) }, "INVALID_WORKING_WEIGHT"],
    ["값 없음", { exerciseId: "latPulldown", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: null }, "EMPTY_PROFILE"],
  ] as const)("%s → %s, 아무것도 저장하지 않음", async (_label, input, error) => {
    const result = await initializeExerciseProfile(db, input, { clock });
    expect(result).toMatchObject({ ok: false, error });
    expect(await db.exerciseProfiles.count()).toBe(0);
    expect(await db.tmChanges.count()).toBe(0);
  });

  it("이미 프로필이 있으면 PROFILE_ALREADY_EXISTS (기존 값 유지)", async () => {
    const input = { exerciseId: "bench", oneRepMax: kg(100), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null } as const;
    expectOk(await initializeExerciseProfile(db, input, { clock }));
    const result = await initializeExerciseProfile(db, { ...input, oneRepMax: kg(120) }, { clock });
    expect(result).toMatchObject({ ok: false, error: "PROFILE_ALREADY_EXISTS" });
    expect(expectOk(await getExerciseProfile(db, "bench"))?.currentTM).toBe(90);
    expect(expectOk(await listTMChanges(db, "bench"))).toHaveLength(1);
  });

  it("TM 이력 저장이 실패하면 프로필도 저장되지 않는다 (롤백)", async () => {
    db.tmChanges.hook("creating", () => {
      throw new Error("forced tmChanges failure");
    });
    const result = await initializeExerciseProfile(db, { exerciseId: "bench", oneRepMax: kg(100), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }, { clock });
    expect(result).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(expectOk(await getExerciseProfile(db, "bench"))).toBeNull();
  });
});

describe("updateT3WorkingWeight", () => {
  beforeEach(async () => {
    await seedProfiles(db, clock);
  });

  it("작업 중량만 바꾸고 다른 값은 유지하며, 변경 번호를 1 올린다", async () => {
    const updated = expectOk(await updateT3WorkingWeight(db, "latPulldown", kg(52.5), { clock }));
    expect(updated.t3WorkingWeight).toBe(52.5);
    expect(updated.currentTM).toBeNull();
    expect(updated.t3WorkingWeightRevision).toBe(1);
  });

  it("같은 값을 다시 저장해도 변경 번호는 오른다 (사용자의 명시적 결정, U-22)", async () => {
    const updated = expectOk(await updateT3WorkingWeight(db, "latPulldown", kg(50), { clock }));
    expect(updated).toMatchObject({ t3WorkingWeight: 50, t3WorkingWeightRevision: 1 });
  });

  it("단위 불일치·잘못된 값·프로필 없음은 거부", async () => {
    expect(await updateT3WorkingWeight(db, "latPulldown", lb(100), { clock })).toMatchObject({ ok: false, error: "UNIT_MISMATCH" });
    expect(await updateT3WorkingWeight(db, "latPulldown", kg(0), { clock })).toMatchObject({ ok: false, error: "INVALID_WORKING_WEIGHT" });
    expect(await updateT3WorkingWeight(db, "none", kg(10), { clock })).toMatchObject({ ok: false, error: "PROFILE_NOT_FOUND" });
    expect(expectOk(await getExerciseProfile(db, "latPulldown"))?.t3WorkingWeight).toBe(50);
  });
});

describe("applyTMChange (증량 중복 방지)", () => {
  /** 완료된 세션을 하나 만든다. T1·T2 증량 규칙은 미확정이므로 세션 완료는 T1·T2 TM을 바꾸지 않는다 */
  async function completedSessionId(): Promise<string> {
    await seedProfiles(db, clock);
    const detail = expectOk(await startWorkoutSession(db, fixturePlan(), { clock }));
    await completeEverySet(db, detail, clock);
    expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    return detail.session.sessionId;
  }

  // 아래 toTM 값(92.5)은 저장 동작 검증용 테스트 값이다. 실제 AMRAP 증량 규칙은 U-04 미확정.
  it("TM과 이력을 한 트랜잭션에서 함께 저장한다", async () => {
    const sessionId = await completedSessionId();
    const { profile, change } = expectOk(
      await applyTMChange(db, { exerciseId: "bench", sourceSessionId: sessionId, sourceTier: "T1", toTM: kg(92.5), ruleId: "fixture-rule", ruleVersion: 1 }, { clock }),
    );
    expect(profile.currentTM).toBe(92.5);
    expect(profile.initialTM).toBe(90);
    expect(change).toMatchObject({ reason: "AMRAP_PROGRESSION", fromTM: 90, toTM: 92.5, sourceSessionId: sessionId, sourceTier: "T1" });
    expect(expectOk(await listTMChanges(db, "bench")).map((c) => c.reason)).toEqual(["INITIAL", "AMRAP_PROGRESSION"]);
  });

  it("같은 (세션, 운동, 티어)로 두 번 적용하면 DUPLICATE_PROGRESSION, TM은 한 번만 바뀐다", async () => {
    const sessionId = await completedSessionId();
    const input = { exerciseId: "bench", sourceSessionId: sessionId, sourceTier: "T1", toTM: kg(92.5), ruleId: "fixture-rule", ruleVersion: 1 } as const;
    expectOk(await applyTMChange(db, input, { clock }));
    const second = await applyTMChange(db, { ...input, toTM: kg(95) }, { clock });
    expect(second).toMatchObject({ ok: false, error: "DUPLICATE_PROGRESSION" });
    expect(expectOk(await getExerciseProfile(db, "bench"))?.currentTM).toBe(92.5);
    expect(expectOk(await listTMChanges(db, "bench"))).toHaveLength(2);
  });

  it("두 탭에서 동시에 같은 증량을 적용해도 하나만 성공한다", async () => {
    const sessionId = await completedSessionId();
    const otherTab = openSameDatabase(db);
    const input = { exerciseId: "bench", sourceSessionId: sessionId, sourceTier: "T1", toTM: kg(92.5), ruleId: "fixture-rule", ruleVersion: 1 } as const;
    const results = await Promise.all([applyTMChange(db, input, { clock }), applyTMChange(otherTab, input, { clock })]);
    otherTab.close();
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "DUPLICATE_PROGRESSION" });
    expect(expectOk(await getExerciseProfile(db, "bench"))?.currentTM).toBe(92.5);
  });

  it("이력 저장이 실패하면 currentTM도 바뀌지 않는다 (롤백)", async () => {
    const sessionId = await completedSessionId();
    db.tmChanges.hook("creating", () => {
      throw new Error("forced tmChanges failure");
    });
    const result = await applyTMChange(db, { exerciseId: "bench", sourceSessionId: sessionId, sourceTier: "T1", toTM: kg(92.5), ruleId: "fixture-rule", ruleVersion: 1 }, { clock });
    expect(result).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(expectOk(await getExerciseProfile(db, "bench"))?.currentTM).toBe(90);
  });

  it("완료되지 않은 세션·세션에 없는 운동/티어·단위 불일치·잘못된 TM은 거부", async () => {
    await seedProfiles(db, clock);
    const active = expectOk(await startWorkoutSession(db, fixturePlan(), { clock }));
    const base = { exerciseId: "bench", sourceSessionId: active.session.sessionId, sourceTier: "T1", toTM: kg(92.5), ruleId: "fixture-rule", ruleVersion: 1 } as const;
    expect(await applyTMChange(db, base, { clock })).toMatchObject({ ok: false, error: "SESSION_NOT_COMPLETED" });
    expect(await applyTMChange(db, { ...base, sourceSessionId: "none" }, { clock })).toMatchObject({ ok: false, error: "SESSION_NOT_FOUND" });

    await completeEverySet(db, active, clock);
    expectOk(await completeWorkoutSession(db, active.session.sessionId, { clock }));
    expect(await applyTMChange(db, { ...base, sourceTier: "T2" }, { clock })).toMatchObject({ ok: false, error: "SESSION_EXERCISE_NOT_FOUND" });
    expect(await applyTMChange(db, { ...base, toTM: lb(200) }, { clock })).toMatchObject({ ok: false, error: "UNIT_MISMATCH" });
    expect(await applyTMChange(db, { ...base, toTM: kg(Number.NaN) }, { clock })).toMatchObject({ ok: false, error: "INVALID_TM" });
    expect(expectOk(await listTMChanges(db, "bench"))).toHaveLength(1);
  });
});
