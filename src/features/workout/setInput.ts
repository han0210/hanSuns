/**
 * 세트 실제 수행값 입력 보조 (중량·반복 +/- 버튼, 초안 저장 변환).
 *
 * - 입력칸 값은 문자열로 다룬다(입력 중인 "60." 같은 형식을 해치지 않기 위해). 버튼은 현재 값에서 한 단계 더하고 뺀다.
 * - 중량·반복은 음수가 될 수 없다(0에서 멈춤). 0kg은 완료 검증에서 거부된다.
 * - 단위 혼용 금지: kg 세트는 2.5kg 단위, lb 세트는 그 운동의 증가 단위(lb)로 움직인다. kg↔lb 변환은 하지 않는다.
 */
import type { WeightUnit } from "@/domain/types/weight";

export const WEIGHT_STEP_KG = 2.5;
export const REPS_STEP = 1;

/** 세트 단위에 맞는 중량 버튼 단계. kg는 2.5kg 고정, lb는 운동 증가 단위(세션 스냅샷) */
export const weightStepFor = (unit: WeightUnit, increment: number): number => (unit === "kg" ? WEIGHT_STEP_KG : increment);

const DECIMAL = /^\d+(\.\d+)?$/;
const INTEGER = /^\d+$/;

/** 표시용 숫자 문자열 (부동소수점 잡음 제거) */
const toText = (value: number) => String(Number(value.toPrecision(12)));

/**
 * 중량 +/- : 현재 입력이 숫자가 아니면 목표 중량에서 시작한다. 결과는 0 이상.
 * @param text 현재 입력값
 * @param delta +단계 또는 -단계
 * @param fallback 목표 중량
 */
export function stepWeight(text: string, delta: number, fallback: number): string {
  const trimmed = text.trim();
  const current = DECIMAL.test(trimmed) ? Number(trimmed) : fallback;
  return toText(Math.max(0, current + delta));
}

/** 반복 +/- : 정수가 아니면 목표 반복에서 시작한다. 결과는 0 이상의 정수 */
export function stepReps(text: string, delta: number, fallback: number): string {
  const trimmed = text.trim();
  const current = INTEGER.test(trimmed) ? Number(trimmed) : fallback;
  return String(Math.max(0, Math.round(current + delta)));
}

/**
 * 미완료 세트 입력값 → 저장 계층 updateSetDraft 입력.
 * 유효하지 않거나 빈 값은 null(저장된 초안을 지움 → 다음 복원 때 목표값으로 다시 채워짐).
 * 단위는 세트의 단위를 그대로 붙인다.
 */
export function draftToSave(
  weightText: string,
  repsText: string,
  unit: WeightUnit,
): { actualWeight: { value: number; unit: WeightUnit } | null; actualReps: number | null } {
  const w = weightText.trim();
  const r = repsText.trim();
  const weight = DECIMAL.test(w) && Number(w) > 0 ? Number(w) : null;
  const reps = INTEGER.test(r) ? Number(r) : null;
  return { actualWeight: weight === null ? null : { value: weight, unit }, actualReps: reps };
}
