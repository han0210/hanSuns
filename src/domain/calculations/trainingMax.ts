/**
 * 초기 Training Max (CALCULATION_RULES 3.1, H-01).
 */
import { err, ok, type Mass, type Result } from "../types/weight";
import { isPositiveFinite } from "./precision";

export const INITIAL_TM_RATIO = 0.9;

export type TrainingMaxError = "MISSING_1RM" | "INVALID_1RM";

/**
 * initialTM = 1RM × 0.9. 내부 정밀도를 유지하기 위해 반올림하지 않으며 단위를 그대로 둔다.
 * @param oneRepMax 1RM (미입력이면 null)
 */
export function calculateTM(oneRepMax: Mass | null | undefined): Result<Mass, TrainingMaxError> {
  if (!oneRepMax) return err("MISSING_1RM");
  if (!isPositiveFinite(oneRepMax.value)) return err("INVALID_1RM");
  return ok({ value: oneRepMax.value * INITIAL_TM_RATIO, unit: oneRepMax.unit });
}
