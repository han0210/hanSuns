import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialSetupState, setupReducer, type SetupAction, type SetupState } from "@/features/setup-prototype/setupModel";
import {
  buildInitialSetupInput,
  confirmSetup,
  restoreSetupState,
  SETUP_EXERCISE_IDS,
} from "@/features/setup-prototype/setupPersistence";
import { getSavedSetup, saveInitialSetup } from "@/storage/repositories/setupRepository";
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
    expect(saved.profiles).toHaveLength(13);
    expect(saved.profiles.find((p) => p.exerciseId === "ohp")).toMatchObject({ oneRepMax: 62.5, initialTM: 56.25, currentTM: 56.25 });
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
