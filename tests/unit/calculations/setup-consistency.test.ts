import { describe, expect, it } from "vitest";
import { calculateTM } from "@/domain/calculations/trainingMax";
import { resolveInitialOneRepMaxes } from "@/domain/calculations/initialOneRepMax";
import { kg } from "@/domain/types/weight";
import {
  createInitialSetupState,
  ESTIMATE_RULES,
  ESTIMATED_LIFT_IDS,
  getEffective1RM,
  initialTM,
  setupReducer,
  type SetupAction,
} from "@/features/setup-prototype/setupModel";

/** STEP 07 Setup 프로토타입 계산과 도메인 계산 결과가 같은지 확인한다 */
describe("기존 Setup 프로토타입과 결과 일치", () => {
  const scenarios: { name: string; direct: [number, number, number, number]; actions: SetupAction[] }[] = [
    { name: "기본 입력", direct: [100, 140, 120, 62.5], actions: [] },
    { name: "소수 입력", direct: [92.5, 187.5, 142.5, 57.5], actions: [] },
    {
      name: "로우 수정 + 프론트 스쿼트 확정",
      direct: [100, 140, 120, 62.5],
      actions: [
        { type: "EDIT_ESTIMATED", id: "barbell_row", text: "90" },
        { type: "ACCEPT_ESTIMATE", id: "front_squat" },
      ],
    },
  ];

  it("추천 비율과 규칙 ID가 같다", async () => {
    const { INITIAL_1RM_ESTIMATE_RULES } = await import("@/domain/calculations/initialOneRepMax");
    for (const id of ESTIMATED_LIFT_IDS) {
      expect(INITIAL_1RM_ESTIMATE_RULES[id].ratio).toBe(ESTIMATE_RULES[id].ratio);
      expect(INITIAL_1RM_ESTIMATE_RULES[id].baseExerciseId).toBe(ESTIMATE_RULES[id].baseId);
      expect(INITIAL_1RM_ESTIMATE_RULES[id].ruleId).toBe(ESTIMATE_RULES[id].ruleId);
    }
  });

  for (const scenario of scenarios) {
    it(`${scenario.name}: 1RM·TM 일치`, () => {
      const [bench, dead, squat, ohp] = scenario.direct;
      const setup = [
        { type: "SET_DIRECT", id: "bench_press", text: String(bench) },
        { type: "SET_DIRECT", id: "deadlift", text: String(dead) },
        { type: "SET_DIRECT", id: "squat", text: String(squat) },
        { type: "SET_DIRECT", id: "ohp", text: String(ohp) },
        ...scenario.actions,
      ] as SetupAction[];
      const state = setup.reduce(setupReducer, createInitialSetupState());

      const overrides = Object.fromEntries(
        ESTIMATED_LIFT_IDS.flatMap((id) => {
          const entry = state.estimated[id];
          if (entry.source === "ESTIMATE") return [];
          return [[id, { oneRepMax: kg(Number(entry.text)), source: entry.source === "EDITED" ? "USER_EDITED" : "ESTIMATE_ACCEPTED" }]];
        }),
      );
      const domain = resolveInitialOneRepMaxes({
        direct: { bench_press: kg(bench), deadlift: kg(dead), squat: kg(squat), ohp: kg(ohp) },
        overrides,
      });
      if (!domain.ok) throw new Error(domain.error);

      for (const id of [...ESTIMATED_LIFT_IDS, "bench_press", "deadlift", "squat", "ohp"] as const) {
        const prototypeValue = getEffective1RM(state, id);
        expect(prototypeValue).not.toBeNull();
        expect(domain.value[id].oneRepMax.value).toBeCloseTo(prototypeValue!, 9);
        const tm = calculateTM(domain.value[id].oneRepMax);
        if (!tm.ok) throw new Error(tm.error);
        expect(tm.value.value).toBeCloseTo(initialTM(prototypeValue!), 9);
      }
    });
  }
});
