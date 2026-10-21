/**
 * T3 전용 기록 세션 계획 (STEP 10 Lite).
 *
 * T1·T2는 원본 nSuns 템플릿(세트 수·반복·TM 비율)이 검증되지 않아(U-01·U-02·U-08·U-18) 목표 세트를 만들 수 없다.
 * 테스트 FIXTURE나 추측한 비율을 실제 운동에 쓰지 않기 위해, 이번 단계의 실제 기록은 확정 규칙인
 * T3 FST-7(7세트 × 12회, 작업 중량 = 프로필 t3WorkingWeight)만 만든다.
 * 이 세션은 완전한 nSuns 프로그램이 아니다. 화면에도 그렇게 표시한다.
 */
import type { Tier, Weekday } from "@/domain/types/model";
import type { StartSessionInput } from "@/storage/repositories/workoutRepository";
import type { T3ExerciseId } from "@/features/setup-prototype/setupModel";

/** 기본 휴식 시간(초). 사용자 결정(STEP 10): T1·T2 60초, T3 30초. 사용자가 바꿀 수 있다 */
export const REST_DEFAULT_SECONDS: Record<Tier, number> = { T1: 60, T2: 60, T3: 30 };
export const REST_MIN_SECONDS = 15;
export const REST_MAX_SECONDS = 600;

/** 휴식 시간 입력·저장값을 허용 범위의 정수 초로 맞춘다. 숫자가 아니면 기본값 */
export function normalizeRestSeconds(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(REST_MAX_SECONDS, Math.max(REST_MIN_SECONDS, Math.round(n)));
}

export type TrainingDay = {
  readonly weekday: Weekday;
  readonly label: string;
  /** 표시 전용. 기록·계산하지 않는다 */
  readonly t1Name: string;
  readonly t2Name: string;
  readonly t3ExerciseId: T3ExerciseId;
};

/** 주간 일정 (FUNCTIONS 2.1). 수·일은 휴식 */
export const TRAINING_DAYS: readonly TrainingDay[] = [
  { weekday: "MONDAY", label: "월", t1Name: "벤치프레스", t2Name: "OHP", t3ExerciseId: "cable_fly" },
  { weekday: "TUESDAY", label: "화", t1Name: "데드리프트", t2Name: "프론트 스쿼트", t3ExerciseId: "leg_curl" },
  { weekday: "THURSDAY", label: "목", t1Name: "스쿼트", t2Name: "스모 데드리프트", t3ExerciseId: "leg_extension" },
  { weekday: "FRIDAY", label: "금", t1Name: "OHP", t2Name: "인클라인 벤치프레스", t3ExerciseId: "dumbbell_lateral_raise" },
  { weekday: "SATURDAY", label: "토", t1Name: "바벨 로우", t2Name: "슈러그", t3ExerciseId: "lat_pulldown" },
];

/** T1·T2를 기록할 수 없는 이유 (화면 안내용) */
export const T1_T2_DISABLED_REASON = "원본 nSuns 세트 템플릿 검증 전이라 기록할 수 없습니다 (U-01·U-02·U-08·U-18).";

const WEEKDAYS: readonly Weekday[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** 기기 현지 시각 기준 요일 */
export const weekdayOf = (date: Date): Weekday => WEEKDAYS[date.getDay()];

/** 기기 현지 시각 기준 날짜 (YYYY-MM-DD). toISOString은 UTC라 한국 새벽에 전날이 되므로 쓰지 않는다 */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 오늘이 운동일이면 그 요일, 휴식일이면 월요일을 기본 선택으로 */
export function defaultTrainingDay(date: Date): TrainingDay {
  const today = weekdayOf(date);
  return TRAINING_DAYS.find((day) => day.weekday === today) ?? TRAINING_DAYS[0];
}

/**
 * 선택한 요일의 T3 운동 하나만 담은 세션 계획.
 * sets를 넘기지 않으므로 저장 계층이 FST-7(7×12, 프로필 작업 중량)을 생성한다. T1·T2는 넣지 않는다.
 */
export function buildT3SessionPlan(day: TrainingDay, date: Date, restSeconds: number): StartSessionInput {
  return {
    scheduledDay: day.weekday,
    workoutDate: localIsoDate(date),
    exercises: [
      {
        exerciseId: day.t3ExerciseId,
        tier: "T3",
        templateId: null,
        templateVersion: null,
        restSeconds: normalizeRestSeconds(restSeconds, REST_DEFAULT_SECONDS.T3),
      },
    ],
  };
}
