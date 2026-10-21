"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { createMockMondaySession, mockSaveSetCompletion, MOCK_LABEL } from "../mockWorkout";
import { findSet, getSessionProgress, validateSetCompletion } from "../workoutLogic";
import { createInitialState, getTimerRemainingMs, workoutReducer } from "../workoutReducer";
import type { SessionStatus } from "../types";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { ExerciseAccordion } from "./ExerciseAccordion";
import { RestTimerPanel } from "./RestTimerPanel";

const STATUS_LABEL: Record<SessionStatus, string> = {
  NOT_STARTED: "시작 전",
  IN_PROGRESS: "진행 중",
  PAUSED: "일시 중단",
  COMPLETED: "완료",
  ABANDONED: "중도 종료",
};

type DialogState =
  | { kind: "none" }
  | { kind: "reset"; sessionExerciseId: string }
  | { kind: "finish" }
  | { kind: "finished" };

/**
 * Workout 화면 프로토타입의 최상위 컴포넌트.
 *
 * - 세션·Accordion·저장 상태·휴식 타이머를 useReducer 하나로 관리한다.
 * - 세트 체크: 입력 검증 → Mock 저장(지연) → 성공 시에만 완료·잠금 → 타이머·자동 전환.
 * - 실제 IndexedDB 저장, 계산 엔진, 증량 판정은 연결하지 않는다.
 */
export function WorkoutPrototype() {
  const [state, dispatch] = useReducer(workoutReducer, undefined, () =>
    createInitialState(createMockMondaySession()),
  );
  const [now, setNow] = useState(0);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [failNextSave, setFailNextSave] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const finishRef = useRef<HTMLDivElement>(null);

  const { session, timer } = state;
  const isTimerRunning = timer.phase === "running";

  // 타이머 표시 갱신: 실제 경과 시간(endAt - now)으로 계산하고 interval은 화면 갱신에만 쓴다.
  useEffect(() => {
    if (!isTimerRunning) return;
    const tick = () => setNow(Date.now());
    const intervalId = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isTimerRunning]);

  // 자동 전환 시 해당 운동 또는 세션 완료 영역으로 스크롤
  useEffect(() => {
    if (state.autoAdvanceCount === 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
    if (state.highlightFinish) {
      finishRef.current?.scrollIntoView({ behavior, block: "center" });
    } else if (state.expandedExerciseId) {
      document
        .getElementById(`exercise-${state.expandedExerciseId}`)
        ?.scrollIntoView({ behavior, block: "start" });
    }
    // autoAdvanceCount가 바뀔 때만 실행한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.autoAdvanceCount]);

  const progress = getSessionProgress(session);
  const progressPercent = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  const remainingMs = getTimerRemainingMs(timer, now);
  const timerExerciseName =
    timer.phase === "idle"
      ? null
      : (session.exercises.find((ex) => ex.sessionExerciseId === timer.sessionExerciseId)?.exerciseName ?? null);

  async function handleCompleteSet(sessionExerciseId: string, setNumber: number) {
    const found = findSet(session, sessionExerciseId, setNumber);
    if (!found || found.set.completed) return;

    const validation = validateSetCompletion(found.set.actualWeightDraft, found.set.actualRepsDraft);
    if (!validation.ok) {
      dispatch({ type: "VALIDATION_FAILED", sessionExerciseId, setNumber, errors: validation.errors });
      return;
    }

    dispatch({ type: "SAVE_STARTED", sessionExerciseId, setNumber });
    const shouldFail = failNextSave;
    if (shouldFail) setFailNextSave(false); // 실패 시나리오는 한 번만 적용

    try {
      const completedAt = await mockSaveSetCompletion(shouldFail);
      setNow(completedAt);
      dispatch({
        type: "SAVE_SUCCEEDED",
        sessionExerciseId,
        setNumber,
        weight: validation.weight,
        reps: validation.reps,
        now: completedAt,
      });
      setStatusMessage(`${found.exercise.exerciseName} ${setNumber}세트 완료 처리됨 (Mock, 실제 저장 안 됨)`);
    } catch {
      dispatch({
        type: "SAVE_FAILED",
        sessionExerciseId,
        setNumber,
        message: "저장에 실패해 완료되지 않았습니다. 입력값은 유지됩니다. 다시 체크해 주세요. (Mock 오류)",
      });
      setStatusMessage(`${found.exercise.exerciseName} ${setNumber}세트 저장 실패`);
    }
  }

  const resetTarget =
    dialog.kind === "reset"
      ? session.exercises.find((ex) => ex.sessionExerciseId === dialog.sessionExerciseId)
      : undefined;

  const incompleteCount = progress.total - progress.completed;

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-44 pt-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-fg-secondary">{session.dayLabel}</p>
          <h1 className="text-2xl font-bold">오늘의 운동</h1>
        </div>
        <span className="mt-1 shrink-0 rounded-full border border-line px-3 py-1 text-xs">
          세션 · {STATUS_LABEL[session.status]}
        </span>
      </header>

      <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
        <strong className="font-bold">{MOCK_LABEL} 프로토타입</strong> · 세트 수와 중량은 표시용 예시이며 실제
        nSuns 템플릿·계산값이 아닙니다. 기록은 저장되지 않습니다.
      </p>

      <section aria-label="전체 운동 진행 상황" className="mt-4 rounded-2xl bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">전체 진행률</h2>
          <p className="text-sm tabular-nums">
            <span className="font-semibold">{progress.completed}</span>
            <span className="text-fg-secondary"> / {progress.total} 세트 · {progressPercent}%</span>
          </p>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-label="전체 세트 진행률"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
        >
          <div className="h-full rounded-full bg-accent motion-safe:transition-[width]" style={{ width: `${progressPercent}%` }} />
        </div>
        <ul className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          {session.exercises.map((exercise) => {
            const done = exercise.sets.filter((set) => set.completed).length;
            const complete = done === exercise.sets.length;
            return (
              <li key={exercise.sessionExerciseId} className="rounded-lg bg-elevated px-1 py-2">
                <span className="block font-bold">{exercise.tier}</span>
                <span className={`tabular-nums ${complete ? "font-semibold text-accent" : "text-fg-secondary"}`}>
                  {complete ? "✓ " : ""}
                  {done}/{exercise.sets.length}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-4 space-y-3">
        {session.exercises.map((exercise) => (
          <ExerciseAccordion
            key={exercise.sessionExerciseId}
            exercise={exercise}
            sessionStatus={session.status}
            expanded={state.expandedExerciseId === exercise.sessionExerciseId}
            savingKeys={state.savingKeys}
            errors={state.errors}
            onToggle={() => dispatch({ type: "TOGGLE_EXPAND", sessionExerciseId: exercise.sessionExerciseId })}
            onDraftChange={(setNumber, field, value) =>
              dispatch({ type: "UPDATE_DRAFT", sessionExerciseId: exercise.sessionExerciseId, setNumber, field, value })
            }
            onManualTargetChange={(setNumber, value) =>
              dispatch({ type: "UPDATE_MANUAL_TARGET", sessionExerciseId: exercise.sessionExerciseId, setNumber, value })
            }
            onCompleteSet={(setNumber) => void handleCompleteSet(exercise.sessionExerciseId, setNumber)}
            onRequestReset={() => setDialog({ kind: "reset", sessionExerciseId: exercise.sessionExerciseId })}
          />
        ))}
      </div>

      <div
        ref={finishRef}
        className={`mt-6 rounded-2xl p-1 ${state.highlightFinish && session.status === "IN_PROGRESS" ? "ring-2 ring-accent" : ""}`}
      >
        {state.highlightFinish && session.status === "IN_PROGRESS" && (
          <p className="px-2 pb-2 pt-1 text-center text-sm text-accent">T3까지 완료했습니다. 오늘 운동을 마무리하세요.</p>
        )}
        <button
          type="button"
          disabled={session.status !== "IN_PROGRESS"}
          onClick={() => setDialog({ kind: "finish" })}
          className="min-h-12 w-full rounded-xl bg-accent px-4 text-base font-bold text-on-accent hover:brightness-110 disabled:bg-elevated disabled:text-fg-muted"
        >
          {session.status === "COMPLETED" ? "세션 완료됨 (Mock)" : "오늘 운동 완료"}
        </button>
      </div>

      <details className="mt-6 rounded-xl border border-dashed border-line p-3 text-xs text-fg-secondary">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">프로토타입 검증 도구 (사용자 기능 아님)</summary>
        <div className="mt-2 space-y-3">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={failNextSave}
              onChange={(event) => setFailNextSave(event.target.checked)}
              className="h-5 w-5 accent-danger"
            />
            다음 세트 저장을 실패시키기 (Mock 오류, 1회)
          </label>
          <label className="flex flex-wrap items-center gap-2">
            하루 세션 상태
            <select
              value={session.status}
              onChange={(event) => dispatch({ type: "SET_SESSION_STATUS", status: event.target.value as SessionStatus })}
              className="min-h-11 rounded-lg border border-line bg-elevated px-2 text-fg"
            >
              {(Object.keys(STATUS_LABEL) as SessionStatus[]).map((status) => (
                <option key={status} value={status}>
                  {status} · {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
          <p>새로고침하면 Mock 상태는 초기화됩니다 (저장 계층 미연결).</p>
        </div>
      </details>

      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>

      <RestTimerPanel
        timer={timer}
        remainingMs={remainingMs}
        exerciseName={timerExerciseName}
        onPause={() => dispatch({ type: "TIMER_PAUSE", now: Date.now() })}
        onResume={() => {
          const resumedAt = Date.now();
          setNow(resumedAt);
          dispatch({ type: "TIMER_RESUME", now: resumedAt });
        }}
        onAdjust={(deltaSeconds) => {
          const adjustedAt = Date.now();
          setNow(adjustedAt);
          dispatch({ type: "TIMER_ADJUST", deltaSeconds, now: adjustedAt });
        }}
        onSkip={() => dispatch({ type: "TIMER_SKIP" })}
      />

      <ConfirmationDialog
        open={dialog.kind === "reset"}
        title="운동 기록을 리셋할까요?"
        tone="danger"
        confirmLabel="전체 세트 리셋"
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={() => {
          if (dialog.kind === "reset") {
            dispatch({ type: "RESET_EXERCISE", sessionExerciseId: dialog.sessionExerciseId, now: Date.now() });
            setStatusMessage(`${resetTarget?.exerciseName ?? "운동"} 기록이 리셋되었습니다`);
          }
          setDialog({ kind: "none" });
        }}
      >
        <p>
          <strong className="text-fg">
            {resetTarget ? `${resetTarget.tier} ${resetTarget.exerciseName}` : "이 운동"}
          </strong>
          의 모든 세트 기록이 초기화됩니다. 처음부터 다시 입력해야 합니다.
        </p>
        <p>다른 운동의 기록과 목표 중량은 바뀌지 않습니다.</p>
        <p className="text-xs">세트 완료 전에 수정한 목표 중량은 유지됩니다 (복원 정책 검토 중).</p>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={dialog.kind === "finish"}
        title="오늘 운동을 완료할까요?"
        confirmLabel="완료 처리 (Mock)"
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={() => {
          dispatch({ type: "SET_SESSION_STATUS", status: "COMPLETED" });
          dispatch({ type: "TIMER_SKIP" });
          setDialog({ kind: "finished" });
        }}
      >
        {incompleteCount > 0 ? (
          <p className="text-warning">아직 완료하지 않은 세트가 {incompleteCount}개 있습니다.</p>
        ) : (
          <p>모든 세트를 완료했습니다.</p>
        )}
        <p className="text-xs">세션 완료 조건은 아직 확정되지 않았습니다. 프로토타입에서는 상태만 바꿉니다.</p>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={dialog.kind === "finished"}
        title="세션 완료 (프로토타입)"
        confirmLabel="확인"
        cancelLabel="닫기"
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={() => setDialog({ kind: "none" })}
      >
        <p>
          하루 세션 상태만 COMPLETED로 바뀌었습니다. 기록 저장, TM 증량 판정, T3 다음 작업 중량 계산은 수행하지
          않았습니다.
        </p>
        <p className="text-xs">이제 모든 세트와 운동 리셋이 잠깁니다 (U-14 미확정).</p>
      </ConfirmationDialog>
    </div>
  );
}
