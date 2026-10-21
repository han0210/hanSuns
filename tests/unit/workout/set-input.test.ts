import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { draftToSave, stepReps, stepWeight, weightStepFor, WEIGHT_STEP_KG } from "@/features/workout/setInput";
import { toUiSession } from "@/features/workout/sessionMapper";
import { exerciseName } from "@/features/setup-prototype/setupPersistence";
import { hasResettableRecord } from "@/features/workout-prototype/workoutLogic";
import { createInitialState, workoutReducer } from "@/features/workout-prototype/workoutReducer";
import { HYBRID_T1_TEMPLATE } from "@/domain/templates/hybridTemplates";
import { completeSet, getActiveSession, startWorkoutSession, updateSetDraft } from "@/storage/repositories/workoutRepository";
import type { NsunsDatabase } from "@/storage/db";
import { kg, lb } from "@/domain/types/weight";
import { createTestClock, createTestDatabase, destroyDatabase, expectOk, openSameDatabase, seedProfiles } from "../storage/helpers";

describe("중량·반복 +/- 버튼", () => {
  it("중량은 kg 세트에서 2.5kg씩, 0 아래로 내려가지 않는다", () => {
    expect(WEIGHT_STEP_KG).toBe(2.5);
    expect(stepWeight("57.5", 2.5, 57.5)).toBe("60");
    expect(stepWeight("57.5", -2.5, 57.5)).toBe("55");
    expect(stepWeight("1", -2.5, 57.5)).toBe("0");
    expect(stepWeight("0", -2.5, 57.5)).toBe("0");
  });

  it("부동소수점 잡음 없이 표시 (0.1 + 0.2 문제 없음)", () => {
    expect(stepWeight("0.1", 2.5, 10)).toBe("2.6");
    expect(stepWeight("72.45", 2.5, 10)).toBe("74.95");
  });

  it("입력값이 숫자가 아니거나 비어 있으면 목표값에서 시작", () => {
    expect(stepWeight("", 2.5, 57.5)).toBe("60");
    expect(stepWeight("abc", -2.5, 57.5)).toBe("55");
  });

  it("반복은 1회씩, 정수, 0 아래로 내려가지 않는다", () => {
    expect(stepReps("8", 1, 8)).toBe("9");
    expect(stepReps("8", -1, 8)).toBe("7");
    expect(stepReps("0", -1, 8)).toBe("0");
    expect(stepReps("", 1, 4)).toBe("5");
    expect(stepReps("2.5", 1, 4)).toBe("5");
  });

  it("단위 혼용 없음: kg 세트는 2.5kg, lb 세트는 해당 운동 증가 단위(lb)", () => {
    expect(weightStepFor("kg", 1)).toBe(2.5);
    expect(weightStepFor("lb", 5)).toBe(5);
  });
});

describe("미완료 입력값의 초안 저장 변환", () => {
  it("유효한 값은 세트 단위 그대로, 비었거나 잘못된 값은 null(저장 시 지움)", () => {
    expect(draftToSave("60", "8", "kg")).toEqual({ actualWeight: kg(60), actualReps: 8 });
    expect(draftToSave("135", "5", "lb")).toEqual({ actualWeight: lb(135), actualReps: 5 });
    expect(draftToSave("", "", "kg")).toEqual({ actualWeight: null, actualReps: null });
    expect(draftToSave("0", "-1", "kg")).toEqual({ actualWeight: null, actualReps: null });
    expect(draftToSave("60.", "2.5", "kg")).toEqual({ actualWeight: null, actualReps: null });
  });
});

describe("초기값 = 각 세트 목표, 저장된 초안 복원", () => {
  let db: NsunsDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await seedProfiles(db, createTestClock()); // bench TM 90
  });
  afterEach(async () => {
    await destroyDatabase(db);
  });

  const start = async () =>
    expectOk(
      await startWorkoutSession(db, {
        scheduledDay: "MONDAY",
        workoutDate: "2026-10-21",
        exercises: [{ exerciseId: "bench", tier: "T1", templateId: "hybrid-t1", templateVersion: 1, restSeconds: 60, template: HYBRID_T1_TEMPLATE }],
      }),
    );

  it("미완료 세트의 입력칸은 그 세트 자체의 목표 중량·반복으로 채워진다 (이전 세트 기록이 아님)", async () => {
    const detail = await start();
    expectOk(await completeSet(db, detail.exercises[0].sets[0].setRecordId, { actualWeight: kg(62.5), actualReps: 10 }));
    const ui = toUiSession(expectOk(await getActiveSession(db))!, exerciseName, "Day 1");
    const [first, second, , , fifth] = ui.exercises[0].sets;
    expect(first).toMatchObject({ completed: true, actualWeightDraft: "62.5", actualRepsDraft: "10" });
    expect(second).toMatchObject({ completed: false, actualWeightDraft: "67.5", actualRepsDraft: "6" });
    expect(fifth).toMatchObject({ isAmrap: true, actualWeightDraft: "85", actualRepsDraft: "1" });
  });

  it("초안 저장 후 새로고침(DB 재오픈)하면 입력 중이던 값이 복원되고, 세트는 미완료 그대로", async () => {
    const detail = await start();
    const second = detail.exercises[0].sets[1];
    expectOk(await updateSetDraft(db, second.setRecordId, draftToSave("70", "5", "kg")!));
    db.close();
    const reopened = openSameDatabase(db);
    const restored = expectOk(await getActiveSession(reopened))!;
    reopened.close();
    await db.open();
    const set = toUiSession(restored, exerciseName, "Day 1").exercises[0].sets[1];
    expect(set).toMatchObject({ completed: false, actualWeightDraft: "70", actualRepsDraft: "5", actualWeight: null, actualReps: null });
  });

  it("목표값 그대로인 초안만 있으면 리셋할 기록이 없다, 값을 바꾸거나 완료하면 리셋 가능", async () => {
    const ui = toUiSession(await start(), exerciseName, "Day 1");
    expect(hasResettableRecord(ui.exercises[0])).toBe(false);
    const state = createInitialState(ui);
    const edited = workoutReducer(state, { type: "UPDATE_DRAFT", sessionExerciseId: ui.exercises[0].sessionExerciseId, setNumber: 2, field: "reps", value: "5" });
    expect(hasResettableRecord(edited.session.exercises[0])).toBe(true);
  });
});
