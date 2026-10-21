/**
 * 중량 입력 문자열을 0보다 큰 숫자로 변환한다.
 * Setup(1RM·작업 중량)과 Workout(목표 중량 수정)에서 같은 검증 규칙을 쓰기 위한 공통 함수.
 *
 * @returns 유효하면 숫자, 빈 값·음수·0·숫자가 아닌 값이면 null
 */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

export function parsePositiveKg(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 표시용 kg 포맷: 내부 값은 유지하고 화면에만 소수 둘째 자리까지 표시 */
export function formatKg(value: number): string {
  return String(Math.round(value * 100) / 100);
}
