import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialSetupState, setupReducer, type SetupAction, type SetupState } from "@/features/setup-prototype/setupModel";
import {
  buildInitialSetupInput,
  buildSumoUpgradeInput,
  confirmSetup,
  restoreSetupState,
  SETUP_EXERCISE_IDS,
  sumoEstimateFromSaved,
} from "@/features/setup-prototype/setupPersistence";
import { addSetupExercises, getSavedSetup, saveInitialSetup } from "@/storage/repositories/setupRepository";
import { completeSet, startWorkoutSession } from "@/storage/repositories/workoutRepository";
import { kg } from "@/domain/types/weight";
import type { NsunsDatabase } from "@/storage/db";
import { createTestDatabase, destroyDatabase, expectOk, openSameDatabase } from "../storage/helpers";

/** 4단계 입력을 마친(확정 전) 상태: 벤치 100 / 데드 140 / 스쿼트 120 / OHP 62.5, 로우만 사용자 수정 90 */
function filledState(): SetupState {
  const actions: SetupAction[] = [
    { type: "SET_DIRECT", id: "bench_press", text: "100" },
    { type: "SET_DIRECT", id: "deadlift", text: "140" },
    { type: "SET_DIRECT", id: "squat", text: "120" },
    { type: "SET_DIRECT", id: "ohp", text: "62.5" },
    { type: "EDIT_ESTIMATED", id: "barbell_row", text: "90" },
    { type: "SET_T3", id: "cable_fly", text: "15" },
    { type: "SET_T3", id: "leg_curl", text: "40" },
    { type: "SET_T3", id: "leg_extension", text: "45" },
    { type: "SET_T3", id: "dumbbell_lateral_raise", text: "8" },
    { type: "SET_T3", id: "lat_pulldown", text: "50" },
  ];
  return actions.reduce(setupReducer, createInitialSetupState());
}
const complete = (state: SetupState) => setupReducer(state, { type: "COMPLETE" });

describe("buildInitialSetupInput — 화면 상태 → 저장 입력", () => {
  it("확정 전 상태는 저장하지 않는다", () => {
    expect(buildInitialSetupInput(filledState())).toBeNull();
  });

  it("4대 운동은 DIRECT, 추정 운동은 확정/수정 출처와 규칙 ID, T3는 작업 중량만", () => {
    const input = buildInitialSetupInput(complete(filledState()));
    expect(input).not.toBeNull();
    const profile = (id: string) => input!.profiles.find((p) => p.exerciseId === id);
    expect(profile("bench_press")).toMatchObject({ oneRepMax: { value: 100, unit: "kg" }, oneRepMaxSource: "DIRECT", estimateRuleId: null });
    // 승인 비율: 프론트 = 스쿼트 × 0.80, 인클라인 = 벤치 × 0.85, 슈러그 = 로우(사용자 수정 90) × 0.50
    expect(profile("front_squat")).toMatchObject({ oneRepMax: { value: 96 }, oneRepMaxSource: "ESTIMATE_ACCEPTED", estimateRuleId: "setup-front-squat-v1" });
    expect(profile("incline_bench_press")).toMatchObject({ oneRepMax: { value: 85 }, oneRepMaxSource: "ESTIMATE_ACCEPTED" });
    expect(profile("barbell_row")).toMatchObject({ oneRepMax: { value: 90 }, oneRepMaxSource: "USER_EDITED", estimateRuleId: "setup-barbell-row-v1" });
    expect(profile("barbell_shrug")).toMatchObject({ oneRepMax: { value: 45 }, oneRepMaxSource: "ESTIMATE_ACCEPTED" });
    // H-19: 스모 = 컨벤셔널 데드리프트 140 × 0.50, 측정값이 아닌 추정 출처
    expect(profile("sumo_deadlift")).toMatchObject({ oneRepMax: { value: 70 }, oneRepMaxSource: "ESTIMATE_ACCEPTED", estimateRuleId: "setup-sumo-deadlift-v1" });
    expect(profile("dumbbell_lateral_raise")).toMatchObject({ oneRepMax: null, t3WorkingWeight: { value: 8, unit: "kg" } });
    expect(input!.exercises.map((e) => e.exerciseId)).toEqual([...SETUP_EXERCISE_IDS]);
    expect(input!.exercises.every((e) => e.weightUnit === "kg" && e.increment > 0)).toBe(true);
    expect(input!.exercises.find((e) => e.exerciseId === "dumbbell_lateral_raise")?.equipment).toBe("DUMBBELL");
  });
});

describe("confirmSetup + 저장 계층", () => {
  let db: NsunsDatabase;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(async () => {
    await destroyDatabase(db);
  });

  it("저장 성공 시에만 완료 상태를 돌려주고, 초기 TM = 1RM × 0.9로 저장된다", async () => {
    const result = await confirmSetup(complete(filledState()), (input) => saveInitialSetup(db, input));
    expect(result.ok).toBe(true);
    const saved = expectOk(await getSavedSetup(db));
    expect(saved.profiles).toHaveLength(14);
    expect(saved.profiles.find((p) => p.exerciseId === "ohp")).toMatchObject({ oneRepMax: 62.5, initialTM: 56.25, currentTM: 56.25 });
    expect(saved.profiles.find((p) => p.exerciseId === "sumo_deadlift")).toMatchObject({ oneRepMax: 70, initialTM: 63, currentTM: 63, oneRepMaxSource: "ESTIMATE_ACCEPTED" });
  });

  it("저장 실패 시 ok:false와 재시도 안내 (화면은 완료로 넘어가지 않는다)", async () => {
    const failing = await confirmSetup(complete(filledState()), async () => ({ ok: false, error: "STORAGE_ERROR", message: "QuotaExceededError" }));
    expect(failing).toMatchObject({ ok: false, alreadySaved: false });
    const throwing = await confirmSetup(complete(filledState()), async () => {
      throw new Error("boom");
    });
    expect(throwing.ok).toBe(false);
    expect(expectOk(await getSavedSetup(db)).profiles).toHaveLength(0);
  });

  it("이미 설정이 있으면 덮어쓰지 않고 alreadySaved로 알린다", async () => {
    expect((await confirmSetup(complete(filledState()), (input) => saveInitialSetup(db, input))).ok).toBe(true);
    const changed = setupReducer(filledState(), { type: "SET_DIRECT", id: "bench_press", text: "150" });
    const again = await confirmSetup(complete(changed), (input) => saveInitialSetup(db, input));
    expect(again).toMatchObject({ ok: false, alreadySaved: true });
    expect(expectOk(await getSavedSetup(db)).profiles.find((p) => p.exerciseId === "bench_press")?.oneRepMax).toBe(100);
  });

  it("새로고침(DB 재오픈) 후 저장된 설정을 같은 화면 상태로 복원한다", async () => {
    const confirmed = await confirmSetup(complete(filledState()), (input) => saveInitialSetup(db, input));
    db.close();
    const reopened = openSameDatabase(db);
    const restored = restoreSetupState(expectOk(await getSavedSetup(reopened)));
    reopened.close();
    await db.open();
    expect(restored.kind).toBe("complete");
    if (restored.kind !== "complete" || !confirmed.ok) throw new Error("unexpected");
    expect(restored.state.direct).toEqual(confirmed.state.direct);
    expect(restored.state.t3).toEqual(confirmed.state.t3);
    expect(restored.state.estimated.barbell_row).toEqual({ source: "EDITED", text: "90" });
    expect(restored.state.estimated.front_squat).toEqual({ source: "ACCEPTED", text: "96" });
    expect(restored.state).toMatchObject({ completed: true, step: 4 });
  });

  it("저장된 설정이 없으면 none, 일부만 있으면 partial", () => {
    expect(restoreSetupState({ exercises: [], profiles: [] })).toEqual({ kind: "none" });
    const partial = restoreSetupState({
      exercises: [],
      profiles: [{ exerciseId: "bench_press", weightUnit: "kg", oneRepMax: 100, oneRepMaxSource: "DIRECT", estimateRuleId: null, initialTM: 90, currentTM: 90, t3WorkingWeight: null, t3WorkingWeightRevision: 0, updatedAt: "2026-10-21T00:00:00.000Z" }],
    });
    expect(partial.kind).toBe("partial");
  });
});

describe("기존 저장 데이터 보존 — 스모 추가 이전(13개 운동) 설정", () => {
  let db: NsunsDatabase;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(async () => {
    await destroyDatabase(db);
  });

  /** 스모가 없던 STEP 10 시점의 설정을 저장한다 */
  async function saveLegacySetup() {
    const input = buildInitialSetupInput(complete(filledState()))!;
    const legacy = {
      exercises: input.exercises.filter((e) => e.exerciseId !== "sumo_deadlift"),
      profiles: input.profiles.filter((p) => p.exerciseId !== "sumo_deadlift"),
    };
    expectOk(await saveInitialSetup(db, legacy));
  }

  it("기존 설정은 needsUpgrade로 복원되고 저장된 값은 그대로 보인다", async () => {
    await saveLegacySetup();
    const restored = restoreSetupState(expectOk(await getSavedSetup(db)));
    expect(restored.kind).toBe("needsUpgrade");
    if (restored.kind !== "needsUpgrade") throw new Error("unexpected");
    expect(restored.missing).toEqual(["sumo_deadlift"]);
    expect(restored.state.direct.deadlift).toBe("140");
    expect(restored.state.estimated.barbell_row).toEqual({ source: "EDITED", text: "90" });
    expect(restored.state.estimated.sumo_deadlift).toEqual({ source: "ESTIMATE" });
  });

  it("스모만 추가 저장하고 기존 프로필·TM 이력·T3 기록은 바뀌지 않는다", async () => {
    await saveLegacySetup();
    const detail = expectOk(await startWorkoutSession(db, { scheduledDay: "MONDAY", workoutDate: "2026-10-19", exercises: [{ exerciseId: "cable_fly", tier: "T3", templateId: null, templateVersion: null, restSeconds: 30 }] }));
    expectOk(await completeSet(db, `${detail.exercises[0].sessionExercise.sessionExerciseId}#1`, { actualWeight: kg(15), actualReps: 12 }));
    const before = { profiles: await db.exerciseProfiles.toArray(), tm: await db.tmChanges.toArray(), sets: await db.setRecords.toArray(), sessions: await db.workoutSessions.toArray() };

    const input = buildSumoUpgradeInput({ source: "EDITED", text: "75" });
    expect(input).not.toBeNull();
    expectOk(await addSetupExercises(db, input!));

    expect((await db.tmChanges.toArray()).filter((c) => c.exerciseId !== "sumo_deadlift")).toEqual(before.tm);
    expect((await db.exerciseProfiles.toArray()).filter((p) => p.exerciseId !== "sumo_deadlift")).toEqual(before.profiles);
    expect(await db.setRecords.toArray()).toEqual(before.sets);
    expect(await db.workoutSessions.toArray()).toEqual(before.sessions);
    const sumo = await db.exerciseProfiles.get("sumo_deadlift");
    expect(sumo).toMatchObject({ oneRepMax: 75, initialTM: 67.5, oneRepMaxSource: "USER_EDITED", estimateRuleId: "setup-sumo-deadlift-v1" });
    expect(restoreSetupState(expectOk(await getSavedSetup(db))).kind).toBe("complete");
  });

  it("추정값 그대로 확정하면 저장된 데드리프트 1RM × 0.50", async () => {
    await saveLegacySetup();
    const saved = expectOk(await getSavedSetup(db));
    const estimate = sumoEstimateFromSaved(saved);
    expect(estimate).toBe(70);
    expectOk(await addSetupExercises(db, buildSumoUpgradeInput({ source: "ACCEPTED", text: String(estimate) })!));
    expect(await db.exerciseProfiles.get("sumo_deadlift")).toMatchObject({ oneRepMax: 70, oneRepMaxSource: "ESTIMATE_ACCEPTED" });
  });

  it("잘못된 값·자동 추정 상태는 저장하지 않고, 이미 있는 스모는 덮어쓰지 않는다", async () => {
    await saveLegacySetup();
    expect(buildSumoUpgradeInput({ source: "EDITED", text: "0" })).toBeNull();
    expect(buildSumoUpgradeInput({ source: "ESTIMATE" })).toBeNull();
    expectOk(await addSetupExercises(db, buildSumoUpgradeInput({ source: "EDITED", text: "75" })!));
    expect(await addSetupExercises(db, buildSumoUpgradeInput({ source: "EDITED", text: "99" })!)).toMatchObject({ ok: false, error: "PROFILE_ALREADY_EXISTS" });
    expect((await db.exerciseProfiles.get("sumo_deadlift"))?.oneRepMax).toBe(75);
  });

  it("설정이 아예 없으면 추가 저장을 거부한다 (SETUP_NOT_FOUND)", async () => {
    expect(await addSetupExercises(db, buildSumoUpgradeInput({ source: "EDITED", text: "75" })!)).toMatchObject({ ok: false, error: "SETUP_NOT_FOUND" });
    expect(await db.exerciseProfiles.count()).toBe(0);
  });
});
