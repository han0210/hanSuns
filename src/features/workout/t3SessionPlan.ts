/**
 * 하루 운동 세션 계획 (T1·T2·T3).
 *
 * (파일 이름은 STEP 10 Lite의 T3 전용 계획에서 유래했다. 현재는 전체 세션 계획을 만든다.)
 *
 * - T1: Hybrid 자체 T1 템플릿(H-20, 9세트), T2: Hybrid 자체 T2 템플릿(H-21, 8세트). 원본 nSuns 공식 템플릿이 아니다.
 *   목표 중량은 저장 계층이 세션 시작 트랜잭션에서 TM 스냅샷으로 계산한다(roundToIncrement(TM × 비율)).
 * - T3: FST-7 7세트 × 12회 (작업 중량 = 프로필 t3WorkingWeight). 기존 정책 그대로.
 * - T1·T2 자동 TM 증량은 하지 않는다(U-04 등 별도 정책).
 */
import type { Tier, Weekday } from "@/domain/types/model";
import { HYBRID_T1_TEMPLATE, HYBRID_T2_TEMPLATE, type SetTemplate } from "@/domain/templates/hybridTemplates";
import type { SessionExercisePlan, StartSessionInput } from "@/storage/repositories/workoutRepository";
import type { DirectLiftId, EstimatedLiftId, T3ExerciseId } from "@/features/setup-prototype/setupModel";

/** 기본 휴식 시간(초). 사용자 결정: T1·T2·T3 모두 60초. 사용자가 바꾼 값이 우선한다 */
export const REST_DEFAULT_SECONDS: Record<Tier, number> = { T1: 60, T2: 60, T3: 60 };
export const REST_MIN_SECONDS = 15;
export const REST_MAX_SECONDS = 600;

/** 휴식 시간 입력·저장값을 허용 범위의 정수 초로 맞춘다. 숫자가 아니면 기본값 */
export function normalizeRestSeconds(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(REST_MAX_SECONDS, Math.max(REST_MIN_SECONDS, Math.round(n)));
}

type T1T2ExerciseId = DirectLiftId | EstimatedLiftId;

/**
 * 운동일 Day 1~5. 실제 요일과 연동하지 않는다(사용자 결정).
 * weekday는 저장 계층(WorkoutSession.scheduledDay)에 쓰는 내부 키일 뿐이며 화면에는 표시하지 않는다.
 * 기존 저장 데이터와의 호환을 위해 Day 1=MONDAY, 2=TUESDAY, 3=THURSDAY, 4=FRIDAY, 5=SATURDAY 값을 유지한다.
 */
export type TrainingDay = {
  readonly weekday: Weekday;
  /** 화면 표시 이름 (예: "Day 1") */
  readonly label: string;
  readonly t1ExerciseId: T1T2ExerciseId;
  readonly t2ExerciseId: T1T2ExerciseId;
  readonly t3ExerciseId: T3ExerciseId;
};

/** 운동일 구성 (FUNCTIONS 2.1). 이 순서대로 Day 1 → Day 5 → Day 1 반복 */
export const TRAINING_DAYS: readonly TrainingDay[] = [
  { weekday: "MONDAY", label: "Day 1", t1ExerciseId: "bench_press", t2ExerciseId: "ohp", t3ExerciseId: "cable_fly" },
  { weekday: "TUESDAY", label: "Day 2", t1ExerciseId: "deadlift", t2ExerciseId: "front_squat", t3ExerciseId: "leg_curl" },
  { weekday: "THURSDAY", label: "Day 3", t1ExerciseId: "squat", t2ExerciseId: "sumo_deadlift", t3ExerciseId: "leg_extension" },
  { weekday: "FRIDAY", label: "Day 4", t1ExerciseId: "ohp", t2ExerciseId: "incline_bench_press", t3ExerciseId: "dumbbell_lateral_raise" },
  { weekday: "SATURDAY", label: "Day 5", t1ExerciseId: "barbell_row", t2ExerciseId: "barbell_shrug", t3ExerciseId: "lat_pulldown" },
];

/** 화면 안내: 템플릿 출처 */
export const HYBRID_TEMPLATE_NOTICE = "T1·T2는 원본 nSuns에서 착안한 Hybrid 자체 템플릿입니다 (원본 nSuns 공식 템플릿 아님).";

export const TIER_TEMPLATES: Readonly<Record<"T1" | "T2", SetTemplate>> = { T1: HYBRID_T1_TEMPLATE, T2: HYBRID_T2_TEMPLATE };

/** 기기 현지 시각 기준 날짜 (YYYY-MM-DD). toISOString은 UTC라 한국 새벽에 전날이 되므로 쓰지 않는다 */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 저장값(scheduledDay) → 화면 표시 "Day N". 운동일이 아닌 값이면 빈 문자열 */
export const dayLabel = (scheduledDay: Weekday): string => TRAINING_DAYS.find((d) => d.weekday === scheduledDay)?.label ?? "";

/**
 * 다음 운동일: 마지막으로 완료한 세션의 다음 Day (Day 5 다음은 Day 1).
 * 완료 기록이 없거나 알 수 없는 값이면 Day 1. 오늘 날짜·요일은 보지 않는다.
 * @param lastCompletedDay 마지막 완료 세션의 scheduledDay (없으면 null)
 */
export function nextTrainingDay(lastCompletedDay: Weekday | null): TrainingDay {
  const index = TRAINING_DAYS.findIndex((d) => d.weekday === lastCompletedDay);
  return index === -1 ? TRAINING_DAYS[0] : TRAINING_DAYS[(index + 1) % TRAINING_DAYS.length];
}

/** Day의 운동 ID 목록 (T1 → T2 → T3) */
export const dayExerciseIds = (day: TrainingDay): readonly string[] => [day.t1ExerciseId, day.t2ExerciseId, day.t3ExerciseId];

const templatePlan = (exerciseId: string, tier: "T1" | "T2", restSeconds: number): SessionExercisePlan => {
  const template = TIER_TEMPLATES[tier];
  return { exerciseId, tier, templateId: template.templateId, templateVersion: template.templateVersion, restSeconds, template };
};

/**
 * 선택한 Day의 전체 세션 계획: T1(Hybrid T1) → T2(Hybrid T2) → T3(FST-7) 순서.
 * 세트 목표값은 넘기지 않는다. 저장 계층이 세션 시작 TM 스냅샷으로 계산한다.
 * @param restSeconds 티어별 휴식 시간 (사용자 설정 우선, 범위 밖이면 보정)
 */
export function buildSessionPlan(day: TrainingDay, date: Date, restSeconds: Readonly<Record<Tier, number>>): StartSessionInput {
  const rest = (tier: Tier) => normalizeRestSeconds(restSeconds[tier], REST_DEFAULT_SECONDS[tier]);
  return {
    scheduledDay: day.weekday,
    workoutDate: localIsoDate(date),
    exercises: [
      templatePlan(day.t1ExerciseId, "T1", rest("T1")),
      templatePlan(day.t2ExerciseId, "T2", rest("T2")),
      { exerciseId: day.t3ExerciseId, tier: "T3", templateId: null, templateVersion: null, restSeconds: rest("T3") },
    ],
  };
}
