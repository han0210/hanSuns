import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialSetupState, setupReducer, type SetupAction } from "@/features/setup-prototype/setupModel";
import { buildInitialSetupInput, exerciseName } from "@/features/setup-prototype/setupPersistence";
import {
  buildT3SessionPlan,
  defaultTrainingDay,
  localIsoDate,
  normalizeRestSeconds,
  REST_DEFAULT_SECONDS,
  TRAINING_DAYS,
} from "@/features/workout/t3SessionPlan";
import { storageErrorMessage, toSetRecordId, toUiSession } from "@/features/workout/sessionMapper";
import { loadRestSeconds, loadTimer, saveRestSeconds, saveTimer } from "@/features/workout/restTimerStorage";
import { createInitialState, workoutReducer } from "@/features/workout-prototype/workoutReducer";
import { saveInitialSetup } from "@/storage/repositories/setupRepository";
import { getExerciseProfile } from "@/storage/repositories/exerciseRepository";
import {
  completeSet,
  completeWorkoutSession,
  getActiveSession,
  startWorkoutSession,
} from "@/storage/repositories/workoutRepository";
import { kg } from "@/domain/types/weight";
import type { NsunsDatabase } from "@/storage/db";
import { createTestDatabase, destroyDatabase, expectOk, openSameDatabase } from "../storage/helpers";

const MONDAY = new Date(2026, 9, 19, 23, 30); // 2026-10-19(월) 23:30 현지 시각
const monday = TRAINING_DAYS[0];

describe("T3 전용 세션 계획 — 미확정 템플릿 오사용 방지", () => {
  it("선택한 요일의 T3 운동 하나만 담고, 세트는 넘기지 않는다 (저장 계층이 FST-7 생성)", () => {
    const plan = buildT3SessionPlan(monday, MONDAY, 30);
    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0]).toMatchObject({ exerciseId: "cable_fly", tier: "T3", templateId: null, restSeconds: 30 });
    expect(plan.exercises[0].sets).toBeUndefined();
    expect(plan.exercises.some((e) => e.tier !== "T3")).toBe(false);
  });

  it("모든 운동일의 계획이 T3만 포함한다", () => {
    for (const day of TRAINING_DAYS) {
      expect(buildT3SessionPlan(day, MONDAY, 30).exercises.map((e) => e.tier)).toEqual(["T3"]);
    }
  });

  it("운동 날짜는 기기 현지 날짜 (UTC 변환으로 하루 밀리지 않음)", () => {
    expect(localIsoDate(MONDAY)).toBe("2026-10-19");
    expect(buildT3SessionPlan(monday, MONDAY, 30).workoutDate).toBe("2026-10-19");
  });

  it("휴식일(수·일)은 월요일을 기본 선택", () => {
    expect(defaultTrainingDay(new Date(2026, 9, 21)).weekday).toBe("MONDAY"); // 수
    expect(defaultTrainingDay(new Date(2026, 9, 23)).weekday).toBe("FRIDAY");
  });
});

describe("휴식 시간 기본값과 설정", () => {
  it("기본값: T1·T2 60초, T3 30초", () => {
    expect(REST_DEFAULT_SECONDS).toEqual({ T1: 60, T2: 60, T3: 30 });
  });

  it("범위 밖·잘못된 값은 15~600초 정수로 맞추거나 기본값", () => {
    expect(normalizeRestSeconds(5, 30)).toBe(15);
    expect(normalizeRestSeconds(9999, 30)).toBe(600);
    expect(normalizeRestSeconds("45.4", 30)).toBe(45);
    expect(normalizeRestSeconds("abc", 30)).toBe(30);
    expect(normalizeRestSeconds(undefined, 60)).toBe(60);
  });

  it("사용자가 바꾼 휴식 시간을 기기에 저장·복원하고, 저장소가 없거나 실패해도 기본값으로 동작", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
    expect(loadRestSeconds("T3", storage)).toBe(30);
    saveRestSeconds("T3", 90, storage);
    expect(loadRestSeconds("T3", storage)).toBe(90);
    expect(loadRestSeconds("T3", null)).toBe(30);
    const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => undefined };
    expect(loadRestSeconds("T3", broken)).toBe(30);
    expect(() => saveRestSeconds("T3", 90, broken)).not.toThrow();
  });

  it("타이머는 종료 예정 시각으로 저장·복원하고, 다른 세션이나 오래 끝난 타이머는 복원하지 않는다", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
    const running = { phase: "running", endAt: 1_000_030_000, totalSeconds: 30, tier: "T3", sessionExerciseId: "s:T3:x" } as const;
    saveTimer("s", running, storage);
    expect(loadTimer("s", 1_000_000_000, storage)).toEqual(running);
    expect(loadTimer("other", 1_000_000_000, storage)).toEqual({ phase: "idle" });
    expect(loadTimer("s", 1_000_030_000 + 61_000, storage)).toEqual({ phase: "idle" });
    saveTimer("s", { phase: "idle" }, storage);
    expect(memory.size).toBe(0);
    memory.set("nsuns-hybrid.restTimer.v1", "{not json");
    expect(loadTimer("s", 0, storage)).toEqual({ phase: "idle" });
  });
});

describe("Setup 저장 → T3 세션 시작 → 세트 기록 → 복원 → 완료", () => {
  let db: NsunsDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    const actions: SetupAction[] = [
      { type: "SET_DIRECT", id: "bench_press", text: "100" },
      { type: "SET_DIRECT", id: "deadlift", text: "140" },
      { type: "SET_DIRECT", id: "squat", text: "120" },
      { type: "SET_DIRECT", id: "ohp", text: "60" },
      { type: "SET_T3", id: "cable_fly", text: "15" },
      { type: "SET_T3", id: "leg_curl", text: "40" },
      { type: "SET_T3", id: "leg_extension", text: "45" },
      { type: "SET_T3", id: "dumbbell_lateral_raise", text: "8" },
      { type: "SET_T3", id: "lat_pulldown", text: "50" },
      { type: "COMPLETE" },
    ];
    const input = buildInitialSetupInput(actions.reduce(setupReducer, createInitialSetupState()));
    expectOk(await saveInitialSetup(db, input!));
  });
  afterEach(async () => {
    await destroyDatabase(db);
  });

  it("세션 생성 시 세션 시작 당시 작업 중량으로 7×12 세트를 만들고, 화면 상태로 변환한다", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildT3SessionPlan(monday, MONDAY, 30)));
    const ui = toUiSession(detail, exerciseName, "월 · T3");
    expect(ui.status).toBe("IN_PROGRESS");
    expect(ui.exercises).toHaveLength(1);
    expect(ui.exercises[0]).toMatchObject({ exerciseName: "케이블 플라이", tier: "T3", restSeconds: 30 });
    expect(ui.exercises[0].sets).toHaveLength(7);
    expect(ui.exercises[0].sets.every((s) => s.targetWeight === 15 && s.targetReps === 12 && !s.completed && s.actualWeightDraft === "")).toBe(true);
    expect(detail.exercises[0].sessionExercise.workingWeightAtSession).toBe(15);
  });

  it("실제 중량·반복 저장 → 완료 세트 잠금 → 중복 완료 거부 → 새로고침 복원", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildT3SessionPlan(monday, MONDAY, 30)));
    const seId = detail.exercises[0].sessionExercise.sessionExerciseId;
    const first = expectOk(await completeSet(db, toSetRecordId(seId, 1), { actualWeight: kg(15), actualReps: 13 }));
    expect(first).toMatchObject({ startRestTimer: true, nextSetNumber: 2 });
    expect(await completeSet(db, toSetRecordId(seId, 1), { actualWeight: kg(17.5), actualReps: 10 })).toMatchObject({ ok: false, error: "SET_ALREADY_COMPLETED" });

    db.close();
    const reopened = openSameDatabase(db);
    const restored = expectOk(await getActiveSession(reopened));
    reopened.close();
    await db.open();
    const ui = toUiSession(restored!, exerciseName, "월");
    expect(ui.exercises[0].sets[0]).toMatchObject({ completed: true, actualWeight: 15, actualReps: 13, actualWeightDraft: "15", actualRepsDraft: "13" });
    expect(ui.exercises[0].sets.slice(1).every((s) => !s.completed && s.actualWeight === null)).toBe(true);
  });

  it("미완료 세트가 있으면 완료 거부, 7세트 모두 12회 이상이면 완료 + 다음 작업 중량 증가", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildT3SessionPlan(monday, MONDAY, 30)));
    const seId = detail.exercises[0].sessionExercise.sessionExerciseId;
    for (let n = 1; n <= 6; n += 1) expectOk(await completeSet(db, toSetRecordId(seId, n), { actualWeight: kg(15), actualReps: 12 }));
    expect(await completeWorkoutSession(db, detail.session.sessionId)).toMatchObject({ ok: false, error: "SESSION_HAS_INCOMPLETE_SETS" });
    expect(expectOk(await getExerciseProfile(db, "cable_fly"))?.t3WorkingWeight).toBe(15);

    expectOk(await completeSet(db, toSetRecordId(seId, 7), { actualWeight: kg(15), actualReps: 12 }));
    const done = expectOk(await completeWorkoutSession(db, detail.session.sessionId));
    expect(done.t3Progressions[0]).toMatchObject({ applied: true, decision: { decision: "INCREASE", nextWorkingWeight: { value: 17.5 } } });
    expect(done.pendingProgressions).toEqual([]);
    expect(expectOk(await getActiveSession(db))).toBeNull();
  });
});

describe("화면 리듀서 — 저장 결과 반영", () => {
  async function uiState() {
    const detail = {
      session: { sessionId: "s", scheduledDay: "MONDAY", workoutDate: "2026-10-19", status: "IN_PROGRESS", startedAt: null, completedAt: null, schemaVersion: 1 },
      exercises: [
        {
          sessionExercise: {
            sessionExerciseId: "s:T3:cable_fly", sessionId: "s", exerciseId: "cable_fly", tier: "T3", weightUnit: "kg", increment: 2.5,
            templateId: null, templateVersion: null, tmAtSession: null, workingWeightAtSession: 15, workingWeightRevisionAtSession: 0,
            displayOrder: 0, restSeconds: 30, resetCount: 0, lastResetAt: null, progressionEvaluatedAt: null,
          },
          sets: Array.from({ length: 7 }, (_, i) => ({
            setRecordId: `s:T3:cable_fly#${i + 1}`, sessionExerciseId: "s:T3:cable_fly", sessionId: "s", exerciseId: "cable_fly", tier: "T3",
            setNumber: i + 1, weightUnit: "kg", targetWeight: 15, targetReps: 12, isAmrap: false, manualTargetWeight: null,
            completed: false, actualWeight: null, actualReps: null, completedAt: null,
          })),
          nextSetNumber: 1,
        },
      ],
    } as const;
    // 읽기 전용 리터럴을 저장 계층 타입으로 사용
    return createInitialState(toUiSession(detail as unknown as Parameters<typeof toUiSession>[0], exerciseName, "월"));
  }

  it("T3 전용 세션은 첫 운동을 펼친다", async () => {
    const state = await uiState();
    expect(state.expandedExerciseId).toBe("s:T3:cable_fly");
  });

  it("저장 실패 시 완료 표시·휴식 타이머 모두 시작하지 않고 입력값을 유지한다", async () => {
    let state = await uiState();
    state = workoutReducer(state, { type: "UPDATE_DRAFT", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, field: "weight", value: "15" });
    state = workoutReducer(state, { type: "UPDATE_DRAFT", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, field: "reps", value: "12" });
    state = workoutReducer(state, { type: "SAVE_STARTED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1 });
    state = workoutReducer(state, { type: "SAVE_FAILED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, message: storageErrorMessage("STORAGE_ERROR") });
    expect(state.timer).toEqual({ phase: "idle" });
    expect(state.session.exercises[0].sets[0]).toMatchObject({ completed: false, actualWeightDraft: "15", actualRepsDraft: "12" });
    expect(state.errors["s:T3:cable_fly#1"]?.save).toContain("다시 시도");
  });

  it("저장 성공 시 세션의 휴식 시간(30초)으로 타이머를 시작한다", async () => {
    let state = await uiState();
    state = workoutReducer(state, { type: "SAVE_STARTED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1 });
    state = workoutReducer(state, { type: "SAVE_SUCCEEDED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, weight: 15, reps: 12, now: 1000 });
    expect(state.timer).toMatchObject({ phase: "running", endAt: 31_000, totalSeconds: 30, tier: "T3" });
  });

  it("저장 중 같은 세트의 두 번째 저장 시작은 무시된다", async () => {
    let state = await uiState();
    state = workoutReducer(state, { type: "SAVE_STARTED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1 });
    const again = workoutReducer(state, { type: "SAVE_STARTED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1 });
    expect(again).toBe(state);
  });

  it("완료된 세트의 입력 변경은 반영되지 않는다", async () => {
    let state = await uiState();
    state = workoutReducer(state, { type: "SAVE_SUCCEEDED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, weight: 15, reps: 12, now: 1000 });
    const after = workoutReducer(state, { type: "UPDATE_DRAFT", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, field: "reps", value: "3" });
    expect(after.session.exercises[0].sets[0]).toMatchObject({ actualReps: 12, actualRepsDraft: "12" });
  });

  it("SESSION_LOADED는 저장소 기준으로 화면을 바꾸고, 사라진 운동의 타이머는 끈다", async () => {
    let state = await uiState();
    state = workoutReducer(state, { type: "SAVE_SUCCEEDED", sessionExerciseId: "s:T3:cable_fly", setNumber: 1, weight: 15, reps: 12, now: 1000 });
    const emptied = workoutReducer(state, { type: "SESSION_LOADED", session: { ...state.session, exercises: [] } });
    expect(emptied.timer).toEqual({ phase: "idle" });
    const kept = workoutReducer(state, { type: "SESSION_LOADED", session: state.session });
    expect(kept.timer.phase).toBe("running");
  });
});
