/**
 * nSuns Hybrid MVP 자체 T1·T2 세트 템플릿 (CALCULATION_RULES H-20·H-21).
 *
 * 원본 nSuns 프로그램에서 착안해 Hybrid가 정한 템플릿이며, 원본 nSuns 공식 템플릿이 아니다.
 * 화면·문서에서 원본 템플릿으로 소개하지 않는다.
 *
 * - 목표 중량 = roundToIncrement(TM × 세트 비율). TM 자체는 반올림하지 않는다(H-03).
 * - AMRAP 세트의 targetReps는 최소 반복이다. 실제 반복은 그 이상(또는 미만)도 그대로 기록한다.
 * - 이 템플릿에는 증량 규칙이 없다. T1 AMRAP 증량(U-04)·T2 증량은 별도 정책이다.
 */
import { roundToIncrement, type RoundingError } from "../calculations/weight";
import { isPositiveFinite } from "../calculations/precision";
import { err, ok, type Mass, type Result } from "../types/weight";

export type TemplateSet = {
  readonly setNumber: number;
  /** TM 대비 비율 */
  readonly intensityRatio: number;
  /** 목표 반복. AMRAP이면 최소 반복 */
  readonly targetReps: number;
  readonly isAmrap: boolean;
};

export type SetTemplate = {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly tier: "T1" | "T2";
  readonly sets: readonly TemplateSet[];
};

const set = (setNumber: number, intensityRatio: number, targetReps: number, isAmrap = false): TemplateSet => ({
  setNumber,
  intensityRatio,
  targetReps,
  isAmrap,
});

/** H-20: Hybrid T1 (9세트, 5·9세트 AMRAP). 모든 Day의 T1에 같은 템플릿을 쓴다 (바벨 로우 포함) */
export const HYBRID_T1_TEMPLATE: SetTemplate = {
  templateId: "hybrid-t1",
  templateVersion: 1,
  tier: "T1",
  sets: [set(1, 0.65, 8), set(2, 0.75, 6), set(3, 0.85, 4), set(4, 0.9, 2), set(5, 0.95, 1, true), set(6, 0.9, 3), set(7, 0.85, 5), set(8, 0.8, 7), set(9, 0.75, 4, true)],
};

/** H-21: Hybrid T2 (8세트, AMRAP 없음). 모든 Day의 T2에 같은 템플릿을 쓴다 (스모 데드리프트 포함) */
export const HYBRID_T2_TEMPLATE: SetTemplate = {
  templateId: "hybrid-t2",
  templateVersion: 1,
  tier: "T2",
  sets: [set(1, 0.5, 5), set(2, 0.6, 5), set(3, 0.7, 3), set(4, 0.7, 5), set(5, 0.7, 7), set(6, 0.7, 4), set(7, 0.7, 6), set(8, 0.7, 8)],
};

export type CalculatedSet = {
  readonly setNumber: number;
  /** 반올림까지 끝난 목표 중량 (TM 단위) */
  readonly targetWeight: number;
  readonly targetReps: number;
  readonly isAmrap: boolean;
};

export type TemplateCalculationError = "INVALID_TM" | Exclude<RoundingError, "INVALID_WEIGHT">;

/**
 * 템플릿과 TM으로 세트별 목표를 계산한다.
 * @param tm 세션 시작 시점 TM (반올림하지 않은 값)
 * @param increment 운동의 증가 단위 (TM과 같은 단위여야 함)
 */
export function calculateTemplateSets(
  template: SetTemplate,
  tm: Mass,
  increment: Mass,
): Result<CalculatedSet[], TemplateCalculationError> {
  if (!isPositiveFinite(tm.value)) return err("INVALID_TM");
  if (tm.unit !== increment.unit) return err("UNIT_MISMATCH");
  if (!isPositiveFinite(increment.value)) return err("INVALID_INCREMENT");

  const result: CalculatedSet[] = [];
  for (const templateSet of template.sets) {
    const rounded = roundToIncrement({ value: tm.value * templateSet.intensityRatio, unit: tm.unit }, increment);
    if (!rounded.ok) return err(rounded.error === "INVALID_WEIGHT" ? "INVALID_TM" : rounded.error);
    result.push({
      setNumber: templateSet.setNumber,
      targetWeight: rounded.value.value,
      targetReps: templateSet.targetReps,
      isAmrap: templateSet.isAmrap,
    });
  }
  return ok(result);
}

/** 템플릿 ID·버전으로 찾기 (저장된 세션의 templateId 해석용) */
export const HYBRID_TEMPLATES: readonly SetTemplate[] = [HYBRID_T1_TEMPLATE, HYBRID_T2_TEMPLATE];
