import { describe, expect, it } from "vitest";
import type {
  CompletedSetRecord,
  Exercise,
  ExerciseProfile,
  IncompleteSetRecord,
  SessionExercise,
  SetRecord,
  TMChange,
  WorkoutSession,
} from "@/domain/types/model";

const exercise: Exercise = {
  exerciseId: "barbell_row",
  name: "바벨 로우",
  equipment: "BARBELL",
  weightUnit: "kg",
  increment: 2.5,
  updatedAt: "2026-10-21T00:00:00.000Z",
};

const profile: ExerciseProfile = {
  exerciseId: "barbell_row",
  weightUnit: "kg",
  oneRepMax: 77,
  oneRepMaxSource: "ESTIMATE_ACCEPTED",
  estimateRuleId: "setup-barbell-row-v1",
  initialTM: 69.3,
  currentTM: 69.3,
  t3WorkingWeight: null,
  t3WorkingWeightRevision: 0,
  updatedAt: "2026-10-21T00:00:00.000Z",
};

const session: WorkoutSession = {
  sessionId: "s1",
  scheduledDay: "SATURDAY",
  workoutDate: "2026-10-24",
  status: "IN_PROGRESS",
  startedAt: "2026-10-24T09:00:00.000Z",
  completedAt: null,
  schemaVersion: 1,
};

const sessionExercise: SessionExercise = {
  sessionExerciseId: "s1_t1_barbell_row",
  sessionId: "s1",
  exerciseId: "barbell_row",
  tier: "T1",
  weightUnit: "kg",
  increment: 2.5,
  templateId: null,
  templateVersion: null,
  tmAtSession: 69.3,
  workingWeightAtSession: null,
  workingWeightRevisionAtSession: null,
  displayOrder: 0,
  restSeconds: 180,
  resetCount: 0,
  lastResetAt: null,
  progressionEvaluatedAt: null,
};

const base = {
  setRecordId: "s1_t1_barbell_row#1",
  sessionExerciseId: "s1_t1_barbell_row",
  sessionId: "s1",
  exerciseId: "barbell_row",
  tier: "T1" as const,
  setNumber: 1,
  weightUnit: "kg" as const,
  targetWeight: 50,
  targetReps: 5,
  isAmrap: false,
  manualTargetWeight: null,
};

const incomplete: IncompleteSetRecord = { ...base, completed: false, actualWeight: 50, actualReps: null, completedAt: null };
const completed: CompletedSetRecord = { ...base, completed: true, actualWeight: 50, actualReps: 5, completedAt: "2026-10-24T09:05:00.000Z" };

const tmChange: TMChange = {
  tmChangeId: "c1",
  exerciseId: "barbell_row",
  weightUnit: "kg",
  fromTM: null,
  toTM: 69.3,
  reason: "INITIAL",
  sourceSessionId: null,
  sourceTier: null,
  ruleId: null,
  ruleVersion: null,
  appliedAt: "2026-10-21T00:00:00.000Z",
};

describe("데이터 모델", () => {
  it("모든 엔티티는 JSON 직렬화 후 그대로 복원된다", () => {
    for (const entity of [exercise, profile, session, sessionExercise, incomplete, completed, tmChange]) {
      expect(JSON.parse(JSON.stringify(entity))).toEqual(entity);
    }
  });

  it("Exercise(운동 정보)와 ExerciseProfile(사용자 기준 중량)은 exerciseId로 연결되고 역할이 분리된다", () => {
    expect(profile.exerciseId).toBe(exercise.exerciseId);
    expect(profile.weightUnit).toBe(exercise.weightUnit);
    expect(Object.keys(exercise)).not.toContain("oneRepMax");
    expect(Object.keys(profile)).not.toContain("equipment");
    expect(Object.keys(profile)).not.toContain("increment");
  });

  it("덤벨 운동도 같은 Exercise 구조를 쓰고 표기 기준 필드가 없다 (U-19: 모든 값은 한 손 기준)", () => {
    const dumbbell: Exercise = {
      exerciseId: "dumbbell_lateral_raise",
      name: "덤벨 사이드 레터럴 레이즈",
      equipment: "DUMBBELL",
      weightUnit: "kg",
      increment: 1,
      updatedAt: "2026-10-21T00:00:00.000Z",
    };
    expect(Object.keys(dumbbell).sort()).toEqual(Object.keys(exercise).sort());
    expect(Object.keys(dumbbell)).not.toContain("weightDisplayMode");
  });

  it("필드 이름은 camelCase다", () => {
    for (const entity of [exercise, profile, session, sessionExercise, incomplete, completed, tmChange]) {
      for (const key of Object.keys(entity)) expect(key).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
  });

  it("SetRecord는 completed로 미완료/완료를 구분한다", () => {
    const sets: SetRecord[] = [incomplete, completed];
    const done = sets.filter((set): set is CompletedSetRecord => set.completed);
    expect(done).toHaveLength(1);
    expect(done[0].actualReps).toBe(5);
  });

  it("완료 세트는 타입상 개별 수정할 수 없다 (tsc가 검사, 실제 저장 차단은 STEP 09)", () => {
    // readonly는 컴파일 시점 제약이다. 런타임 객체는 그대로 바뀔 수 있으므로
    // 저장된 기록의 수정 거부는 서비스 계층·Dexie 트랜잭션 테스트(STEP 09)에서 검증한다.
    const attempt = (set: CompletedSetRecord) => {
      // @ts-expect-error 완료 세트의 실제 중량은 readonly
      set.actualWeight = 999;
    };
    expect(typeof attempt).toBe("function");
    // @ts-expect-error 완료 세트는 actualReps가 null일 수 없다
    const invalid: CompletedSetRecord = { ...completed, actualReps: null };
    expect(invalid).toBeDefined();
  });
});
