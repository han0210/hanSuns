import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialSetupState, setupReducer, type SetupAction } from "@/features/setup-prototype/setupModel";
import { buildInitialSetupInput, exerciseName } from "@/features/setup-prototype/setupPersistence";
import {
  buildSessionPlan,
  dayExerciseIds,
  dayLabel,
  nextTrainingDay,
  localIsoDate,
  normalizeRestSeconds,
  REST_DEFAULT_SECONDS,
  TRAINING_DAYS,
} from "@/features/workout/t3SessionPlan";
import { sessionScopeOf, storageErrorMessage, toUiSession } from "@/features/workout/sessionMapper";
import { loadRestSeconds, loadTimer, saveRestSeconds, saveTimer } from "@/features/workout/restTimerStorage";
import { createInitialState, workoutReducer } from "@/features/workout-prototype/workoutReducer";
import { saveInitialSetup } from "@/storage/repositories/setupRepository";
import { getExerciseProfile } from "@/storage/repositories/exerciseRepository";
import {
  completeSet,
  completeWorkoutSession,
  getActiveSession,
  getLastCompletedSession,
  getSessionDetail,
  startWorkoutSession,
  type SessionDetail,
} from "@/storage/repositories/workoutRepository";
import { kg } from "@/domain/types/weight";
import type { NsunsDatabase } from "@/storage/db";
import { createTestClock, createTestDatabase, destroyDatabase, expectOk, openSameDatabase } from "../storage/helpers";

const MONDAY = new Date(2026, 9, 19, 23, 30); // 2026-10-19(월) 23:30 현지 시각
const monday = TRAINING_DAYS[0];

const REST = { T1: 60, T2: 60, T3: 60 } as const;
/** 이전 버전(STEP 10 Lite)의 T3 전용 세션 계획: 기존 기록 보존 테스트용 */
const legacyT3Plan = (exerciseId: string) => ({
  scheduledDay: "MONDAY" as const,
  workoutDate: "2026-10-18",
  exercises: [{ exerciseId, tier: "T3" as const, templateId: null, templateVersion: null, restSeconds: 30 }],
});

describe("전체 세션 계획 — T1(Hybrid T1) → T2(Hybrid T2) → T3(FST-7)", () => {
  it("요일별 운동 3개를 T1·T2·T3 순서로, T1·T2는 Hybrid 템플릿, T3는 세트 없이", () => {
    const plan = buildSessionPlan(monday, MONDAY, REST);
    expect(plan.exercises.map((e) => [e.tier, e.exerciseId, e.templateId])).toEqual([
      ["T1", "bench_press", "hybrid-t1"],
      ["T2", "ohp", "hybrid-t2"],
      ["T3", "cable_fly", null],
    ]);
    // 목표 세트는 넘기지 않는다 (저장 계층이 TM 스냅샷으로 계산, 테스트 FIXTURE 미사용)
    expect(plan.exercises.every((e) => e.sets === undefined)).toBe(true);
    expect(plan.exercises[0].template?.sets).toHaveLength(9);
    expect(plan.exercises[1].template?.sets).toHaveLength(8);
    expect(plan.exercises[2].template).toBeUndefined();
  });

  it("Day 1~5 구성 (FUNCTIONS 2.1): Day 3 T2는 스모 데드리프트, Day 5 T1은 바벨 로우", () => {
    expect(TRAINING_DAYS.map((d) => [d.label, ...dayExerciseIds(d)])).toEqual([
      ["Day 1", "bench_press", "ohp", "cable_fly"],
      ["Day 2", "deadlift", "front_squat", "leg_curl"],
      ["Day 3", "squat", "sumo_deadlift", "leg_extension"],
      ["Day 4", "ohp", "incline_bench_press", "dumbbell_lateral_raise"],
      ["Day 5", "barbell_row", "barbell_shrug", "lat_pulldown"],
    ]);
  });

  it("티어별 휴식 시간을 반영하고 범위 밖 값은 보정", () => {
    const plan = buildSessionPlan(monday, MONDAY, { T1: 90, T2: 5, T3: 60 });
    expect(plan.exercises.map((e) => e.restSeconds)).toEqual([90, 15, 60]);
  });

  it("운동 날짜는 기기 현지 날짜 (UTC 변환으로 하루 밀리지 않음)", () => {
    expect(localIsoDate(MONDAY)).toBe("2026-10-19");
    expect(buildSessionPlan(monday, MONDAY, REST).workoutDate).toBe("2026-10-19");
  });

  it("다음 운동일: 마지막으로 완료한 Day의 다음 Day (5 다음은 1), 기록이 없으면 Day 1 — 실제 요일과 무관", () => {
    expect(nextTrainingDay(null).label).toBe("Day 1");
    expect(nextTrainingDay("MONDAY").label).toBe("Day 2");
    expect(nextTrainingDay("TUESDAY").label).toBe("Day 3");
    expect(nextTrainingDay("THURSDAY").label).toBe("Day 4");
    expect(nextTrainingDay("FRIDAY").label).toBe("Day 5");
    expect(nextTrainingDay("SATURDAY").label).toBe("Day 1");
    // 알 수 없는 값(운동일이 아닌 저장값)은 Day 1
    expect(nextTrainingDay("SUNDAY").label).toBe("Day 1");
  });

  it("저장값(scheduledDay) → Day 표시", () => {
    expect(dayLabel("MONDAY")).toBe("Day 1");
    expect(dayLabel("SATURDAY")).toBe("Day 5");
    expect(dayLabel("WEDNESDAY")).toBe("");
  });
});

describe("휴식 시간 기본값과 설정", () => {
  it("기본값: T1·T2·T3 모두 60초", () => {
    expect(REST_DEFAULT_SECONDS).toEqual({ T1: 60, T2: 60, T3: 60 });
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
    expect(loadRestSeconds("T3", storage)).toBe(60);
    expect(loadRestSeconds("T1", storage)).toBe(60);
    saveRestSeconds("T3", 90, storage);
    expect(loadRestSeconds("T3", storage)).toBe(90);
    // 이전 버전에서 사용자가 바꿔 저장한 값(예: 30초)은 새 기본값보다 우선
    saveRestSeconds("T1", 30, storage);
    expect(loadRestSeconds("T1", storage)).toBe(30);
    expect(loadRestSeconds("T3", null)).toBe(60);
    const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => undefined };
    expect(loadRestSeconds("T3", broken)).toBe(60);
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

describe("Setup 저장 → 전체 세션 시작 → 세트 기록 → 복원 → 완료", () => {
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

  const complete = async (detail: SessionDetail, reps?: (set: SessionDetail["exercises"][number]["sets"][number]) => number) => {
    for (const { sets } of detail.exercises) {
      for (const set of sets) {
        expectOk(await completeSet(db, set.setRecordId, { actualWeight: kg(set.targetWeight), actualReps: reps ? reps(set) : set.targetReps }));
      }
    }
  };

  it("월요일 전체 세션: 벤치 T1 9세트(TM 90)·OHP T2 8세트(TM 54)·케이블 플라이 T3 7세트, T1 먼저 펼침", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST)));
    const ui = toUiSession(detail, exerciseName, "월");
    expect(ui.exercises.map((e) => [e.tier, e.exerciseName, e.sets.length, e.restSeconds])).toEqual([
      ["T1", "벤치프레스", 9, 60],
      ["T2", "OHP", 8, 60],
      ["T3", "케이블 플라이", 7, 60],
    ]);
    expect(ui.exercises[0].sets.map((s) => s.targetWeight)).toEqual([57.5, 67.5, 77.5, 80, 85, 80, 77.5, 72.5, 67.5]);
    expect(ui.exercises[0].sets.filter((s) => s.isAmrap).map((s) => s.setNumber)).toEqual([5, 9]);
    expect(ui.exercises[1].sets.map((s) => s.targetWeight)).toEqual([27.5, 32.5, 37.5, 37.5, 37.5, 37.5, 37.5, 37.5]);
    expect(createInitialState(ui).expandedExerciseId).toBe(ui.exercises[0].sessionExerciseId);
  });

  it("목요일: 스모 T2는 스모 자체 TM(데드 140 × 0.5 × 0.9 = 63)으로 계산", async () => {
    const thursday = TRAINING_DAYS.find((d) => d.weekday === "THURSDAY")!;
    const detail = expectOk(await startWorkoutSession(db, buildSessionPlan(thursday, MONDAY, REST)));
    const sumo = detail.exercises[1];
    expect(sumo.sessionExercise).toMatchObject({ exerciseId: "sumo_deadlift", tmAtSession: 63 });
    // 31.5→32.5, 37.8→37.5, 44.1→45
    expect(sumo.sets.map((s) => s.targetWeight)).toEqual([32.5, 37.5, 45, 45, 45, 45, 45, 45]);
  });

  it("AMRAP 세트는 목표 이상 실제 반복을 그대로 기록하고, 완료 세트는 잠긴다", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST)));
    const amrap = detail.exercises[0].sets[4];
    const done = expectOk(await completeSet(db, amrap.setRecordId, { actualWeight: kg(85), actualReps: 6 }));
    expect(done.set).toMatchObject({ isAmrap: true, targetReps: 1, actualReps: 6, completed: true });
    expect(await completeSet(db, amrap.setRecordId, { actualWeight: kg(85), actualReps: 7 })).toMatchObject({ ok: false, error: "SET_ALREADY_COMPLETED" });
  });

  it("새로고침(DB 재오픈) 후 T1·T2·T3 기록 복원", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST)));
    expectOk(await completeSet(db, detail.exercises[0].sets[0].setRecordId, { actualWeight: kg(57.5), actualReps: 8 }));
    expectOk(await completeSet(db, detail.exercises[1].sets[0].setRecordId, { actualWeight: kg(27.5), actualReps: 5 }));
    db.close();
    const reopened = openSameDatabase(db);
    const restored = expectOk(await getActiveSession(reopened));
    reopened.close();
    await db.open();
    const ui = toUiSession(restored!, exerciseName, "월");
    expect(ui.exercises.map((e) => e.sets.filter((s) => s.completed).length)).toEqual([1, 1, 0]);
    expect(ui.exercises[0].sets[0]).toMatchObject({ completed: true, actualWeight: 57.5, actualReps: 8 });
  });

  it("24세트 중 하나라도 미완료면 완료 거부, 모두 목표대로 완료하면 COMPLETED + T3 증량 + T1·T2 TM 증량(H-22)", async () => {
    const detail = expectOk(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST)));
    const last = detail.exercises[2].sets[6];
    await complete({ ...detail, exercises: detail.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.setRecordId !== last.setRecordId) })) });
    expect(await completeWorkoutSession(db, detail.session.sessionId)).toMatchObject({ ok: false, error: "SESSION_HAS_INCOMPLETE_SETS" });
    expectOk(await completeSet(db, last.setRecordId, { actualWeight: kg(15), actualReps: 12 }));
    const done = expectOk(await completeWorkoutSession(db, detail.session.sessionId));
    expect(done.t3Progressions[0]).toMatchObject({ applied: true, decision: { nextWorkingWeight: { value: 17.5 } } });
    expect(done.pendingProgressions).toEqual([]);
    expect(done.tmProgressions.map((p) => [p.exerciseId, p.status, p.fromTM, p.toTM])).toEqual([
      ["bench_press", "INCREASED", 90, 92.5],
      ["ohp", "INCREASED", 54, 56.5],
    ]);
    expect(expectOk(await getExerciseProfile(db, "bench_press"))?.currentTM).toBe(92.5);
    expect(expectOk(await getExerciseProfile(db, "ohp"))?.currentTM).toBe(56.5);
  });

  it("마지막 완료 세션: 완료 시각이 가장 늦은 COMPLETED 세션 (진행 중 세션 제외, 이전 T3 전용 세션 포함)", async () => {
    const clock = createTestClock(); // 완료 시각 순서를 결정적으로
    expect(expectOk(await getLastCompletedSession(db))).toBeNull();
    const day1 = expectOk(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST), { clock }));
    await complete(day1);
    expectOk(await completeWorkoutSession(db, day1.session.sessionId, { clock }));
    expect(expectOk(await getLastCompletedSession(db))).toMatchObject({ sessionId: day1.session.sessionId, scheduledDay: "MONDAY", status: "COMPLETED" });
    expect(nextTrainingDay(expectOk(await getLastCompletedSession(db))!.scheduledDay).label).toBe("Day 2");

    // 이전 버전 T3 전용 세션(Day 2)을 나중에 완료 → 다음은 Day 3
    const legacy = expectOk(await startWorkoutSession(db, { ...legacyT3Plan("leg_curl"), scheduledDay: "TUESDAY" }, { clock }));
    await complete(legacy);
    expectOk(await completeWorkoutSession(db, legacy.session.sessionId, { clock }));
    // 진행 중 세션은 무시
    expectOk(await startWorkoutSession(db, buildSessionPlan(TRAINING_DAYS[4], MONDAY, REST), { clock }));
    const last = expectOk(await getLastCompletedSession(db));
    expect(last?.sessionId).toBe(legacy.session.sessionId);
    expect(nextTrainingDay(last!.scheduledDay).label).toBe("Day 3");
  });

  it("이전 버전의 완료된 T3 전용 세션은 그대로 남고, 새 전체 세션과 함께 조회된다", async () => {
    const legacy = expectOk(await startWorkoutSession(db, legacyT3Plan("cable_fly")));
    await complete(legacy);
    expectOk(await completeWorkoutSession(db, legacy.session.sessionId));
    const legacyBefore = expectOk(await getSessionDetail(db, legacy.session.sessionId));

    const full = expectOk(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST)));
    expect(full.exercises).toHaveLength(3);
    expect(expectOk(await getSessionDetail(db, legacy.session.sessionId))).toEqual(legacyBefore);
    expect(legacyBefore!.exercises.map((e) => e.sessionExercise.tier)).toEqual(["T3"]);
    expect(sessionScopeOf(legacyBefore!)).toBe("T3_ONLY");
    expect(sessionScopeOf(full)).toBe("FULL");
  });

  it("진행 중인 T3 전용 세션은 그대로 복원되며 T1·T2가 추가되지 않는다 (새 세션 시작도 거부)", async () => {
    const legacy = expectOk(await startWorkoutSession(db, legacyT3Plan("cable_fly")));
    expect(await startWorkoutSession(db, buildSessionPlan(monday, MONDAY, REST))).toMatchObject({ ok: false, error: "ACTIVE_SESSION_EXISTS" });
    const active = expectOk(await getActiveSession(db));
    expect(active!.session.sessionId).toBe(legacy.session.sessionId);
    expect(active!.exercises.map((e) => e.sessionExercise.tier)).toEqual(["T3"]);
    expect(active!.exercises[0].sessionExercise.restSeconds).toBe(30);
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
