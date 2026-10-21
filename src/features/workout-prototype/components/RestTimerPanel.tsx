"use client";

import type { RestTimerState } from "../workoutReducer";

type RestTimerPanelProps = {
  timer: RestTimerState;
  remainingMs: number;
  exerciseName: string | null;
  onPause: () => void;
  onResume: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
};

const formatTime = (ms: number) => {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * 화면 하단 고정 Compact Timer Panel.
 * 상태는 상위에서 관리하며, 이 컴포넌트는 표시와 조작 버튼만 담당한다.
 */
export function RestTimerPanel({
  timer,
  remainingMs,
  exerciseName,
  onPause,
  onResume,
  onAdjust,
  onSkip,
}: RestTimerPanelProps) {
  const isIdle = timer.phase === "idle";
  const isFinished = timer.phase === "running" && remainingMs <= 0;
  const isRunning = timer.phase === "running" && !isFinished;
  const isPaused = timer.phase === "paused";
  const canAdjust = isRunning || isPaused;

  const statusText = isIdle
    ? "대기 중"
    : isFinished
      ? "휴식 종료"
      : isPaused
        ? "일시정지"
        : `${timer.phase === "running" ? timer.tier : ""} 휴식 중`;

  const buttonBase =
    "flex h-11 min-w-11 items-center justify-center rounded-xl border border-line px-2 text-sm font-medium disabled:opacity-35";

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-20 border-t bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${
        isFinished ? "border-accent" : "border-line"
      }`}
    >
      <div
        role="timer"
        aria-label="휴식 타이머"
        className="mx-auto flex max-w-[480px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2"
      >
        <div className="min-w-0 max-w-[45%] flex-1 basis-20">
          <p className="truncate text-[10px] font-bold tracking-[0.15em] text-fg-secondary">
            REST TIMER
            <span className="ml-2 font-medium tracking-normal">
              {statusText}
              {!isIdle && exerciseName ? ` · ${exerciseName}` : ""}
            </span>
          </p>
          <p
            className={`text-[26px] font-bold leading-tight tabular-nums ${
              isFinished ? "text-accent" : isIdle ? "text-fg-muted" : "text-fg"
            }`}
          >
            {isIdle ? "--:--" : formatTime(remainingMs)}
          </p>
        </div>

        <div className="flex gap-1.5">
          <button type="button" className={buttonBase} disabled={!canAdjust} onClick={() => onAdjust(-15)} aria-label="휴식 15초 줄이기">
            −15
          </button>
          {isPaused ? (
            <button type="button" className={buttonBase} onClick={onResume} aria-label="휴식 타이머 재개">
              ▶
            </button>
          ) : (
            <button type="button" className={buttonBase} disabled={!isRunning} onClick={onPause} aria-label="휴식 타이머 일시정지">
              ❚❚
            </button>
          )}
          <button type="button" className={buttonBase} disabled={!canAdjust} onClick={() => onAdjust(15)} aria-label="휴식 15초 늘리기">
            +15
          </button>
          <button
            type="button"
            className={`${buttonBase} ${isFinished ? "border-accent bg-accent text-on-accent" : ""}`}
            disabled={isIdle}
            onClick={onSkip}
            aria-label={isFinished ? "휴식 타이머 닫기" : "휴식 건너뛰기"}
          >
            {isFinished ? "닫기" : "건너뛰기"}
          </button>
        </div>
      </div>
      <p aria-live="assertive" className="sr-only">
        {isFinished ? "휴식이 끝났습니다" : ""}
      </p>
    </div>
  );
}
