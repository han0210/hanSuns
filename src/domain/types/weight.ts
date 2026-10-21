/**
 * 중량 단위와 결과 타입.
 *
 * 중량 값은 항상 단위와 함께 다룬다(Mass). kg/lb 사이의 자동 변환은 하지 않으며,
 * 단위가 다른 값끼리 계산하면 계산 함수가 UNIT_MISMATCH 오류를 돌려준다.
 */

export type WeightUnit = "kg" | "lb";

/** 단위가 붙은 중량. JSON으로 그대로 직렬화할 수 있다. */
export type Mass = {
  readonly value: number;
  readonly unit: WeightUnit;
};

export const kg = (value: number): Mass => ({ value, unit: "kg" });
export const lb = (value: number): Mass => ({ value, unit: "lb" });

/** 예외 대신 반환하는 결과 타입. 오류 코드는 CALCULATION_RULES.md의 코드와 맞춘다. */
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E extends string>(error: E): { ok: false; error: E } => ({ ok: false, error });
