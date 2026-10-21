/**
 * ⚠️ MOCK DATA — 프로토타입 화면 검증 전용
 *
 * - 운동 이름과 요일 구성만 기획 문서(PTS 5.1, 월요일)를 따른다.
 * - T1/T2 세트 수·목표 중량·반복은 임의의 표시용 값이다.
 *   원본 nSuns 템플릿이나 TM 비율에서 계산한 값이 아니며,
 *   계산 엔진·운영 템플릿에서 참조하면 안 된다 (CLAUDE.md 7장, 16장).
 * - T3는 확정 규칙인 7세트 × 12회 구조만 사용한다. 작업 중량은 Mock 값이다.
 */

import type { SessionExercise, SetRecord, WorkoutSession } from "./types";

export const MOCK_LABEL = "MOCK";

/** 휴식 기본값 (PRD FR-006 확정값) */
export const REST_SECONDS = { T1: 180, T2: 120, T3: 30 } as const;

function mockSet(
  setNumber: number,
  targetWeight: number,
  targetReps: number,
  isAmrap = false,
): SetRecord {
  return {
    setNumber,
    targetWeight,
    targetReps,
    isAmrap,
    manualTargetWeight: null,
    actualWeightDraft: "",
    actualRepsDraft: "",
    actualWeight: null,
    actualReps: null,
    completed: false,
    completedAt: null,
  };
}

/** 표시용 Mock 세트 목록. [중량, 반복, AMRAP 여부] */
type MockRow = readonly [number, number, boolean?];

function buildSets(rows: readonly MockRow[]): SetRecord[] {
  return rows.map(([weight, reps, amrap], index) =>
    mockSet(index + 1, weight, reps, amrap ?? false),
  );
}

// T1 벤치프레스 — 9세트 (MOCK, 운영 템플릿 아님)
const MOCK_T1_ROWS: readonly MockRow[] = [
  [60, 5],
  [70, 3],
  [77.5, 1, true],
  [72.5, 3],
  [67.5, 5],
  [62.5, 3],
  [57.5, 5],
  [52.5, 3],
  [47.5, 5, true],
];

// T2 OHP — 8세트 (MOCK, 운영 템플릿 아님)
const MOCK_T2_ROWS: readonly MockRow[] = [
  [30, 6],
  [35, 5],
  [40, 3],
  [42.5, 5],
  [40, 7],
  [37.5, 4],
  [35, 6],
  [32.5, 8],
];

/** T3 FST-7: 7세트 × 12회 (확정 구조). 작업 중량 15kg는 MOCK */
const MOCK_T3_WORKING_WEIGHT = 15;
const FST7_SETS = 7;
const FST7_REPS = 12;

export function createMockMondaySession(): WorkoutSession {
  const exercises: SessionExercise[] = [
    {
      sessionExerciseId: "mock_mon_t1_bench_press",
      exerciseId: "bench_press",
      exerciseName: "벤치프레스",
      tier: "T1",
      tierLabel: "Main Lift",
      restSeconds: REST_SECONDS.T1,
      resetCount: 0,
      lastResetAt: null,
      sets: buildSets(MOCK_T1_ROWS),
    },
    {
      sessionExerciseId: "mock_mon_t2_ohp",
      exerciseId: "ohp",
      exerciseName: "OHP",
      tier: "T2",
      tierLabel: "Secondary Lift",
      restSeconds: REST_SECONDS.T2,
      resetCount: 0,
      lastResetAt: null,
      sets: buildSets(MOCK_T2_ROWS),
    },
    {
      sessionExerciseId: "mock_mon_t3_cable_fly",
      exerciseId: "cable_fly",
      exerciseName: "케이블 플라이",
      tier: "T3",
      tierLabel: "FST-7",
      restSeconds: REST_SECONDS.T3,
      resetCount: 0,
      lastResetAt: null,
      sets: Array.from({ length: FST7_SETS }, (_, index) =>
        mockSet(index + 1, MOCK_T3_WORKING_WEIGHT, FST7_REPS),
      ),
    },
  ];

  return {
    sessionId: "mock_session_monday",
    dayLabel: "MONDAY · 월요일",
    status: "IN_PROGRESS",
    exercises,
  };
}

/**
 * Mock 저장: 실제 IndexedDB에 저장하지 않는다.
 * 지연 후 성공(완료 시각 반환)하거나, shouldFail이면 실패한다.
 * 실제 저장 계층도 완료 시각(completedAt)을 확정해 돌려주는 형태를 가정한다.
 */
export function mockSaveSetCompletion(shouldFail: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) reject(new Error("MOCK_SAVE_FAILED"));
      else resolve(Date.now());
    }, 600);
  });
}
