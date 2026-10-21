import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NsunsDatabase } from "@/storage/db";
import { HYBRID_T1_TEMPLATE, HYBRID_T2_TEMPLATE, type SetTemplate } from "@/domain/templates/hybridTemplates";
import { getExerciseProfile, initializeExerciseProfile, listTMChanges, saveExercise } from "@/storage/repositories/exerciseRepository";
import {
  completeSet,
  completeWorkoutSession,
  getSessionDetail,
  startWorkoutSession,
  type SessionDetail,
  type SessionExercisePlan,
} from "@/storage/repositories/workoutRepository";
import { kg, lb, type WeightUnit } from "@/domain/types/weight";
import type { Clock } from "@/storage/ids";
import type { SetRecord, Tier } from "@/domain/types/model";
import { createTestClock, createTestDatabase, destroyDatabase, expectOk, openSameDatabase } from "./helpers";

let db: NsunsDatabase;
let clock: Clock;

/** 운동 + 프로필 저장. T1·T2 운동은 1RM(TM = × 0.9), T3는 작업 중량 */
async function seed(exerciseId: string, value: number, kind: "TM" | "T3" = "TM", unit: WeightUnit = "kg") {
  expectOk(await saveExercise(db, { exerciseId, name: exerciseId, equipment: "BARBELL", weightUnit: unit, increment: unit === "kg" ? 2.5 : 5 }, { clock }));
  const mass = unit === "kg" ? kg(value) : lb(value);
  expectOk(
    await initializeExerciseProfile(
      db,
      kind === "TM"
        ? { exerciseId, oneRepMax: mass, oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null }
        : { exerciseId, oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: mass },
      { clock },
    ),
  );
}

beforeEach(async () => {
  db = createTestDatabase();
  clock = createTestClock();
  await seed("bench_press", 100); // TM 90
  await seed("ohp", 60); // TM 54
  await seed("squat", 120); // TM 108
  await seed("front_squat", 96); // TM 86.4 (증량 정책 없음)
  await seed("cable_fly", 15, "T3");
});
afterEach(async () => {
  await destroyDatabase(db);
});

const tpl = (exerciseId: string, tier: "T1" | "T2", template: SetTemplate = tier === "T1" ? HYBRID_T1_TEMPLATE : HYBRID_T2_TEMPLATE): SessionExercisePlan => ({
  exerciseId, tier, templateId: template.templateId, templateVersion: template.templateVersion, restSeconds: 60, template,
});
const t3: SessionExercisePlan = { exerciseId: "cable_fly", tier: "T3", templateId: null, templateVersion: null, restSeconds: 60 };
const start = async (exercises: SessionExercisePlan[]) =>
  expectOk(await startWorkoutSession(db, { scheduledDay: "MONDAY", workoutDate: "2026-10-19", exercises }, { clock }));

/** 모든 세트를 목표값대로 완료. adjust로 특정 세트의 실제값을 바꾼다 */
async function completeAll(detail: SessionDetail, adjust: (set: SetRecord, tier: Tier) => { weight?: number; reps?: number } = () => ({})) {
  for (const { sessionExercise, sets } of detail.exercises) {
    for (const set of sets) {
      const change = adjust(set, sessionExercise.tier);
      const weight = change.weight ?? set.targetWeight;
      expectOk(await completeSet(db, set.setRecordId, { actualWeight: { value: weight, unit: set.weightUnit }, actualReps: change.reps ?? set.targetReps }, { clock }));
    }
  }
}
const tm = async (id: string) => expectOk(await getExerciseProfile(db, id))?.currentTM;
const progressions = async (id: string) => expectOk(await listTMChanges(db, id)).filter((c) => c.reason !== "INITIAL");

describe("세션 정상 완료 시 T1·T2 목표 달성 판정과 TM 증량 (H-22)", () => {
  it("모든 세트 목표 달성 → 벤치 90→92.5(T1), OHP 54→56.5(T2), TMChange 이력 저장, T3 FST-7도 그대로 증량", async () => {
    const detail = await start([tpl("bench_press", "T1"), tpl("ohp", "T2"), t3]);
    await completeAll(detail);
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));

    expect(result.tmProgressions).toEqual([
      expect.objectContaining({ exerciseId: "bench_press", tiers: ["T1"], status: "INCREASED", fromTM: 90, toTM: 92.5, unit: "kg", reasons: [] }),
      expect.objectContaining({ exerciseId: "ohp", tiers: ["T2"], status: "INCREASED", fromTM: 54, toTM: 56.5 }),
    ]);
    expect(await tm("bench_press")).toBe(92.5);
    expect(await tm("ohp")).toBe(56.5);
    expect(await progressions("bench_press")).toEqual([
      expect.objectContaining({ reason: "SESSION_PROGRESSION", fromTM: 90, toTM: 92.5, weightUnit: "kg", sourceSessionId: detail.session.sessionId, sourceTier: "T1", ruleId: "hybrid-target-progression", ruleVersion: 1 }),
    ]);
    expect(result.t3Progressions[0]).toMatchObject({ applied: true, decision: { nextWorkingWeight: { value: 17.5 } } });
    expect(expectOk(await getExerciseProfile(db, "cable_fly"))?.t3WorkingWeight).toBe(17.5);
    expect(result.pendingProgressions).toEqual([]);
    const after = expectOk(await getSessionDetail(db, detail.session.sessionId))!;
    expect(after.exercises.every((e) => e.sessionExercise.progressionEvaluatedAt !== null)).toBe(true);
  });

  it("반복 1회 부족 → 그 운동만 TM 유지(사유 기록), 다른 운동은 독립 판정", async () => {
    const detail = await start([tpl("bench_press", "T1"), tpl("ohp", "T2")]);
    await completeAll(detail, (set, tier) => (tier === "T1" && set.setNumber === 3 ? { reps: set.targetReps - 1 } : {}));
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ exerciseId: "bench_press", status: "HELD", fromTM: 90, toTM: 90, reasons: [{ tier: "T1", setNumber: 3, code: "REPS_BELOW_TARGET" }] });
    expect(await tm("bench_press")).toBe(90);
    expect(await progressions("bench_press")).toHaveLength(0);
    expect(await tm("ohp")).toBe(56.5);
  });

  it("실제 중량 부족 → TM 유지", async () => {
    const detail = await start([tpl("squat", "T1")]);
    await completeAll(detail, (set) => (set.setNumber === 5 ? { weight: set.targetWeight - 2.5, reps: 10 } : {}));
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ status: "HELD", reasons: [{ tier: "T1", setNumber: 5, code: "WEIGHT_BELOW_TARGET" }] });
    expect(await tm("squat")).toBe(108);
  });

  it("AMRAP은 최소 반복 이상이면 성공: 스쿼트 108 → 113 (+5kg)", async () => {
    const detail = await start([tpl("squat", "T1")]);
    await completeAll(detail, (set) => (set.isAmrap ? { reps: set.setNumber === 5 ? 1 : 9 } : {}));
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ status: "INCREASED", fromTM: 108, toTM: 113 });
  });

  it("미완료 세트가 있으면 세션 완료 자체가 거부되고 TM·이력 불변", async () => {
    const detail = await start([tpl("bench_press", "T1")]);
    const [first] = detail.exercises[0].sets;
    expectOk(await completeSet(db, first.setRecordId, { actualWeight: kg(first.targetWeight), actualReps: first.targetReps }, { clock }));
    expect(await completeWorkoutSession(db, detail.session.sessionId, { clock })).toMatchObject({ ok: false, error: "SESSION_HAS_INCOMPLETE_SETS" });
    expect(await tm("bench_press")).toBe(90);
    expect(await progressions("bench_press")).toHaveLength(0);
  });

  it("증량 정책이 없는 T2(프론트 스쿼트)는 목표를 달성해도 TM 유지 (NO_POLICY, 보류 목록)", async () => {
    const detail = await start([tpl("squat", "T1"), tpl("front_squat", "T2")]);
    await completeAll(detail);
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions.find((p) => p.exerciseId === "front_squat")).toMatchObject({ status: "NO_POLICY", fromTM: 86.4, toTM: 86.4 });
    expect(await tm("front_squat")).toBe(86.4);
    expect(result.pendingProgressions.map((p) => p.exerciseId)).toEqual(["front_squat"]);
    const after = expectOk(await getSessionDetail(db, detail.session.sessionId))!;
    expect(after.exercises.find((e) => e.sessionExercise.exerciseId === "front_squat")?.sessionExercise.progressionEvaluatedAt).toBeNull();
  });

  it("lb 프로필은 단위 정책 확정 전 자동 증량하지 않는다 (UNIT_NOT_SUPPORTED)", async () => {
    await db.delete();
    db = createTestDatabase();
    await seed("bench_press", 225, "TM", "lb"); // TM 202.5 lb
    const detail = await start([tpl("bench_press", "T1")]);
    await completeAll(detail);
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ status: "UNIT_NOT_SUPPORTED", unit: "lb", fromTM: 202.5, toTM: 202.5 });
    expect(await tm("bench_press")).toBe(202.5);
  });
});

describe("중복 증량 방지", () => {
  it("완료된 세션은 다시 판정하지 않는다 (재완료 거부, TM 한 번만)", async () => {
    const detail = await start([tpl("bench_press", "T1")]);
    await completeAll(detail);
    expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(await completeWorkoutSession(db, detail.session.sessionId, { clock })).toMatchObject({ ok: false, error: "SESSION_NOT_IN_PROGRESS" });
    expect(await tm("bench_press")).toBe(92.5);
    expect(await progressions("bench_press")).toHaveLength(1);
  });

  it("같은 세션에 같은 운동이 T1·T2로 함께 있어도 한 번만 증량 (54 → 56.5, 이력 1건)", async () => {
    const detail = await start([tpl("ohp", "T1"), tpl("ohp", "T2")]);
    await completeAll(detail);
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions).toEqual([expect.objectContaining({ exerciseId: "ohp", tiers: ["T1", "T2"], status: "INCREASED", fromTM: 54, toTM: 56.5 })]);
    expect(await tm("ohp")).toBe(56.5);
    expect(await progressions("ohp")).toEqual([expect.objectContaining({ sourceTier: "T1" })]);
  });

  it("같은 세션의 T1·T2 중 하나라도 목표 미달이면 유지", async () => {
    const detail = await start([tpl("ohp", "T1"), tpl("ohp", "T2")]);
    await completeAll(detail, (set, tier) => (tier === "T2" && set.setNumber === 8 ? { reps: 7 } : {}));
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ status: "HELD", reasons: [{ tier: "T2", setNumber: 8, code: "REPS_BELOW_TARGET" }] });
    expect(await tm("ohp")).toBe(54);
  });

  it("이미 이 세션·운동의 TM 변경 이력이 있으면 다시 증량하지 않는다 (ALREADY_APPLIED)", async () => {
    const detail = await start([tpl("bench_press", "T1")]);
    await completeAll(detail);
    await db.tmChanges.add({
      tmChangeId: "pre", exerciseId: "bench_press", weightUnit: "kg", fromTM: 90, toTM: 92.5, reason: "SESSION_PROGRESSION",
      sourceSessionId: detail.session.sessionId, sourceTier: "T1", ruleId: "hybrid-target-progression", ruleVersion: 1, appliedAt: "2026-10-21T00:00:00.000Z",
    });
    const result = expectOk(await completeWorkoutSession(db, detail.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ status: "ALREADY_APPLIED" });
    expect(await tm("bench_press")).toBe(90);
    expect(await progressions("bench_press")).toHaveLength(1);
  });

  it("두 탭에서 동시에 완료해도 TM은 한 번만 증량", async () => {
    const detail = await start([tpl("bench_press", "T1")]);
    await completeAll(detail);
    const otherTab = openSameDatabase(db);
    const results = await Promise.all([completeWorkoutSession(db, detail.session.sessionId, { clock }), completeWorkoutSession(otherTab, detail.session.sessionId, { clock })]);
    otherTab.close();
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await tm("bench_press")).toBe(92.5);
    expect(await progressions("bench_press")).toHaveLength(1);
  });

  it("TMChange 저장 실패 시 세션 완료·TM·T3 증량 모두 롤백", async () => {
    const detail = await start([tpl("bench_press", "T1"), t3]);
    await completeAll(detail);
    db.tmChanges.hook("creating", () => {
      throw new Error("forced tmChanges failure");
    });
    expect(await completeWorkoutSession(db, detail.session.sessionId, { clock })).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    const after = expectOk(await getSessionDetail(db, detail.session.sessionId))!;
    expect(after.session.status).toBe("IN_PROGRESS");
    expect(after.exercises.every((e) => e.sessionExercise.progressionEvaluatedAt === null)).toBe(true);
    expect(await tm("bench_press")).toBe(90);
    expect(expectOk(await getExerciseProfile(db, "cable_fly"))?.t3WorkingWeight).toBe(15);
  });
});

describe("다음 세션 적용과 과거 스냅샷", () => {
  it("다음 세션은 증량된 TM으로 목표를 계산하고, 이전 세션 스냅샷·목표는 그대로", async () => {
    const first = await start([tpl("bench_press", "T1")]);
    await completeAll(first);
    expectOk(await completeWorkoutSession(db, first.session.sessionId, { clock }));

    const second = await start([tpl("bench_press", "T1")]);
    expect(second.exercises[0].sessionExercise.tmAtSession).toBe(92.5);
    // 92.5 × 0.65 = 60.125 → 60, × 0.95 = 87.875 → 87.5
    expect(second.exercises[0].sets[0].targetWeight).toBe(60);
    expect(second.exercises[0].sets[4].targetWeight).toBe(87.5);

    const firstAfter = expectOk(await getSessionDetail(db, first.session.sessionId))!;
    expect(firstAfter.exercises[0].sessionExercise.tmAtSession).toBe(90);
    expect(firstAfter.exercises[0].sets.map((s) => s.targetWeight)).toEqual(first.exercises[0].sets.map((s) => s.targetWeight));
  });

  it("T1·T2 공통 프로필: Day 1 T2 OHP 성공(54→56.5) 후 Day 4 T1 OHP는 56.5로 시작하고 성공 시 59", async () => {
    const day1 = await start([tpl("ohp", "T2")]);
    await completeAll(day1);
    expectOk(await completeWorkoutSession(db, day1.session.sessionId, { clock }));

    const day4 = await start([tpl("ohp", "T1")]);
    expect(day4.exercises[0].sessionExercise.tmAtSession).toBe(56.5);
    await completeAll(day4);
    const result = expectOk(await completeWorkoutSession(db, day4.session.sessionId, { clock }));
    expect(result.tmProgressions[0]).toMatchObject({ fromTM: 56.5, toTM: 59, tiers: ["T1"] });
    expect((await progressions("ohp")).map((c) => [c.sourceTier, c.fromTM, c.toTM])).toEqual([["T2", 54, 56.5], ["T1", 56.5, 59]]);
  });
});
