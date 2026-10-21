"use client";

import { useState } from "react";
import {
  canEditSet,
  countCompletedSets,
  getCurrentSetNumber,
  getResetPermission,
  hasResettableRecord,
  isExerciseComplete,
  toSetKey,
} from "../workoutLogic";
import { MOCK_LABEL } from "../mockWorkout";
import type { SessionExercise, SessionStatus, SetFieldErrors, SetKey } from "../types";
import { SetRow } from "./SetRow";

type ExerciseAccordionProps = {
  exercise: SessionExercise;
  sessionStatus: SessionStatus;
  expanded: boolean;
  savingKeys: readonly SetKey[];
  errors: Partial<Record<SetKey, SetFieldErrors>>;
  onToggle: () => void;
  onDraftChange: (setNumber: number, field: "weight" | "reps", value: string) => void;
  onManualTargetChange: (setNumber: number, value: number | null) => void;
  onCompleteSet: (setNumber: number) => void;
  onRequestReset: () => void;
  /** 세트 데이터 출처 배지. 기본은 Mock 표시 (프로토타입) */
  dataLabel?: string;
  /** 세트 완료 전 목표 중량 수정 허용 여부. 기본 true (프로토타입) */
  allowTargetEdit?: boolean;
  /** 실제 중량·반복 +/- 버튼 (실제 기록 화면). 생략하면 숫자 입력칸만 (프로토타입) */
  stepper?: { readonly weightStep: number; readonly unitLabel: string };
};

/**
 * 운동 하나(SessionExercise)의 Accordion.
 * 헤더: 티어·운동 이름·완료 세트 수. 패널: 진행률·전체 세트 리스트·운동 리셋.
 * 펼침 여부는 상위(WorkoutPrototype)가 관리하므로 한 번에 하나만 열린다.
 */
export function ExerciseAccordion({
  exercise,
  sessionStatus,
  expanded,
  savingKeys,
  errors,
  onToggle,
  onDraftChange,
  onManualTargetChange,
  onCompleteSet,
  onRequestReset,
  dataLabel = `${MOCK_LABEL} 세트·중량`,
  allowTargetEdit = true,
  stepper,
}: ExerciseAccordionProps) {
  const [lockNotice, setLockNotice] = useState<string | null>(null);

  const headerId = `exercise-header-${exercise.sessionExerciseId}`;
  const panelId = `exercise-panel-${exercise.sessionExerciseId}`;
  const completedCount = countCompletedSets(exercise.sets);
  const total = exercise.sets.length;
  const complete = isExerciseComplete(exercise);
  const currentSetNumber = getCurrentSetNumber(exercise.sets);
  const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  const isSavingAny = exercise.sets.some((set) =>
    savingKeys.includes(toSetKey(exercise.sessionExerciseId, set.setNumber)),
  );
  const resetPermission = getResetPermission(sessionStatus);
  const resetDisabledReason = !resetPermission.allowed
    ? resetPermission.reason
    : isSavingAny
      ? "저장 중인 세트가 있어 잠시 후 리셋할 수 있습니다"
      : !hasResettableRecord(exercise)
        ? "초기화할 기록이 없습니다"
        : null;

  const editBlockedReason =
    sessionStatus === "IN_PROGRESS"
      ? null
      : sessionStatus === "PAUSED"
        ? "일시 중단된 세션입니다. 재개 후 입력할 수 있습니다."
        : sessionStatus === "COMPLETED"
          ? "완료된 세션입니다. 기록은 잠겨 있습니다."
          : sessionStatus === "ABANDONED"
            ? "중도 종료된 세션입니다."
            : "시작 전인 세션입니다.";

  return (
    <section
      id={`exercise-${exercise.sessionExerciseId}`}
      className={`scroll-mt-4 rounded-2xl border bg-surface ${expanded ? "border-line" : "border-transparent"}`}
    >
      <h2>
        <button
          id={headerId}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-white/[0.03]"
        >
          <span
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${
              complete ? "bg-accent text-on-accent" : "bg-elevated text-fg"
            }`}
          >
            {exercise.tier}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">{exercise.exerciseName}</span>
            <span className="block text-xs text-fg-secondary">
              {exercise.tierLabel}
              {complete ? " · 완료" : ""}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
            {complete && (
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 text-accent">
                <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className={complete ? "font-semibold text-accent" : "text-fg"}>
              {completedCount}/{total}
            </span>
            <span className="sr-only">세트 완료</span>
          </span>
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 text-fg-secondary motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>

      <div id={panelId} role="region" aria-labelledby={headerId} hidden={!expanded} className="px-3 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-fg-secondary">
          <span>
            {exercise.tier} · {exercise.tierLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span>휴식 {exercise.restSeconds}초</span>
          <span className="rounded border border-warning/50 px-1 text-[10px] font-bold text-warning">{dataLabel}</span>
          {exercise.resetCount > 0 && <span>· 리셋 {exercise.resetCount}회</span>}
        </div>

        <div className="mt-3 px-1">
          <div className="flex justify-between text-xs">
            <span className="text-fg-secondary">세트 진행률</span>
            <span className="tabular-nums">
              {completedCount}/{total} 세트 · {percent}%
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-elevated"
            role="progressbar"
            aria-label={`${exercise.exerciseName} 세트 진행률`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completedCount}
          >
            <div className="h-full rounded-full bg-accent motion-safe:transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {editBlockedReason && (
          <p className="mt-3 rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-fg-secondary">
            {editBlockedReason}
          </p>
        )}

        <div className="@container mt-3">
          {/* +/- 버튼 모드에서는 입력이 둘째 줄이라 4열 머리글을 쓰지 않는다 */}
          {!stepper && (
            <div
              aria-hidden="true"
              className="hidden grid-cols-[32px_minmax(0,1fr)_144px_48px] gap-x-2 px-2 pb-1 text-[11px] font-medium tracking-wide text-fg-secondary @min-[360px]:grid"
            >
              <span className="text-center">SET</span>
              <span>목표</span>
              <span>실제 중량 · 횟수</span>
              <span className="text-center">완료</span>
            </div>
          )}
          <ol className="space-y-2" aria-label={`${exercise.exerciseName} 세트 목록`}>
            {exercise.sets.map((set) => {
              const key = toSetKey(exercise.sessionExerciseId, set.setNumber);
              return (
                <SetRow
                  key={key}
                  set={set}
                  idPrefix={exercise.sessionExerciseId}
                  isCurrent={currentSetNumber === set.setNumber}
                  editable={canEditSet(sessionStatus, set)}
                  allowTargetEdit={allowTargetEdit}
                  stepper={stepper}
                  saving={savingKeys.includes(key)}
                  errors={errors[key]}
                  onDraftChange={(field, value) => onDraftChange(set.setNumber, field, value)}
                  onManualTargetChange={(value) => onManualTargetChange(set.setNumber, value)}
                  onComplete={() => onCompleteSet(set.setNumber)}
                  onLockedPress={() =>
                    setLockNotice(
                      `${set.setNumber}세트는 완료되어 잠겨 있습니다. 수정하려면 이 운동 전체 세트를 리셋하세요.`,
                    )
                  }
                />
              );
            })}
          </ol>
        </div>

        <p aria-live="polite" className="mt-2 px-1 text-xs text-warning empty:hidden">
          {lockNotice}
        </p>

        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => {
              setLockNotice(null);
              onRequestReset();
            }}
            disabled={resetDisabledReason !== null}
            aria-describedby={resetDisabledReason ? `${panelId}-reset-reason` : undefined}
            className="min-h-11 w-full rounded-xl border border-danger/60 px-4 text-sm font-medium text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-muted disabled:hover:bg-transparent"
          >
            이 운동 기록 리셋
          </button>
          {resetDisabledReason && (
            <p id={`${panelId}-reset-reason`} className="mt-1 text-center text-xs text-fg-secondary">
              {resetDisabledReason}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
