"use client";

import { useState } from "react";
import { getEffectiveTargetWeight, parseTargetWeight } from "../workoutLogic";
import type { SetFieldErrors, SetRecord } from "../types";

type SetRowProps = {
  set: SetRecord;
  /** DOM id 접두사 (sessionExerciseId) */
  idPrefix: string;
  isCurrent: boolean;
  /** 세션 상태상 입력·체크가 가능한지 (IN_PROGRESS + 미완료) */
  editable: boolean;
  saving: boolean;
  errors?: SetFieldErrors;
  onDraftChange: (field: "weight" | "reps", value: string) => void;
  onManualTargetChange: (value: number | null) => void;
  onComplete: () => void;
  onLockedPress: () => void;
};

const formatKg = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}`;

/**
 * 세트 한 줄: 세트 번호 · 목표 · 실제 중량/횟수 입력 · 완료 체크박스.
 * 좁은 패널(@container 360px 미만, 예: 320·390px 화면)에서는 입력칸을 둘째 줄로 내린다.
 */
export function SetRow({
  set,
  idPrefix,
  isCurrent,
  editable,
  saving,
  errors,
  onDraftChange,
  onManualTargetChange,
  onComplete,
  onLockedPress,
}: SetRowProps) {
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [targetError, setTargetError] = useState<string | null>(null);

  const label = `${set.setNumber}세트`;
  const targetWeight = getEffectiveTargetWeight(set);
  const targetReps = set.isAmrap ? `${set.targetReps}+` : `${set.targetReps}`;
  const inputsDisabled = !editable || saving;
  const errorId = `set-error-${idPrefix}-${set.setNumber}`;
  const hasError = Boolean(errors?.weight || errors?.reps || errors?.save);

  function openTargetEditor() {
    setTargetDraft(String(targetWeight));
    setTargetError(null);
    setIsEditingTarget(true);
  }

  function applyTarget() {
    const value = parseTargetWeight(targetDraft);
    if (value === null) {
      setTargetError("0보다 큰 숫자를 입력하세요");
      return;
    }
    onManualTargetChange(value === set.targetWeight ? null : value);
    setIsEditingTarget(false);
  }

  const rowTone = set.completed
    ? "bg-accent/[0.06] border-accent/30"
    : isCurrent
      ? "bg-elevated border-accent/60"
      : "bg-elevated/40 border-transparent";

  return (
    <li
      className={`rounded-xl border px-2 py-2 ${rowTone}`}
      aria-label={`${label}${set.isAmrap ? " AMRAP" : ""}${set.completed ? " 완료됨" : isCurrent ? " 현재 세트" : ""}`}
    >
      <div className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-x-2 gap-y-2 @min-[360px]:grid-cols-[32px_minmax(0,1fr)_auto_48px]">
        {/* 세트 번호 */}
        <div className="col-start-1 row-start-1 flex flex-col items-center leading-none">
          <span className="text-base font-semibold tabular-nums">{set.setNumber}</span>
          {isCurrent && !set.completed && (
            <span className="mt-1 text-[10px] font-semibold text-accent">현재</span>
          )}
        </div>

        {/* 목표 */}
        <div className="col-start-2 row-start-1 min-w-0">
          {editable && !saving ? (
            <button
              type="button"
              onClick={openTargetEditor}
              aria-label={`${label} 목표 ${formatKg(targetWeight)}kg × ${targetReps}회, 목표 중량 수정`}
              className="flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-1 text-left hover:bg-white/5"
            >
              <TargetText weight={targetWeight} reps={targetReps} isAmrap={set.isAmrap} />
              {set.manualTargetWeight !== null ? (
                <span className="text-[11px] text-warning">✎ 수정됨 (원래 {formatKg(set.targetWeight)})</span>
              ) : (
                <span className="text-[11px] text-fg-secondary">목표 ✎</span>
              )}
            </button>
          ) : (
            <div className="flex min-h-11 flex-col justify-center px-1">
              <TargetText weight={targetWeight} reps={targetReps} isAmrap={set.isAmrap} />
              <span className="text-[11px] text-fg-secondary">
                목표{set.manualTargetWeight !== null ? ` · 수정됨 (원래 ${formatKg(set.targetWeight)}kg)` : ""}
              </span>
            </div>
          )}
        </div>

        {/* 실제 입력 또는 완료 기록 */}
        <div className="col-span-2 col-start-2 row-start-2 @min-[360px]:col-span-1 @min-[360px]:col-start-3 @min-[360px]:row-start-1">
          {set.completed ? (
            <p className="flex min-h-11 items-center gap-1 px-1 text-base font-semibold tabular-nums">
              <span>{formatKg(set.actualWeight ?? 0)}</span>
              <span className="text-xs font-normal text-fg-secondary">kg</span>
              <span className="mx-0.5 text-fg-secondary">×</span>
              <span>{set.actualReps}</span>
              <span className="text-xs font-normal text-fg-secondary">회</span>
            </p>
          ) : (
            <div className="flex gap-2">
              <NumberField
                label={`${label} 실제 중량 (kg)`}
                unit="kg"
                inputMode="decimal"
                value={set.actualWeightDraft}
                placeholder="중량"
                disabled={inputsDisabled}
                invalid={Boolean(errors?.weight)}
                describedBy={hasError ? errorId : undefined}
                onChange={(value) => onDraftChange("weight", value)}
                widthClass="w-full @min-[360px]:w-[76px]"
              />
              <NumberField
                label={`${label} 실제 반복 (회)`}
                unit="회"
                inputMode="numeric"
                value={set.actualRepsDraft}
                placeholder={set.isAmrap ? "필수" : "횟수"}
                disabled={inputsDisabled}
                invalid={Boolean(errors?.reps)}
                describedBy={hasError ? errorId : undefined}
                onChange={(value) => onDraftChange("reps", value)}
                widthClass="w-full @min-[360px]:w-[60px]"
              />
            </div>
          )}
        </div>

        {/* 완료 체크박스 */}
        <div className="col-start-3 row-start-1 flex justify-center @min-[360px]:col-start-4">
          <CompletionCheckbox
            label={label}
            completed={set.completed}
            saving={saving}
            disabled={!editable && !set.completed}
            hasError={Boolean(errors?.save)}
            describedBy={hasError ? errorId : undefined}
            onComplete={onComplete}
            onLockedPress={onLockedPress}
          />
        </div>
      </div>

      {isEditingTarget && editable && (
        <div className="mt-2 rounded-lg border border-line bg-surface p-2">
          <label className="block text-xs text-fg-secondary" htmlFor={`target-${idPrefix}-${set.setNumber}`}>
            {label} 목표 중량 수정 (세트 완료 전에만 가능)
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="relative w-28">
              <input
                id={`target-${idPrefix}-${set.setNumber}`}
                inputMode="decimal"
                autoComplete="off"
                value={targetDraft}
                aria-invalid={Boolean(targetError)}
                onChange={(event) => {
                  setTargetDraft(event.target.value);
                  setTargetError(null);
                }}
                className="h-11 w-full rounded-lg border border-line bg-elevated pl-3 pr-8 text-base tabular-nums outline-none focus-visible:border-accent"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-fg-secondary">
                kg
              </span>
            </div>
            <button
              type="button"
              onClick={applyTarget}
              className="min-h-11 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent"
            >
              적용
            </button>
            {set.manualTargetWeight !== null && (
              <button
                type="button"
                onClick={() => {
                  onManualTargetChange(null);
                  setIsEditingTarget(false);
                }}
                className="min-h-11 rounded-lg border border-line px-3 text-sm"
              >
                원래 값
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditingTarget(false)}
              className="min-h-11 rounded-lg px-3 text-sm text-fg-secondary"
            >
              취소
            </button>
          </div>
          {targetError && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {targetError}
            </p>
          )}
        </div>
      )}

      <div id={errorId} aria-live="polite" className="empty:hidden">
        {hasError && (
          <ul className="mt-2 space-y-0.5 pl-10 text-xs text-danger">
            {errors?.weight && <li>⚠ {errors.weight}</li>}
            {errors?.reps && <li>⚠ {errors.reps}</li>}
            {errors?.save && <li>⚠ {errors.save}</li>}
          </ul>
        )}
      </div>
    </li>
  );
}

function TargetText({ weight, reps, isAmrap }: { weight: number; reps: string; isAmrap: boolean }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1 tabular-nums">
      <span className="text-base font-semibold">{formatKg(weight)}</span>
      <span className="text-xs text-fg-secondary">kg</span>
      <span className="text-fg-secondary">×</span>
      <span className="text-base font-semibold">{reps}</span>
      {isAmrap && (
        <span className="ml-1 rounded border border-warning/60 px-1 text-[10px] font-bold tracking-wide text-warning">
          AMRAP
        </span>
      )}
    </span>
  );
}

type NumberFieldProps = {
  label: string;
  unit: string;
  inputMode: "decimal" | "numeric";
  value: string;
  placeholder: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  widthClass: string;
  onChange: (value: string) => void;
};

function NumberField({
  label,
  unit,
  inputMode,
  value,
  placeholder,
  disabled,
  invalid,
  describedBy,
  widthClass,
  onChange,
}: NumberFieldProps) {
  return (
    <label className={`relative block ${widthClass}`}>
      <span className="sr-only">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={`h-11 w-full rounded-lg border bg-surface pl-2 pr-6 text-base font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-fg-muted focus-visible:border-accent disabled:opacity-50 ${
          invalid ? "border-danger" : "border-line"
        }`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[11px] text-fg-secondary">
        {unit}
      </span>
    </label>
  );
}

type CompletionCheckboxProps = {
  label: string;
  completed: boolean;
  saving: boolean;
  disabled: boolean;
  hasError: boolean;
  describedBy?: string;
  onComplete: () => void;
  onLockedPress: () => void;
};

/**
 * 세트 완료 체크박스. 상태: 미완료 / 저장 중 / 완료·잠금 / 저장 오류 (BASE 6.4).
 * 완료 후에는 해제할 수 없고, 누르면 잠금 안내만 한다.
 */
function CompletionCheckbox({
  label,
  completed,
  saving,
  disabled,
  hasError,
  describedBy,
  onComplete,
  onLockedPress,
}: CompletionCheckboxProps) {
  const stateText = completed ? "완료됨, 잠김" : saving ? "저장 중" : hasError ? "저장 실패" : "미완료";
  const boxClass = completed
    ? "bg-accent border-accent text-on-accent"
    : hasError
      ? "border-danger"
      : "border-fg-secondary";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={completed}
      aria-busy={saving}
      aria-disabled={completed || saving || disabled}
      aria-label={`${label} 완료 (${stateText})`}
      aria-describedby={describedBy}
      onClick={() => {
        if (completed) {
          onLockedPress();
          return;
        }
        if (saving || disabled) return;
        onComplete();
      }}
      className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl ${
        disabled && !completed ? "opacity-40" : "hover:bg-white/5"
      }`}
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-md border-2 ${boxClass}`}>
        {saving ? (
          <span className="h-4 w-4 rounded-full border-2 border-fg-secondary border-t-transparent motion-safe:animate-spin" />
        ) : completed ? (
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
            <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className="mt-0.5 text-[10px] leading-none text-fg-secondary">
        {completed ? "🔒 잠김" : saving ? "저장 중" : hasError ? "재시도" : ""}
      </span>
    </button>
  );
}
