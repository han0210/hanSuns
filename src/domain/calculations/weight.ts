/**
 * 중량 입력 검증과 증가 단위 반올림 (CALCULATION_RULES 4장).
 */
import { err, ok, type Mass, type Result } from "../types/weight";
import { isPositiveFinite, removeFloatNoise } from "./precision";

export type WeightInputError = "EMPTY" | "NOT_A_NUMBER" | "NOT_FINITE" | "NON_POSITIVE";

/** 화면 입력 문자열 형식: 부호 없는 십진수 (음수는 NON_POSITIVE로 구분하기 위해 '-'만 허용) */
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * 사용자 입력 중량(문자열 또는 숫자)을 검증한다. 단위 변환은 하지 않는다.
 * @returns 0보다 큰 유한한 숫자 / 오류 코드
 */
export function validateWeightInput(input: unknown): Result<number, WeightInputError> {
  if (input === null || input === undefined) return err("EMPTY");

  if (typeof input === "string") {
    const text = input.trim();
    if (text === "") return err("EMPTY");
    if (!DECIMAL_TEXT.test(text)) return err("NOT_A_NUMBER");
    const value = Number(text);
    return value > 0 ? ok(value) : err("NON_POSITIVE");
  }

  if (typeof input === "number") {
    if (Number.isNaN(input)) return err("NOT_A_NUMBER");
    if (!Number.isFinite(input)) return err("NOT_FINITE");
    return input > 0 ? ok(input) : err("NON_POSITIVE");
  }

  return err("NOT_A_NUMBER");
}

export type RoundingError = "INVALID_WEIGHT" | "INVALID_INCREMENT" | "UNIT_MISMATCH" | "NON_POSITIVE_RESULT";

/**
 * 최종 세트 목표 중량을 증가 단위의 가장 가까운 배수로 반올림한다.
 * - 정확한 중간값은 높은 쪽 (H-12, 예: 61.25 / 2.5 → 62.5)
 * - 부동소수점 오차로 중간값이 내림되지 않도록 몫의 잡음을 먼저 제거한다
 * - weight와 increment의 단위가 다르면 UNIT_MISMATCH (자동 변환 없음)
 * - TM 등 내부 값에는 쓰지 않는다 (H-03)
 */
export function roundToIncrement(weight: Mass, increment: Mass): Result<Mass, RoundingError> {
  if (weight.unit !== increment.unit) return err("UNIT_MISMATCH");
  if (!isPositiveFinite(increment.value)) return err("INVALID_INCREMENT");
  if (!isPositiveFinite(weight.value)) return err("INVALID_WEIGHT");

  const steps = Math.floor(removeFloatNoise(weight.value / increment.value) + 0.5);
  const value = removeFloatNoise(steps * increment.value);
  if (value <= 0) return err("NON_POSITIVE_RESULT");
  return ok({ value, unit: weight.unit });
}
