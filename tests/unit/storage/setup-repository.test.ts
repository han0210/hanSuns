import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NsunsDatabase } from "@/storage/db";
import { getSavedSetup, saveInitialSetup, type InitialSetupInput } from "@/storage/repositories/setupRepository";
import { listTMChanges } from "@/storage/repositories/exerciseRepository";
import { kg } from "@/domain/types/weight";
import type { Clock } from "@/storage/ids";
import { createTestClock, createTestDatabase, destroyDatabase, expectOk, openSameDatabase } from "./helpers";

let db: NsunsDatabase;
let clock: Clock;
beforeEach(() => {
  db = createTestDatabase();
  clock = createTestClock();
});
afterEach(async () => {
  await destroyDatabase(db);
});

/** 직접 입력 1개 + 추정 1개 + T3 1개로 줄인 설정 입력 */
function setupInput(): InitialSetupInput {
  return {
    exercises: [
      { exerciseId: "bench_press", name: "벤치프레스", equipment: "BARBELL", weightUnit: "kg", increment: 2.5 },
      { exerciseId: "incline_bench_press", name: "인클라인 벤치프레스", equipment: "BARBELL", weightUnit: "kg", increment: 2.5 },
      { exerciseId: "lat_pulldown", name: "랫풀다운", equipment: "CABLE", weightUnit: "kg", increment: 2.5 },
    ],
    profiles: [
      { exerciseId: "bench_press", oneRepMax: kg(100), oneRepMaxSource: "DIRECT", estimateRuleId: null, t3WorkingWeight: null },
      { exerciseId: "incline_bench_press", oneRepMax: kg(85), oneRepMaxSource: "ESTIMATE_ACCEPTED", estimateRuleId: "setup-incline-bench-v1", t3WorkingWeight: null },
      { exerciseId: "lat_pulldown", oneRepMax: null, oneRepMaxSource: null, estimateRuleId: null, t3WorkingWeight: kg(50) },
    ],
  };
}

describe("saveInitialSetup — 최초 설정 일괄 저장", () => {
  it("운동·프로필·INITIAL TM 이력을 한 번에 저장하고, 출처 정보를 보존한다", async () => {
    const saved = expectOk(await saveInitialSetup(db, setupInput(), { clock }));
    expect(saved.profiles).toHaveLength(3);
    const loaded = expectOk(await getSavedSetup(db));
    expect(loaded.exercises.map((e) => e.exerciseId).sort()).toEqual(["bench_press", "incline_bench_press", "lat_pulldown"]);
    const incline = loaded.profiles.find((p) => p.exerciseId === "incline_bench_press");
    expect(incline).toMatchObject({ oneRepMax: 85, initialTM: 76.5, oneRepMaxSource: "ESTIMATE_ACCEPTED", estimateRuleId: "setup-incline-bench-v1" });
    expect(loaded.profiles.find((p) => p.exerciseId === "bench_press")).toMatchObject({ oneRepMaxSource: "DIRECT", estimateRuleId: null, currentTM: 90 });
    expect(loaded.profiles.find((p) => p.exerciseId === "lat_pulldown")).toMatchObject({ t3WorkingWeight: 50, currentTM: null });
    expect(expectOk(await listTMChanges(db, "bench_press"))).toHaveLength(1);
  });

  it("DB를 다시 열어도(새로고침) 설정이 복원된다", async () => {
    expectOk(await saveInitialSetup(db, setupInput(), { clock }));
    db.close();
    const reopened = openSameDatabase(db);
    const loaded = expectOk(await getSavedSetup(reopened));
    reopened.close();
    await db.open();
    expect(loaded.profiles).toHaveLength(3);
  });

  it("저장된 설정이 없으면 빈 목록", async () => {
    expect(expectOk(await getSavedSetup(db))).toEqual({ exercises: [], profiles: [] });
  });

  it("이미 설정이 있으면 SETUP_ALREADY_EXISTS, 기존 값을 덮어쓰지 않는다", async () => {
    expectOk(await saveInitialSetup(db, setupInput(), { clock }));
    const changed = setupInput();
    const result = await saveInitialSetup(
      db,
      { ...changed, profiles: changed.profiles.map((p) => (p.exerciseId === "bench_press" ? { ...p, oneRepMax: kg(150) } : p)) },
      { clock },
    );
    expect(result).toMatchObject({ ok: false, error: "SETUP_ALREADY_EXISTS" });
    expect(expectOk(await getSavedSetup(db)).profiles.find((p) => p.exerciseId === "bench_press")?.oneRepMax).toBe(100);
  });

  it("중간 항목이 검증에 실패하면 앞서 처리한 항목도 저장되지 않는다 (부분 저장 없음)", async () => {
    const input = setupInput();
    const broken: InitialSetupInput = {
      ...input,
      profiles: input.profiles.map((p) => (p.exerciseId === "lat_pulldown" ? { ...p, t3WorkingWeight: kg(-1) } : p)),
    };
    const result = await saveInitialSetup(db, broken, { clock });
    expect(result).toMatchObject({ ok: false, error: "INVALID_WORKING_WEIGHT" });
    expect(await db.exercises.count()).toBe(0);
    expect(await db.exerciseProfiles.count()).toBe(0);
    expect(await db.tmChanges.count()).toBe(0);
  });

  it("마지막 쓰기에서 IndexedDB 오류가 나면 전부 롤백 (STORAGE_ERROR)", async () => {
    let calls = 0;
    db.exerciseProfiles.hook("creating", () => {
      calls += 1;
      if (calls === 3) throw new Error("forced failure on last profile");
      return undefined;
    });
    expect(await saveInitialSetup(db, setupInput(), { clock })).toMatchObject({ ok: false, error: "STORAGE_ERROR" });
    expect(await db.exercises.count()).toBe(0);
    expect(await db.exerciseProfiles.count()).toBe(0);
    expect(await db.tmChanges.count()).toBe(0);
  });

  it("프로필이 없는 운동이나 운동 목록에 없는 프로필은 INVALID_SETUP", async () => {
    const input = setupInput();
    expect(await saveInitialSetup(db, { ...input, profiles: input.profiles.slice(1) }, { clock })).toMatchObject({ ok: false, error: "INVALID_SETUP" });
    expect(await saveInitialSetup(db, { exercises: [], profiles: [] }, { clock })).toMatchObject({ ok: false, error: "INVALID_SETUP" });
    expect(await db.exerciseProfiles.count()).toBe(0);
  });

  it("두 탭에서 동시에 저장해도 하나만 성공한다", async () => {
    const otherTab = openSameDatabase(db);
    const results = await Promise.all([saveInitialSetup(db, setupInput(), { clock }), saveInitialSetup(otherTab, setupInput(), { clock })]);
    otherTab.close();
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "SETUP_ALREADY_EXISTS" });
    expect(await db.tmChanges.count()).toBe(2);
  });
});
