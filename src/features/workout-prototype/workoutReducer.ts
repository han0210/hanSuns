/**
 * Workout 프로토타입 화면 상태(useReducer).
 *
 * 세션 데이터, 펼쳐진 Accordion, 세트별 저장 중/오류 상태, 휴식 타이머를
 * 화면 최상위 한곳에서 관리한다. 그래서 Accordion을 바꿔도 타이머가 유지된다.
 * 시간이 필요한 동작은 액션에 now를 넣어 리듀서를 순수하게 유지한다.
 */

import {
  applyExerciseReset,
  applySetCompletion,
  findSet,
  getAutoAdvance,
  toSetKey,
  updateManualTarget,
  updateSetDraft,
} from "./workoutLogic";
import type { SessionStatus, SetFieldErrors, SetKey, Tier, WorkoutSession } from "./types";

export type RestTimerState =
  | { phase: "idle" }
  | {
      phase: "running";
      endAt: number;
      totalSeconds: number;
      tier: Tier;
      sessionExerciseId: string;
    }
  | {
      phase: "paused";
      remainingMs: number;
      totalSeconds: number;
      tier: Tier;
      sessionExerciseId: string;
    };

export type WorkoutState = {
  session: WorkoutSession;
  expandedExerciseId: string | null;
  savingKeys: SetKey[];
  errors: Partial<Record<SetKey, SetFieldErrors>>;
  timer: RestTimerState;
  highlightFinish: boolean;
  /** 자동 전환이 일어날 때마다 증가. 화면이 해당 위치로 스크롤하는 신호로 쓴다 */
  autoAdvanceCount: number;
};

export type WorkoutAction =
  | { type: "TOGGLE_EXPAND"; sessionExerciseId: string }
  | {
      type: "UPDATE_DRAFT";
      sessionExerciseId: string;
      setNumber: number;
      field: "weight" | "reps";
      value: string;
    }
  | {
      type: "UPDATE_MANUAL_TARGET";
      sessionExerciseId: string;
      setNumber: number;
      value: number | null;
    }
  | {
      type: "VALIDATION_FAILED";
      sessionExerciseId: string;
      setNumber: number;
      errors: SetFieldErrors;
    }
  | { type: "SAVE_STARTED"; sessionExerciseId: string; setNumber: number }
  | {
      type: "SAVE_SUCCEEDED";
      sessionExerciseId: string;
      setNumber: number;
      weight: number;
      reps: number;
      now: number;
    }
  | { type: "SAVE_FAILED"; sessionExerciseId: string; setNumber: number; message: string }
  | { type: "RESET_EXERCISE"; sessionExerciseId: string; now: number }
  | { type: "TIMER_PAUSE"; now: number }
  | { type: "TIMER_RESUME"; now: number }
  | { type: "TIMER_ADJUST"; deltaSeconds: number; now: number }
  | { type: "TIMER_SKIP" }
  | { type: "SET_SESSION_STATUS"; status: SessionStatus };

export function createInitialState(session: WorkoutSession): WorkoutState {
  const t1 = session.exercises.find((ex) => ex.tier === "T1");
  return {
    session,
    expandedExerciseId: t1?.sessionExerciseId ?? null,
    savingKeys: [],
    errors: {},
    timer: { phase: "idle" },
    highlightFinish: false,
    autoAdvanceCount: 0,
  };
}

/** 휴식 타이머 남은 시간(ms). running 상태는 now 기준으로 계산한다 */
export function getTimerRemainingMs(timer: RestTimerState, now: number): number {
  if (timer.phase === "running") return Math.max(0, timer.endAt - now);
  if (timer.phase === "paused") return timer.remainingMs;
  return 0;
}

function withoutKey<T>(record: Partial<Record<SetKey, T>>, key: SetKey) {
  const next = { ...record };
  delete next[key];
  return next;
}

export function workoutReducer(state: WorkoutState, action: WorkoutAction): WorkoutState {
  switch (action.type) {
    case "TOGGLE_EXPAND": {
      // 열기/닫기는 기록을 바꾸지 않는다. 한 번에 하나만 펼친다.
      const isOpen = state.expandedExerciseId === action.sessionExerciseId;
      return { ...state, expandedExerciseId: isOpen ? null : action.sessionExerciseId };
    }

    case "UPDATE_DRAFT": {
      const key = toSetKey(action.sessionExerciseId, action.setNumber);
      if (state.savingKeys.includes(key)) return state;
      const current = state.errors[key];
      const errors = current
        ? { ...state.errors, [key]: { ...current, [action.field]: undefined, save: undefined } }
        : state.errors;
      return {
        ...state,
        session: updateSetDraft(
          state.session,
          action.sessionExerciseId,
          action.setNumber,
          action.field,
          action.value,
        ),
        errors,
      };
    }

    case "UPDATE_MANUAL_TARGET": {
      const key = toSetKey(action.sessionExerciseId, action.setNumber);
      if (state.savingKeys.includes(key)) return state;
      return {
        ...state,
        session: updateManualTarget(
          state.session,
          action.sessionExerciseId,
          action.setNumber,
          action.value,
        ),
      };
    }

    case "VALIDATION_FAILED": {
      const key = toSetKey(action.sessionExerciseId, action.setNumber);
      return { ...state, errors: { ...state.errors, [key]: action.errors } };
    }

    case "SAVE_STARTED": {
      const key = toSetKey(action.sessionExerciseId, action.setNumber);
      if (state.savingKeys.includes(key)) return state;
      return {
        ...state,
        savingKeys: [...state.savingKeys, key],
        errors: withoutKey(state.errors, key),
      };
    }

    case "SAVE_FAILED": {
      const key = toSetKey(action.sessionExerciseId, action.setNumber);
      return {
        ...state,
        savingKeys: state.savingKeys.filter((k) => k !== key),
        errors: { ...state.errors, [key]: { save: action.message } },
      };
    }

    case "SAVE_SUCCEEDED": {
      const key = toSetKey(action.sessionExerciseId, action.setNumber);
      const savingKeys = state.savingKeys.filter((k) => k !== key);
      const result = applySetCompletion(
        state.session,
        action.sessionExerciseId,
        action.setNumber,
        action.weight,
        action.reps,
        action.now,
      );
      if (!result.ok) {
        return { ...state, savingKeys, errors: { ...state.errors, [key]: { save: result.reason } } };
      }

      const session = result.session;
      const exercise = findSet(session, action.sessionExerciseId, action.setNumber)?.exercise;
      const hasRemainingSet = exercise?.sets.some((set) => !set.completed) ?? false;

      // 휴식 타이머: 같은 운동에 미완료 세트가 남아 있을 때만 시작 (FUNCTIONS 9.2.1)
      const timer: RestTimerState =
        exercise && hasRemainingSet
          ? {
              phase: "running",
              endAt: action.now + exercise.restSeconds * 1000,
              totalSeconds: exercise.restSeconds,
              tier: exercise.tier,
              sessionExerciseId: exercise.sessionExerciseId,
            }
          : state.timer;

      const advance = getAutoAdvance(session, action.sessionExerciseId, state.expandedExerciseId);
      return {
        ...state,
        session,
        savingKeys,
        timer,
        expandedExerciseId:
          advance.kind === "expand" ? advance.sessionExerciseId : state.expandedExerciseId,
        highlightFinish: advance.kind === "highlightFinish" ? true : state.highlightFinish,
        autoAdvanceCount:
          advance.kind === "none" ? state.autoAdvanceCount : state.autoAdvanceCount + 1,
      };
    }

    case "RESET_EXERCISE": {
      const exercise = state.session.exercises.find(
        (ex) => ex.sessionExerciseId === action.sessionExerciseId,
      );
      if (!exercise) return state;
      const keys = exercise.sets.map((set) => toSetKey(exercise.sessionExerciseId, set.setNumber));
      // 저장 중인 세트가 있으면 리셋하지 않는다 (UI에서도 비활성)
      if (keys.some((key) => state.savingKeys.includes(key))) return state;

      const session = applyExerciseReset(state.session, action.sessionExerciseId, action.now);
      if (session === state.session) return state;

      const errors = keys.reduce((acc, key) => withoutKey(acc, key), state.errors);
      // 리셋한 운동의 휴식 타이머가 돌고 있으면 중지 (FUNCTIONS 9.4)
      const timer =
        state.timer.phase !== "idle" &&
        state.timer.sessionExerciseId === action.sessionExerciseId
          ? ({ phase: "idle" } as const)
          : state.timer;
      return { ...state, session, errors, timer, highlightFinish: false };
    }

    case "TIMER_PAUSE": {
      if (state.timer.phase !== "running") return state;
      const remainingMs = getTimerRemainingMs(state.timer, action.now);
      if (remainingMs <= 0) return state;
      const { totalSeconds, tier, sessionExerciseId } = state.timer;
      return { ...state, timer: { phase: "paused", remainingMs, totalSeconds, tier, sessionExerciseId } };
    }

    case "TIMER_RESUME": {
      if (state.timer.phase !== "paused") return state;
      const { remainingMs, totalSeconds, tier, sessionExerciseId } = state.timer;
      return {
        ...state,
        timer: { phase: "running", endAt: action.now + remainingMs, totalSeconds, tier, sessionExerciseId },
      };
    }

    case "TIMER_ADJUST": {
      const deltaMs = action.deltaSeconds * 1000;
      if (state.timer.phase === "running") {
        const remaining = getTimerRemainingMs(state.timer, action.now);
        if (remaining <= 0) return state; // 종료 후에는 조정하지 않는다
        const endAt = action.now + Math.max(0, remaining + deltaMs);
        return { ...state, timer: { ...state.timer, endAt } };
      }
      if (state.timer.phase === "paused") {
        const remainingMs = Math.max(0, state.timer.remainingMs + deltaMs);
        if (remainingMs === 0) {
          // 일시정지 중 0초가 되면 종료 상태(running + 남은 0)로 표시
          const { totalSeconds, tier, sessionExerciseId } = state.timer;
          return {
            ...state,
            timer: { phase: "running", endAt: action.now, totalSeconds, tier, sessionExerciseId },
          };
        }
        return { ...state, timer: { ...state.timer, remainingMs } };
      }
      return state;
    }

    case "TIMER_SKIP":
      return { ...state, timer: { phase: "idle" } };

    case "SET_SESSION_STATUS":
      return { ...state, session: { ...state.session, status: action.status } };
  }
}
