/**
 * 부동소수점 잡음 제거 (예: 0.30000000000000004 → 0.3, 61.24999999999999 → 61.25).
 * 유효숫자 12자리로 정리할 뿐 값 자체를 증가 단위로 반올림하지 않는다.
 * kg·lb 중량 범위(최대 수천)에서 소수 셋째 자리 이하 정밀도에 영향이 없다.
 */
export const removeFloatNoise = (value: number): number => Number(value.toPrecision(12));

export const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;
