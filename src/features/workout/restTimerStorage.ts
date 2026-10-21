/**
 * 휴식 타이머·휴식 시간 설정의 기기 저장 (localStorage).
 *
 * 운동 기록이 아니라 화면 편의 상태이므로 IndexedDB가 아닌 localStorage에 둔다.
 * 사생활 보호 모드 등에서 localStorage 접근이 실패해도 앱이 동작하도록 모든 접근을 try/catch로 감싼다.
 * 타이머는 종료 예정 시각(endAt)을 저장하므로, 새로고침 후에도 남은 시간을 다시 계산할 수 있다.
 */
import type { Tier } from "@/domain/types/model";
import type { RestTimerState } from "@/features/workout-prototype/workoutReducer";
import { normalizeRestSeconds, REST_DEFAULT_SECONDS } from "./t3SessionPlan";

const TIMER_KEY = "nsuns-hybrid.restTimer.v1";
const restKey = (tier: Tier) => `nsuns-hybrid.restSeconds.${tier}.v1`;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 사용자가 정한 휴식 시간. 없거나 잘못된 값이면 기본값 */
export function loadRestSeconds(tier: Tier, storage: Storage | null = safeStorage()): number {
  try {
    return normalizeRestSeconds(storage?.getItem(restKey(tier)) ?? undefined, REST_DEFAULT_SECONDS[tier]);
  } catch {
    return REST_DEFAULT_SECONDS[tier];
  }
}

export function saveRestSeconds(tier: Tier, seconds: number, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(restKey(tier), String(normalizeRestSeconds(seconds, REST_DEFAULT_SECONDS[tier])));
  } catch {
    // 저장하지 못해도 이번 화면에서는 선택값을 그대로 쓴다
  }
}

type PersistedTimer = { readonly sessionId: string; readonly timer: RestTimerState };

export function saveTimer(sessionId: string, timer: RestTimerState, storage: Storage | null = safeStorage()): void {
  try {
    if (timer.phase === "idle") storage?.removeItem(TIMER_KEY);
    else storage?.setItem(TIMER_KEY, JSON.stringify({ sessionId, timer } satisfies PersistedTimer));
  } catch {
    // 무시: 타이머 복원은 편의 기능
  }
}

const isTier = (value: unknown): value is Tier => value === "T1" || value === "T2" || value === "T3";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * 저장된 타이머를 읽는다. 다른 세션의 타이머이거나 형식이 잘못됐거나 이미 끝난 지 오래면 idle.
 * @param now 현재 시각(ms). 종료 후 1분이 지난 타이머는 복원하지 않는다
 */
export function loadTimer(sessionId: string, now: number, storage: Storage | null = safeStorage()): RestTimerState {
  try {
    const raw = storage?.getItem(TIMER_KEY);
    if (!raw) return { phase: "idle" };
    const parsed = JSON.parse(raw) as Partial<PersistedTimer>;
    const timer = parsed.timer as Record<string, unknown> | undefined;
    if (parsed.sessionId !== sessionId || !timer) return { phase: "idle" };
    const base = timer.tier;
    if (!isTier(base) || typeof timer.sessionExerciseId !== "string" || !isFiniteNumber(timer.totalSeconds)) return { phase: "idle" };
    if (timer.phase === "running" && isFiniteNumber(timer.endAt)) {
      if (now - timer.endAt > 60_000) return { phase: "idle" };
      return { phase: "running", endAt: timer.endAt, totalSeconds: timer.totalSeconds, tier: base, sessionExerciseId: timer.sessionExerciseId };
    }
    if (timer.phase === "paused" && isFiniteNumber(timer.remainingMs) && timer.remainingMs > 0) {
      return { phase: "paused", remainingMs: timer.remainingMs, totalSeconds: timer.totalSeconds, tier: base, sessionExerciseId: timer.sessionExerciseId };
    }
    return { phase: "idle" };
  } catch {
    return { phase: "idle" };
  }
}
