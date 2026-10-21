import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NsunsDatabase } from "@/storage/db";
import { HYBRID_T1_TEMPLATE, HYBRID_T2_TEMPLATE } from "@/domain/templates/hybridTemplates";
import { startWorkoutSession, type SessionExercisePlan } from "@/storage/repositories/workoutRepository";
import { getExerciseProfile } from "@/storage/repositories/exerciseRepository";
import type { Clock } from "@/storage/ids";
import { createTestClock, createTestDatabase, destroyDatabase, expectOk, FIXTURE_T1_SETS, seedProfiles } from "./helpers";

let db: NsunsDatabase;
let clock: Clock;
beforeEach(async () => {
  db = createTestDatabase();
  clock = createTestClock();
  await seedProfiles(db, clock); // bench TM 90, ohp TM 54 (1RM 60), increment 2.5
});
afterEach(async () => {
  await destroyDatabase(db);
});

const t1 = (template = HYBRID_T1_TEMPLATE): SessionExercisePlan => ({
  exerciseId: "bench", tier: "T1", templateId: template.templateId, templateVersion: template.templateVersion, restSeconds: 60, template,
});
const t2: SessionExercisePlan = {
  exerciseId: "ohp", tier: "T2", templateId: HYBRID_T2_TEMPLATE.templateId, templateVersion: HYBRID_T2_TEMPLATE.templateVersion, restSeconds: 60, template: HYBRID_T2_TEMPLATE,
};
const t3: SessionExercisePlan = { exerciseId: "latPulldown", tier: "T3", templateId: null, templateVersion: null, restSeconds: 60 };
const plan = (exercises: SessionExercisePlan[]) => ({ scheduledDay: "MONDAY" as const, workoutDate: "2026-10-19", exercises });

describe("startWorkoutSession — Hybrid 템플릿으로 T1·T2 세트 생성", () => {
  it("세션 시작 시점 TM 스냅샷으로 T1 9세트·T2 8세트·T3 7세트를 만든다", async () => {
    const detail = expectOk(await startWorkoutSession(db, plan([t1(), t2, t3]), { clock }));
    const [bench, ohp, lat] = detail.exercises;
    expect(bench.sessionExercise).toMatchObject({ tier: "T1", tmAtSession: 90, templateId: "hybrid-t1", templateVersion: 1, displayOrder: 0, restSeconds: 60 });
    expect(bench.sets.map((s) => [s.targetWeight, s.targetReps, s.isAmrap])).toEqual([
      [57.5, 8, false], [67.5, 6, false], [77.5, 4, false], [80, 2, false], [85, 1, true], [80, 3, false], [77.5, 5, false], [72.5, 7, false], [67.5, 4, true],
    ]);
    // OHP TM 54: 27 / 32.4→32.5 / 37.8→37.5
    expect(ohp.sessionExercise).toMatchObject({ tier: "T2", tmAtSession: 54, templateId: "hybrid-t2" });
    expect(ohp.sets.map((s) => s.targetWeight)).toEqual([27.5, 32.5, 37.5, 37.5, 37.5, 37.5, 37.5, 37.5]);
    expect(lat.sets).toHaveLength(7);
    expect(detail.exercises.flatMap((e) => e.sets)).toHaveLength(24);
  });

  it("TM은 반올림하지 않은 값으로 스냅샷한다", async () => {
    await db.exerciseProfiles.update("bench", { currentTM: 91.35 });
    const detail = expectOk(await startWorkoutSession(db, plan([t1()]), { clock }));
    expect(detail.exercises[0].sessionExercise.tmAtSession).toBe(91.35);
    // 91.35 × 0.65 = 59.3775 → 60
    expect(detail.exercises[0].sets[0].targetWeight).toBe(60);
  });

  it("세션 시작 후 TM이 바뀌어도 목표 중량은 그대로다 (스냅샷)", async () => {
    const detail = expectOk(await startWorkoutSession(db, plan([t1()]), { clock }));
    await db.exerciseProfiles.update("bench", { currentTM: 120 });
    const stored = await db.setRecords.where("sessionExerciseId").equals(detail.exercises[0].sessionExercise.sessionExerciseId).sortBy("setNumber");
    expect(stored[0].targetWeight).toBe(57.5);
    expect(expectOk(await getExerciseProfile(db, "bench"))?.currentTM).toBe(120);
  });

  it.each([
    ["템플릿과 세트를 함께 지정", [{ ...t1(), sets: FIXTURE_T1_SETS }]],
    ["T1 계획에 T2 템플릿", [{ ...t1(HYBRID_T2_TEMPLATE), tier: "T1" as const }]],
    ["templateId와 템플릿 불일치", [{ ...t1(), templateId: "other" }]],
    ["T3에 템플릿 지정", [{ ...t3, template: HYBRID_T1_TEMPLATE }]],
  ])("%s → INVALID_SESSION_PLAN", async (_label, exercises) => {
    expect(await startWorkoutSession(db, plan(exercises as SessionExercisePlan[]), { clock })).toMatchObject({ ok: false, error: "INVALID_SESSION_PLAN" });
    expect(await db.workoutSessions.count()).toBe(0);
  });

  it("TM이 너무 작아 목표 중량이 0이 되면 TEMPLATE_CALCULATION_FAILED, 아무것도 저장하지 않는다", async () => {
    await db.exerciseProfiles.update("bench", { currentTM: 1 });
    expect(await startWorkoutSession(db, plan([t1(), t3]), { clock })).toMatchObject({ ok: false, error: "TEMPLATE_CALCULATION_FAILED" });
    expect(await db.workoutSessions.count()).toBe(0);
    expect(await db.setRecords.count()).toBe(0);
  });

  it("기존 방식(호출자가 세트를 넘김)도 그대로 동작한다", async () => {
    const detail = expectOk(await startWorkoutSession(db, plan([{ exerciseId: "bench", tier: "T1", templateId: "fixture-t1", templateVersion: 1, restSeconds: 60, sets: FIXTURE_T1_SETS }]), { clock }));
    expect(detail.exercises[0].sets).toHaveLength(3);
  });
});
