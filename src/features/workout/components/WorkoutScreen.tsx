"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Exercise, ExerciseProfile, Tier, WorkoutSession } from "@/domain/types/model";
import { calculateTemplateSets } from "@/domain/templates/hybridTemplates";
import { kg, type WeightUnit } from "@/domain/types/weight";
import { formatKg, parsePositiveKg } from "@/lib/weightInput";
import { getBrowserDatabase, type NsunsDatabase } from "@/storage/db";
import { updateT3WorkingWeight } from "@/storage/repositories/exerciseRepository";
import { getSavedSetup } from "@/storage/repositories/setupRepository";
import {
  completeSet,
  completeWorkoutSession,
  getActiveSession,
  getLastCompletedSession,
  getSessionDetail,
  resetSessionExercise,
  startWorkoutSession,
  updateSetDraft,
  type CompleteSessionOutcome,
  type SessionDetail,
} from "@/storage/repositories/workoutRepository";
import { exerciseName, restoreSetupState } from "@/features/setup-prototype/setupPersistence";
import { ConfirmationDialog } from "@/features/workout-prototype/components/ConfirmationDialog";
import { ExerciseAccordion } from "@/features/workout-prototype/components/ExerciseAccordion";
import { RestTimerPanel } from "@/features/workout-prototype/components/RestTimerPanel";
import { findSet, getSessionProgress, toSetKey, validateSetCompletion } from "@/features/workout-prototype/workoutLogic";
import { createInitialState, getTimerRemainingMs, workoutReducer, type RestTimerState } from "@/features/workout-prototype/workoutReducer";
import type { WorkoutSession as UiSession } from "@/features/workout-prototype/types";
import { loadRestSeconds, loadTimer, saveRestSeconds, saveTimer } from "../restTimerStorage";
import { draftToSave, weightStepFor } from "../setInput";
import { describeTmProgression, sessionScopeOf, storageErrorMessage, tmIncrementLabel, toSetRecordId, toUiSession } from "../sessionMapper";
import {
  buildSessionPlan,
  dayLabel,
  HYBRID_TEMPLATE_NOTICE,
  localIsoDate,
  nextTrainingDay,
  normalizeRestSeconds,
  REST_DEFAULT_SECONDS,
  REST_MAX_SECONDS,
  REST_MIN_SECONDS,
  TIER_TEMPLATES,
  TRAINING_DAYS,
  type TrainingDay,
} from "../t3SessionPlan";

/** 현재 시각(ms). 이벤트·비동기 처리에서만 호출한다 (렌더 중 호출 금지) */
const currentTimeMs = () => Date.now();

const EMPTY_SESSION: UiSession = { sessionId: "", dayLabel: "", status: "NOT_STARTED", exercises: [] };

/** 화면 단계: 저장소 확인 → (설정 필요 | 운동 시작 패널 | 진행 중 세션) */
type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "needsSetup" }
  | {
      kind: "start";
      profiles: ReadonlyMap<string, ExerciseProfile>;
      exercises: ReadonlyMap<string, Exercise>;
      needsSetupUpgrade: boolean;
      /** 가장 최근 완료 세션 (다음 운동일 기본 선택용). 없으면 null */
      lastCompleted: WorkoutSession | null;
    }
  | { kind: "active" };

type DialogState = { kind: "none" } | { kind: "reset"; sessionExerciseId: string } | { kind: "finish" } | { kind: "finished"; outcome: CompleteSessionOutcome };

const dayLabelOf = (detail: SessionDetail) =>
  `${dayLabel(detail.session.scheduledDay)} · ${
    sessionScopeOf(detail) === "T3_ONLY" ? "T3 전용 (이전 버전 세션)" : "T1·T2·T3"
  } · ${detail.session.workoutDate}`;

/** 티어별 세트 데이터 출처 배지 */
const DATA_LABEL: Record<Tier, string> = { T1: "Hybrid T1 템플릿", T2: "Hybrid T2 템플릿", T3: "FST-7" };

/**
 * 실제 운동 기록 화면 (/workout). T1·T2(Hybrid 자체 템플릿)·T3(FST-7) 전체 세션.
 *
 * - 저장 계층(Dexie)을 단일 기준으로 쓴다. 세트 완료는 completeSet() 저장 성공 후에만 완료·잠금 표시한다.
 * - 이전 버전의 T3 전용 세션은 그대로 복원·완료할 수 있고, T1·T2를 끼워 넣지 않는다.
 * - 휴식 타이머는 종료 예정 시각(endAt) 기준으로 계산하고, 새로고침 후에도 복원한다.
 */
export function WorkoutScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [state, dispatch] = useReducer(workoutReducer, undefined, () => createInitialState(EMPTY_SESSION));
  const [now, setNow] = useState(0);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [notice, setNotice] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(new Set<string>());
  const vibratedFor = useRef<number | null>(null);
  const finishRef = useRef<HTMLDivElement>(null);

  const { session, timer } = state;
  const db = useRef<NsunsDatabase | null>(null);
  /** 운동(sessionExerciseId)별 세트 단위·증가 단위 스냅샷. 단위 혼용 방지와 +/- 단계 계산에 쓴다 */
  const [meta, setMeta] = useState<Record<string, { unit: WeightUnit; increment: number }>>({});
  /** 미완료 세트 입력값 초안 저장 대기 (세트 키 → 타이머·저장할 값) */
  const pendingDrafts = useRef(new Map<string, { timeoutId: number; save: () => Promise<void> }>());

  /** 저장소에서 읽은 세션을 화면에 반영 (세트 단위 정보 포함) */
  const loadDetail = useCallback((detail: SessionDetail, timerOverride?: RestTimerState) => {
    setMeta(Object.fromEntries(detail.exercises.map((e) => [e.sessionExercise.sessionExerciseId, { unit: e.sessionExercise.weightUnit, increment: e.sessionExercise.increment }])));
    dispatch({ type: "SESSION_LOADED", session: toUiSession(detail, exerciseName, dayLabelOf(detail)), timer: timerOverride });
  }, []);

  /** 대기 중인 초안 저장을 즉시 실행 (화면 이탈·백그라운드 전환 시) */
  const flushDrafts = useCallback(() => {
    for (const [key, pending] of pendingDrafts.current) {
      window.clearTimeout(pending.timeoutId);
      pendingDrafts.current.delete(key);
      void pending.save();
    }
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushDrafts();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushDrafts);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushDrafts);
      flushDrafts();
    };
  }, [flushDrafts]);

  /**
   * 미완료 세트 입력값을 Dexie 초안으로 저장한다 (입력이 멈추고 0.4초 뒤). 완료 상태는 바꾸지 않는다.
   * 새로고침 후 같은 값으로 복원하기 위한 편의 기능이라, 실패해도 화면 입력은 유지하고 완료 저장에는 영향이 없다.
   */
  function scheduleDraftSave(sessionExerciseId: string, setNumber: number, field: "weight" | "reps", value: string) {
    const database = db.current;
    const found = findSet(state.session, sessionExerciseId, setNumber);
    const unit = meta[sessionExerciseId]?.unit;
    if (!database || !found || found.set.completed || !unit) return;
    const weightText = field === "weight" ? value : found.set.actualWeightDraft;
    const repsText = field === "reps" ? value : found.set.actualRepsDraft;
    const key = toSetKey(sessionExerciseId, setNumber);
    const previous = pendingDrafts.current.get(key);
    if (previous) window.clearTimeout(previous.timeoutId);
    const save = async () => {
      await updateSetDraft(database, toSetRecordId(sessionExerciseId, setNumber), draftToSave(weightText, repsText, unit));
    };
    const timeoutId = window.setTimeout(() => {
      pendingDrafts.current.delete(key);
      void save();
    }, 400);
    pendingDrafts.current.set(key, { timeoutId, save });
  }

  /** 저장소 기준으로 화면을 다시 구성한다 (최초 진입·리셋·완료·다른 탭 충돌 후) */
  const refresh = useCallback(async (timerOverride?: RestTimerState) => {
    const database = db.current ?? getBrowserDatabase();
    db.current = database;
    if (!database) {
      setPhase({ kind: "unavailable", message: "이 브라우저에서는 기기 저장소(IndexedDB)를 사용할 수 없어 기록을 저장할 수 없습니다." });
      return;
    }
    const [setup, active, last] = await Promise.all([getSavedSetup(database), getActiveSession(database), getLastCompletedSession(database)]);
    if (!setup.ok || !active.ok || !last.ok) {
      setPhase({ kind: "unavailable", message: "저장된 기록을 읽지 못했습니다. 새로고침해 주세요." });
      return;
    }
    const restoredSetup = restoreSetupState(setup.value);
    // needsUpgrade(기존 설정에 스모만 없음)는 T3 기록에 영향이 없으므로 운동은 진행하고 설정 추가만 안내한다
    if (restoredSetup.kind !== "complete" && restoredSetup.kind !== "needsUpgrade") {
      setPhase({ kind: "needsSetup" });
      return;
    }
    if (active.value) {
      const at = currentTimeMs();
      loadDetail(active.value, timerOverride ?? loadTimer(active.value.session.sessionId, at));
      setNow(at);
      setPhase({ kind: "active" });
      return;
    }
    setPhase({
      kind: "start",
      profiles: new Map(setup.value.profiles.map((p) => [p.exerciseId, p])),
      exercises: new Map(setup.value.exercises.map((e) => [e.exerciseId, e])),
      lastCompleted: last.value,
      needsSetupUpgrade: restoredSetup.kind === "needsUpgrade",
    });
  }, [loadDetail]);

  useEffect(() => {
    // 브라우저에서만 실행: 서버 렌더링 중에는 IndexedDB에 접근하지 않는다
    void refresh();
  }, [refresh]);

  // 타이머 표시 갱신 (남은 시간은 endAt - now로 계산하고 interval은 화면 갱신에만 쓴다)
  const isTimerRunning = timer.phase === "running";
  useEffect(() => {
    if (!isTimerRunning) return;
    const tick = () => setNow(Date.now());
    tick();
    const intervalId = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isTimerRunning]);

  // 타이머를 기기에 저장해 새로고침 후 복원
  useEffect(() => {
    if (phase.kind === "active" && session.sessionId) saveTimer(session.sessionId, timer);
  }, [phase.kind, session.sessionId, timer]);

  // 휴식 종료 시 진동 (Android Chrome 등 Vibration API 지원 환경만. iPhone Safari는 지원하지 않음)
  const remainingMs = getTimerRemainingMs(timer, now);
  useEffect(() => {
    if (timer.phase !== "running" || remainingMs > 0 || now === 0) return;
    if (vibratedFor.current === timer.endAt) return;
    vibratedFor.current = timer.endAt;
    // 종료 직후에만 진동 (복원된 지 오래된 타이머는 진동하지 않음)
    if (now - timer.endAt < 5000 && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([200, 100, 200]);
  }, [timer, remainingMs, now]);

  async function handleCompleteSet(sessionExerciseId: string, setNumber: number) {
    const database = db.current;
    const key = toSetKey(sessionExerciseId, setNumber);
    // 같은 세트 연속 탭: 렌더 전에 들어온 두 번째 요청을 막는다 (저장 계층도 중복 완료를 거부)
    if (!database || inFlight.current.has(key)) return;
    const found = findSet(state.session, sessionExerciseId, setNumber);
    if (!found || found.set.completed) return;

    const validation = validateSetCompletion(found.set.actualWeightDraft, found.set.actualRepsDraft);
    if (!validation.ok) {
      dispatch({ type: "VALIDATION_FAILED", sessionExerciseId, setNumber, errors: validation.errors });
      return;
    }
    // 이 세트의 대기 중인 초안 저장은 취소한다 (완료 저장이 실제값을 기록)
    const pending = pendingDrafts.current.get(key);
    if (pending) {
      window.clearTimeout(pending.timeoutId);
      pendingDrafts.current.delete(key);
    }
    const unit = meta[sessionExerciseId]?.unit ?? "kg";
    inFlight.current.add(key);
    dispatch({ type: "SAVE_STARTED", sessionExerciseId, setNumber });
    try {
      const result = await completeSet(database, toSetRecordId(sessionExerciseId, setNumber), {
        // 세트 단위 그대로 저장 (kg↔lb 변환 없음)
        actualWeight: { value: validation.weight, unit },
        actualReps: validation.reps,
      });
      if (result.ok) {
        const savedAt = Date.now();
        setNow(savedAt);
        dispatch({ type: "SAVE_SUCCEEDED", sessionExerciseId, setNumber, weight: validation.weight, reps: validation.reps, now: savedAt });
        setStatusMessage(`${found.exercise.exerciseName} ${setNumber}세트 저장됨`);
        return;
      }
      if (result.error === "SET_ALREADY_COMPLETED" || result.error === "SESSION_NOT_EDITABLE") {
        // 다른 탭에서 바뀐 경우: 저장소 기준으로 다시 보여준다
        await refresh();
        setNotice(storageErrorMessage(result.error));
        return;
      }
      dispatch({ type: "SAVE_FAILED", sessionExerciseId, setNumber, message: storageErrorMessage(result.error) });
      setStatusMessage(`${setNumber}세트 저장 실패`);
    } finally {
      inFlight.current.delete(key);
    }
  }

  async function handleReset(sessionExerciseId: string) {
    const database = db.current;
    if (!database || busy) return;
    // 리셋 대상 운동의 대기 중인 초안 저장은 버린다 (리셋 후 이전 입력이 되살아나지 않게)
    for (const [key, pending] of pendingDrafts.current) {
      if (!key.startsWith(`${sessionExerciseId}#`)) continue;
      window.clearTimeout(pending.timeoutId);
      pendingDrafts.current.delete(key);
    }
    setBusy(true);
    const result = await resetSessionExercise(database, { sessionId: session.sessionId, sessionExerciseId });
    setBusy(false);
    if (!result.ok) {
      setNotice(storageErrorMessage(result.error));
      return;
    }
    const detail = await getSessionDetail(database, session.sessionId);
    if (detail.ok && detail.value) {
      const stopTimer = timer.phase !== "idle" && timer.sessionExerciseId === sessionExerciseId;
      loadDetail(detail.value, stopTimer ? { phase: "idle" } : undefined);
      setStatusMessage("운동 기록이 리셋되었습니다");
    }
  }

  async function handleFinish() {
    const database = db.current;
    if (!database || busy) return;
    setBusy(true);
    const result = await completeWorkoutSession(database, session.sessionId);
    setBusy(false);
    if (!result.ok) {
      setDialog({ kind: "none" });
      setNotice(storageErrorMessage(result.error));
      return;
    }
    dispatch({ type: "SET_SESSION_STATUS", status: "COMPLETED" });
    dispatch({ type: "TIMER_SKIP" });
    saveTimer(session.sessionId, { phase: "idle" });
    setDialog({ kind: "finished", outcome: result.value });
  }

  if (phase.kind === "loading" || phase.kind === "unavailable" || phase.kind === "needsSetup") {
    return (
      <Shell>
        {phase.kind === "needsSetup" ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl bg-surface px-4 py-3 text-sm text-fg-secondary">운동을 기록하려면 먼저 초기 설정을 저장하세요.</p>
            <Link href="/setup" className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-bold text-on-accent">
              초기 설정하기
            </Link>
          </div>
        ) : (
          <p role={phase.kind === "loading" ? "status" : "alert"} className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm text-fg-secondary">
            {phase.kind === "loading" ? "저장된 운동 기록을 불러오는 중…" : phase.message}
          </p>
        )}
      </Shell>
    );
  }

  if (phase.kind === "start") {
    return (
      <StartPanel
        profiles={phase.profiles}
        exercises={phase.exercises}
        lastCompleted={phase.lastCompleted}
        needsSetupUpgrade={phase.needsSetupUpgrade}
        onStarted={async (detail) => {
          loadDetail(detail, { phase: "idle" });
          setPhase({ kind: "active" });
        }}
        onActiveExists={() => void refresh()}
        onProfileChanged={() => void refresh()}
      />
    );
  }

  const progress = getSessionProgress(session);
  const progressPercent = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  const allDone = progress.total > 0 && progress.completed === progress.total;
  const isT3OnlySession = session.exercises.length > 0 && session.exercises.every((ex) => ex.tier === "T3");
  const timerExerciseName =
    timer.phase === "idle" ? null : (session.exercises.find((ex) => ex.sessionExerciseId === timer.sessionExerciseId)?.exerciseName ?? null);
  const resetTarget = dialog.kind === "reset" ? session.exercises.find((ex) => ex.sessionExerciseId === dialog.sessionExerciseId) : undefined;

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-44 pt-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-[0.08em] text-fg-secondary">{session.dayLabel}</p>
          <h1 className="text-2xl font-bold">오늘의 운동</h1>
        </div>
        <span className="mt-1 shrink-0 rounded-full border border-line px-3 py-1 text-xs">
          {session.status === "COMPLETED" ? "완료" : "진행 중"}
        </span>
      </header>

      {isT3OnlySession ? (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          이전 버전에서 시작한 <strong className="font-bold">T3 전용 세션</strong>입니다. 기존 기록 그대로 이어서 완료할 수 있으며, T1·T2는 다음 세션부터 함께
          기록됩니다.
        </p>
      ) : (
        <p className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-fg-secondary">
          {HYBRID_TEMPLATE_NOTICE} T1·T2는 모든 세트의 목표 중량·반복을 달성하면 다음 운동부터 TM이 올라갑니다 (Hybrid 자체 증량 정책).
        </p>
      )}

      {notice && (
        <p role="alert" className="mt-3 flex items-start justify-between gap-2 rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>⚠ {notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="min-h-11 min-w-11 shrink-0 rounded-lg text-xs" aria-label="안내 닫기">
            닫기
          </button>
        </p>
      )}

      <section aria-label="전체 운동 진행 상황" className="mt-4 rounded-2xl bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">전체 진행률</h2>
          <p className="text-sm tabular-nums">
            <span className="font-semibold">{progress.completed}</span>
            <span className="text-fg-secondary"> / {progress.total} 세트 · {progressPercent}%</span>
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label="전체 세트 진행률" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
          <div className="h-full rounded-full bg-accent motion-safe:transition-[width]" style={{ width: `${progressPercent}%` }} />
        </div>
        {session.exercises.length > 1 && (
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
        )}
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
            dataLabel={DATA_LABEL[exercise.tier]}
            allowTargetEdit={false}
            stepper={{
              weightStep: weightStepFor(meta[exercise.sessionExerciseId]?.unit ?? "kg", meta[exercise.sessionExerciseId]?.increment ?? 2.5),
              unitLabel: meta[exercise.sessionExerciseId]?.unit ?? "kg",
            }}
            onToggle={() => dispatch({ type: "TOGGLE_EXPAND", sessionExerciseId: exercise.sessionExerciseId })}
            onDraftChange={(setNumber, field, value) => {
              dispatch({ type: "UPDATE_DRAFT", sessionExerciseId: exercise.sessionExerciseId, setNumber, field, value });
              scheduleDraftSave(exercise.sessionExerciseId, setNumber, field, value);
            }}
            onManualTargetChange={() => undefined}
            onCompleteSet={(setNumber) => void handleCompleteSet(exercise.sessionExerciseId, setNumber)}
            onRequestReset={() => setDialog({ kind: "reset", sessionExerciseId: exercise.sessionExerciseId })}
          />
        ))}
      </div>

      <div ref={finishRef} className="mt-6">
        {session.status === "COMPLETED" ? (
          <button type="button" onClick={() => void refresh()} className="min-h-12 w-full rounded-xl bg-accent px-4 text-base font-bold text-on-accent">
            새 운동 시작
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={!allDone || busy}
              onClick={() => setDialog({ kind: "finish" })}
              className="min-h-12 w-full rounded-xl bg-accent px-4 text-base font-bold text-on-accent disabled:bg-elevated disabled:text-fg-muted"
            >
              오늘 운동 완료
            </button>
            {!allDone && (
              <p className="mt-1 text-center text-xs text-fg-secondary">모든 세트를 완료해야 운동을 완료할 수 있습니다 ({progress.total - progress.completed}세트 남음)</p>
            )}
          </>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>

      <RestTimerPanel
        timer={timer}
        remainingMs={remainingMs}
        exerciseName={timerExerciseName}
        onPause={() => dispatch({ type: "TIMER_PAUSE", now: Date.now() })}
        onResume={() => {
          const at = Date.now();
          setNow(at);
          dispatch({ type: "TIMER_RESUME", now: at });
        }}
        onAdjust={(deltaSeconds) => {
          const at = Date.now();
          setNow(at);
          dispatch({ type: "TIMER_ADJUST", deltaSeconds, now: at });
        }}
        onSkip={() => dispatch({ type: "TIMER_SKIP" })}
      />

      <ConfirmationDialog
        open={dialog.kind === "reset"}
        title="운동 기록을 리셋할까요?"
        tone="danger"
        confirmLabel={busy ? "리셋 중…" : "전체 세트 리셋"}
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={() => {
          if (dialog.kind === "reset") void handleReset(dialog.sessionExerciseId);
          setDialog({ kind: "none" });
        }}
      >
        <p>
          <strong className="text-fg">{resetTarget ? `${resetTarget.tier} ${resetTarget.exerciseName}` : "이 운동"}</strong>의 모든 세트 기록이
          초기화됩니다. 처음부터 다시 입력해야 합니다.
        </p>
        <p>목표 중량과 다른 운동의 기록은 바뀌지 않습니다.</p>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={dialog.kind === "finish"}
        title="오늘 운동을 완료할까요?"
        confirmLabel={busy ? "저장 중…" : "완료"}
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={() => void handleFinish()}
      >
        <p>완료하면 기록이 잠기고 리셋할 수 없습니다.</p>
        <p className="text-xs">FST-7 성공(7세트 모두 12회 이상, 목표 중량 이상)이면 다음 작업 중량이 한 단계 올라갑니다.</p>
        {!isT3OnlySession && (
          <p className="text-xs">T1·T2는 모든 세트가 목표 중량·반복(AMRAP은 최소 반복) 이상이면 다음 운동부터 TM이 올라가고, 하나라도 미달이면 유지됩니다.</p>
        )}
      </ConfirmationDialog>

      <ConfirmationDialog
        open={dialog.kind === "finished"}
        title="운동 완료"
        confirmLabel="확인"
        cancelLabel="닫기"
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={() => setDialog({ kind: "none" })}
      >
        {dialog.kind === "finished" &&
          dialog.outcome.t3Progressions.map((p) => (
            <p key={p.sessionExerciseId}>
              <strong className="text-fg">{exerciseName(p.exerciseId)}</strong>:{" "}
              {p.decision.decision === "INCREASE"
                ? p.applied
                  ? `다음 작업 중량 ${formatKg(p.decision.nextWorkingWeight.value)}kg으로 증가`
                  : "증량 조건을 충족했지만, 운동 중 직접 바꾼 작업 중량을 유지했습니다"
                : `작업 중량 유지 (${formatKg(p.decision.nextWorkingWeight.value)}kg)`}
            </p>
          ))}
        {dialog.kind === "finished" && dialog.outcome.tmProgressions.length > 0 && (
          <ul className="space-y-2" aria-label="T1·T2 TM 결과">
            {dialog.outcome.tmProgressions.map((p) => {
              const view = describeTmProgression(p);
              return (
                <li key={p.exerciseId} className="rounded-lg bg-surface px-3 py-2">
                  <p className="flex items-baseline justify-between gap-2">
                    <strong className="text-fg">
                      {p.tiers.join("·")} {exerciseName(p.exerciseId)}
                    </strong>
                    <span className={`shrink-0 text-xs font-semibold ${view.achieved ? "text-accent" : "text-fg-secondary"}`}>
                      {view.achieved ? "목표 달성" : p.status === "HELD" ? "목표 미달" : "증량 없음"}
                    </span>
                  </p>
                  <p className="tabular-nums text-fg">{view.tmLine}</p>
                  {view.reason && <p className="text-xs">{view.reason}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </ConfirmationDialog>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pt-4">
      <p className="text-xs font-semibold tracking-[0.12em] text-fg-secondary">NSUNS HYBRID · WORKOUT</p>
      <h1 className="text-2xl font-bold">운동 기록</h1>
      {children}
    </div>
  );
}

type StartPanelProps = {
  profiles: ReadonlyMap<string, ExerciseProfile>;
  exercises: ReadonlyMap<string, Exercise>;
  lastCompleted: WorkoutSession | null;
  /** 기존 설정에 새로 추가된 운동(스모 데드리프트)이 없음 */
  needsSetupUpgrade: boolean;
  onStarted: (detail: SessionDetail) => void | Promise<void>;
  onActiveExists: () => void;
  onProfileChanged: () => void;
};

const TIERS: readonly Tier[] = ["T1", "T2", "T3"];

/** "M/D" (기기 현지 날짜) */
const shortDate = (iso: string | null) => {
  if (!iso) return "";
  const [, month, dayOfMonth] = localIsoDate(new Date(iso)).split("-");
  return `${Number(month)}/${Number(dayOfMonth)}`;
};

/**
 * 운동 시작 패널: 운동일(Day) 선택 → T1·T2·T3 운동과 기준 중량 확인 → 휴식 시간 → 시작.
 * 기본 선택은 마지막으로 완료한 Day의 다음 Day이며(실제 요일과 무관), 사용자가 다른 Day를 고를 수 있다.
 */
function StartPanel({ profiles, exercises, lastCompleted, needsSetupUpgrade, onStarted, onActiveExists, onProfileChanged }: StartPanelProps) {
  // 브라우저 전용 싱글턴. 이 패널은 저장소 확인이 끝난 뒤(클라이언트)에만 렌더링된다
  const database = getBrowserDatabase();
  const [day, setDay] = useState<TrainingDay>(() => nextTrainingDay(lastCompleted?.scheduledDay ?? null));
  const suggestedDay = nextTrainingDay(lastCompleted?.scheduledDay ?? null);
  const [rest, setRest] = useState<Record<Tier, number>>(() => ({ T1: loadRestSeconds("T1"), T2: loadRestSeconds("T2"), T3: loadRestSeconds("T3") }));
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [weightDraft, setWeightDraft] = useState("");

  const t3Profile = profiles.get(day.t3ExerciseId);
  const workingWeight = t3Profile?.t3WorkingWeight ?? null;
  const isDumbbell = exercises.get(day.t3ExerciseId)?.equipment === "DUMBBELL";
  const rows = (["T1", "T2"] as const).map((tier) => {
    const exerciseId = tier === "T1" ? day.t1ExerciseId : day.t2ExerciseId;
    const profile = profiles.get(exerciseId);
    const exercise = exercises.get(exerciseId);
    const tm = profile?.currentTM ?? null;
    // 미리보기: 저장 계층과 같은 함수로 계산 (실제 목표는 시작 시점 TM 스냅샷으로 다시 계산)
    const preview =
      tm !== null && exercise
        ? calculateTemplateSets(TIER_TEMPLATES[tier], { value: tm, unit: exercise.weightUnit }, { value: exercise.increment, unit: exercise.weightUnit })
        : null;
    const weights = preview?.ok ? preview.value.map((s) => s.targetWeight) : [];
    return { tier, exerciseId, tm, weights, unit: exercise?.weightUnit ?? "kg" };
  });
  const missingProfile = rows.some((row) => row.tm === null) || workingWeight === null;

  function changeRest(tier: Tier, delta: number) {
    const next = normalizeRestSeconds(rest[tier] + delta, REST_DEFAULT_SECONDS[tier]);
    setRest((prev) => ({ ...prev, [tier]: next }));
    saveRestSeconds(tier, next);
  }

  async function start() {
    if (!database || starting) return;
    setStarting(true);
    setError(null);
    const result = await startWorkoutSession(database, buildSessionPlan(day, new Date(), rest));
    setStarting(false);
    if (result.ok) {
      await onStarted(result.value);
      return;
    }
    if (result.error === "ACTIVE_SESSION_EXISTS") {
      onActiveExists();
      return;
    }
    setError(storageErrorMessage(result.error));
  }

  async function saveWeight() {
    const value = parsePositiveKg(weightDraft);
    if (!database || value === null) {
      setError("작업 중량은 0보다 큰 숫자(kg)여야 합니다.");
      return;
    }
    const result = await updateT3WorkingWeight(database, day.t3ExerciseId, kg(value));
    if (!result.ok) {
      setError(storageErrorMessage(result.error));
      return;
    }
    setEditing(false);
    setError(null);
    onProfileChanged();
  }

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-10 pt-4">
      <p className="text-xs font-semibold tracking-[0.12em] text-fg-secondary">NSUNS HYBRID · WORKOUT</p>
      <h1 className="text-2xl font-bold">운동 시작</h1>

      {needsSetupUpgrade && (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          스모 데드리프트 초기 1RM이 아직 없습니다 (Day 3 T2).{" "}
          <Link href="/setup" className="inline-flex min-h-11 items-center font-semibold underline">
            설정에서 추가하기
          </Link>
        </p>
      )}

      <p className="mt-3 text-sm text-fg-secondary">
        {lastCompleted ? (
          <>
            지난 운동: <span className="font-semibold text-fg">{dayLabel(lastCompleted.scheduledDay) || "—"}</span> ({shortDate(lastCompleted.completedAt)} 완료) · 다음
            운동: <span className="font-semibold text-accent">{suggestedDay.label}</span>
          </>
        ) : (
          <>
            첫 운동입니다 · <span className="font-semibold text-accent">{suggestedDay.label}</span>부터 시작하세요
          </>
        )}
      </p>

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">운동일</legend>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {TRAINING_DAYS.map((d) => (
            <button
              key={d.weekday}
              type="button"
              aria-pressed={d.weekday === day.weekday}
              aria-label={`${d.label}${d.weekday === suggestedDay.weekday ? " (다음 운동)" : ""}`}
              onClick={() => {
                setDay(d);
                setEditing(false);
                setError(null);
              }}
              className={`flex min-h-12 flex-col items-center justify-center rounded-xl leading-tight ${
                d.weekday === day.weekday ? "bg-accent text-on-accent" : "bg-surface text-fg"
              }`}
            >
              <span className="text-[10px] font-semibold tracking-wide opacity-80">DAY</span>
              <span className="text-base font-bold">{d.label.replace("Day ", "")}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <ul className="mt-4 space-y-2">
        {rows.map((row) => (
          <li key={row.tier} className="rounded-2xl bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-elevated px-2 py-1 text-xs font-bold">{row.tier}</span>
              <span className="min-w-0 truncate font-semibold">{exerciseName(row.exerciseId)}</span>
              <span className="ml-auto shrink-0 text-xs text-fg-secondary">{TIER_TEMPLATES[row.tier].sets.length}세트</span>
            </div>
            {row.tm === null ? (
              <p className="mt-2 text-xs text-warning">설정값이 없습니다. 초기 설정에서 추가하세요.</p>
            ) : (
              <p className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                <span className="text-fg-secondary">
                  TM {formatKg(row.tm)} {row.unit}
                  <span className="block text-[11px]">{tmIncrementLabel(row.exerciseId) ?? "자동 증량 없음"}</span>
                </span>
                <span className="text-right text-xs tabular-nums text-fg-secondary">
                  {row.weights.length > 0 ? `${formatKg(Math.min(...row.weights))}~${formatKg(Math.max(...row.weights))} ${row.unit}` : "—"}
                </span>
              </p>
            )}
          </li>
        ))}
        <li className="rounded-2xl bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-elevated px-2 py-1 text-xs font-bold">T3</span>
            <span className="min-w-0 truncate font-semibold">{exerciseName(day.t3ExerciseId)}</span>
            <span className="ml-auto shrink-0 text-xs text-fg-secondary">7세트 × 12회</span>
          </div>
          <p className="mt-2 flex items-baseline justify-between text-sm">
            <span className="text-fg-secondary">작업 중량{isDumbbell ? " (한 손)" : ""}</span>
            <span className="text-lg font-bold tabular-nums">{workingWeight === null ? "—" : `${formatKg(workingWeight)} kg`}</span>
          </p>
          {editing ? (
            <div className="mt-2 flex gap-2">
              <label className="relative block flex-1">
                <span className="sr-only">새 작업 중량 (kg)</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={weightDraft}
                  onChange={(e) => setWeightDraft(e.target.value)}
                  className="h-11 w-full rounded-lg border border-line bg-elevated pl-3 pr-8 text-base tabular-nums outline-none focus-visible:border-accent"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-fg-secondary">kg</span>
              </label>
              <button type="button" onClick={() => void saveWeight()} className="min-h-11 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent">
                저장
              </button>
              <button type="button" onClick={() => setEditing(false)} className="min-h-11 rounded-lg border border-line px-3 text-sm">
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setWeightDraft(workingWeight === null ? "" : String(workingWeight));
                setEditing(true);
              }}
              className="mt-2 min-h-11 w-full rounded-xl border border-line text-sm"
            >
              T3 작업 중량 변경
            </button>
          )}
        </li>
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-fg-secondary">{HYBRID_TEMPLATE_NOTICE}</p>

      <section className="mt-4 rounded-2xl bg-surface p-4" aria-label="세트 간 휴식 시간">
        <h2 className="text-sm font-semibold">세트 간 휴식</h2>
        <ul className="mt-2 space-y-1">
          {TIERS.map((tier) => (
            <li key={tier} className="flex items-center justify-between gap-2">
              <span className="text-sm text-fg-secondary">{tier}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => changeRest(tier, -15)} disabled={rest[tier] <= REST_MIN_SECONDS} className="min-h-11 min-w-11 rounded-xl border border-line text-sm disabled:opacity-35" aria-label={`${tier} 휴식 15초 줄이기`}>
                  −15
                </button>
                <span className="w-14 text-center text-base font-bold tabular-nums" aria-live="polite">
                  {rest[tier]}초
                </span>
                <button type="button" onClick={() => changeRest(tier, 15)} disabled={rest[tier] >= REST_MAX_SECONDS} className="min-h-11 min-w-11 rounded-xl border border-line text-sm disabled:opacity-35" aria-label={`${tier} 휴식 15초 늘리기`}>
                  +15
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-fg-secondary">기본 {REST_DEFAULT_SECONDS.T1}초. 바꾼 값은 이 기기에 저장됩니다.</p>
      </section>

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void start()}
        disabled={starting || missingProfile || !database}
        className="mt-4 min-h-12 w-full rounded-xl bg-accent px-4 text-base font-bold text-on-accent disabled:opacity-60"
      >
        {starting ? "시작 중…" : `${day.label} 운동 시작`}
      </button>
      {missingProfile && <p className="mt-2 text-center text-xs text-warning">이 Day 운동의 설정값이 없어 시작할 수 없습니다.</p>}
      <p className="mt-4 text-center text-xs">
        <Link href="/setup" className="inline-flex min-h-11 items-center text-fg-secondary underline">
          저장된 설정 보기
        </Link>
      </p>
    </div>
  );
}
