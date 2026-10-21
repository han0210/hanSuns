import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NsunsDatabase } from "@/storage/db";
import { DATABASE_NAME, getBrowserDatabase, SCHEMA, SCHEMA_VERSION } from "@/storage/db";
import { createTestDatabase, destroyDatabase } from "./helpers";

describe("NsunsDatabase 스키마", () => {
  let db: NsunsDatabase;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(async () => {
    await destroyDatabase(db);
  });

  it("버전 1, 6개 테이블과 기본 키·유일 인덱스를 정의한다", async () => {
    await db.open();
    expect(SCHEMA_VERSION).toBe(1);
    expect(db.verno).toBe(1);
    expect(db.tables.map((t) => t.name).sort()).toEqual(["exerciseProfiles", "exercises", "sessionExercises", "setRecords", "tmChanges", "workoutSessions"]);
    expect(db.sessionExercises.schema.primKey.name).toBe("sessionExerciseId");
    const unique = (name: keyof typeof SCHEMA) => db.table(name).schema.indexes.filter((i) => i.unique).map((i) => i.name);
    expect(unique("sessionExercises")).toEqual(["[sessionId+exerciseId+tier]", "[sessionId+displayOrder]"]);
    expect(unique("setRecords")).toEqual(["[sessionExerciseId+setNumber]"]);
    expect(unique("tmChanges")).toEqual(["[sourceSessionId+exerciseId+sourceTier]"]);
  });

  it("같은 세트 번호를 두 번 넣으면 유일 인덱스가 거부한다", async () => {
    const base = {
      sessionExerciseId: "s:T3:x", sessionId: "s", exerciseId: "x", tier: "T3", setNumber: 1, weightUnit: "kg",
      targetWeight: 50, targetReps: 12, isAmrap: false, manualTargetWeight: null, completed: false, actualWeight: null, actualReps: null, completedAt: null,
    } as const;
    await db.setRecords.add({ ...base, setRecordId: "a" });
    await expect(db.setRecords.add({ ...base, setRecordId: "b" })).rejects.toMatchObject({ name: "ConstraintError" });
  });
});

describe("getBrowserDatabase (SSR 안전성)", () => {
  it("window가 없는 환경(서버 렌더링·빌드·Node)에서는 null을 돌려주고 DB를 열지 않는다", () => {
    expect(typeof window).toBe("undefined");
    expect(getBrowserDatabase()).toBeNull();
    expect(DATABASE_NAME).toBe("nsuns-hybrid");
  });
});
