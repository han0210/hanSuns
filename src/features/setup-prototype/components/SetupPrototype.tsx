"use client";

import Link from "next/link";
import { useEffect, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { formatKg, parsePositiveKg } from "@/lib/weightInput";
import { getBrowserDatabase } from "@/storage/db";
import { getSavedSetup, saveInitialSetup } from "@/storage/repositories/setupRepository";
import { confirmSetup, restoreSetupState, SETUP_EQUIPMENT } from "../setupPersistence";
import {
  createInitialSetupState,
  DIRECT_LIFT_IDS,
  DIRECT_LIFTS,
  ESTIMATE_RULES,
  ESTIMATED_LIFT_IDS,
  getDirect1RM,
  getEffective1RM,
  getEstimate1RM,
  getInputError,
  initialTM,
  isStep1Valid,
  isStep2Valid,
  isStep3Valid,
  setupReducer,
  T3_EXERCISES,
  T3_IDS,
  type EstimatedEntry,
  type EstimatedLiftId,
  type SetupAction,
  type SetupState,
  type SetupStep,
} from "../setupModel";
import { KgInput } from "./KgInput";

const STEP_LABELS: Record<SetupStep, string> = {
  1: "4대 운동 1RM",
  2: "추정값 검토",
  3: "T3 작업 중량",
  4: "설정 확인",
};

/** 추정 운동 1RM의 출처. 확정·수정해도 '직접 입력(측정) 1RM'으로 표시하지 않는다 */
const SOURCE_LABEL: Record<EstimatedEntry["source"], string> = {
  ESTIMATE: "자동 추정",
  ACCEPTED: "추정값 확정",
  EDITED: "사용자 수정",
};

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** 저장 모드의 저장소 상태 */
type StoreStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unavailable"; message: string }
  | { kind: "saving" }
  | { kind: "error"; message: string };

/**
 * 최초 설정(Setup) 화면.
 * 1) 4대 운동 1RM 직접 입력 → 2) 나머지 T1/T2 추정값 검토·수정 → 3) T3 작업 중량 → 4) 확인
 *
 * @param persistent true(/setup): 확정 시 IndexedDB에 저장하고, 저장된 설정이 있으면 복원해 읽기 전용으로 보여준다.
 *                   false(/prototype/setup): 저장하지 않는 Mock 프로토타입.
 */
export function SetupPrototype({ persistent = false }: { persistent?: boolean }) {
  const [state, dispatch] = useReducer(setupReducer, undefined, createInitialSetupState);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState<Set<SetupStep>>(() => new Set());
  const [store, setStore] = useState<StoreStatus>(() => (persistent ? { kind: "loading" } : { kind: "ready" }));

  // 저장된 설정 복원 (브라우저에서만 실행: 서버 렌더링 중에는 IndexedDB에 접근하지 않는다)
  useEffect(() => {
    if (!persistent) return;
    let cancelled = false;
    void (async () => {
      const db = getBrowserDatabase();
      if (!db) {
        if (!cancelled) setStore({ kind: "unavailable", message: "이 브라우저에서는 기기 저장소(IndexedDB)를 사용할 수 없습니다." });
        return;
      }
      const loaded = await getSavedSetup(db);
      if (cancelled) return;
      if (!loaded.ok) {
        setStore({ kind: "unavailable", message: "저장된 설정을 읽지 못했습니다. 새로고침해 주세요." });
        return;
      }
      const restored = restoreSetupState(loaded.value);
      if (restored.kind === "complete") dispatch({ type: "RESTORE", state: restored.state });
      if (restored.kind === "partial") {
        setStore({ kind: "unavailable", message: `저장된 설정이 일부 누락되었습니다 (${restored.missing.join(", ")}).` });
        return;
      }
      setStore({ kind: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [persistent]);

  /** '이대로 확정': 저장 모드는 저장 성공 후에만 완료 화면으로 넘어간다 */
  async function handleComplete() {
    if (!persistent) {
      dispatch({ type: "COMPLETE" });
      return;
    }
    const db = getBrowserDatabase();
    if (!db || store.kind === "saving") return;
    setStore({ kind: "saving" });
    const result = await confirmSetup(setupReducer(state, { type: "COMPLETE" }), (input) => saveInitialSetup(db, input));
    if (result.ok) {
      dispatch({ type: "RESTORE", state: result.state });
      setStore({ kind: "ready" });
      window.scrollTo({ top: 0 });
      return;
    }
    if (result.alreadySaved) {
      // 다른 탭에서 먼저 저장한 경우: 저장된 값을 보여준다 (덮어쓰지 않음)
      const loaded = await getSavedSetup(db);
      const restored = loaded.ok ? restoreSetupState(loaded.value) : null;
      if (restored?.kind === "complete") dispatch({ type: "RESTORE", state: restored.state });
    }
    setStore({ kind: "error", message: result.message });
  }

  if (persistent && (store.kind === "loading" || store.kind === "unavailable")) {
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 pt-4">
        <p className="text-xs font-semibold tracking-[0.12em] text-fg-secondary">NSUNS HYBRID · SETUP</p>
        <h1 className="text-2xl font-bold">초기 설정</h1>
        <p role={store.kind === "loading" ? "status" : "alert"} className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm text-fg-secondary">
          {store.kind === "loading" ? "저장된 설정을 불러오는 중…" : store.message}
        </p>
      </div>
    );
  }

  const showError = (fieldId: string) => touched.has(fieldId) || attempted.has(state.step);
  const touch = (fieldId: string) => setTouched((prev) => new Set(prev).add(fieldId));

  const stepValid =
    state.step === 1 ? isStep1Valid(state) : state.step === 2 ? isStep2Valid(state) : state.step === 3 ? isStep3Valid(state) : true;

  function goNext() {
    if (!stepValid) {
      setAttempted((prev) => new Set(prev).add(state.step));
      return;
    }
    if (state.step < 4) dispatch({ type: "GO_TO_STEP", step: (state.step + 1) as SetupStep });
    window.scrollTo({ top: 0 });
  }

  function goBack() {
    if (state.step > 1) dispatch({ type: "GO_TO_STEP", step: (state.step - 1) as SetupStep });
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-32 pt-4">
      <header>
        <p className="text-xs font-semibold tracking-[0.12em] text-fg-secondary">NSUNS HYBRID · SETUP</p>
        <h1 className="text-2xl font-bold">초기 설정</h1>
      </header>

      {persistent ? (
        <p className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-fg-secondary">
          설정은 <strong className="text-fg">이 기기의 브라우저</strong>에만 저장됩니다. 추정 1RM은 초기 설정을 돕는 추천값이며 실제
          측정값이나 원본 nSuns 공식이 아닙니다.
        </p>
      ) : (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          <strong className="font-bold">MOCK 프로토타입</strong> · 입력값은 저장되지 않습니다. 추정 1RM은 초기 설정을 돕는
          추천값이며 실제 측정값이나 원본 nSuns 공식이 아닙니다.
        </p>
      )}

      <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="설정 단계">
        {([1, 2, 3, 4] as SetupStep[]).map((step) => {
          const current = state.step === step;
          const done = state.completed || state.step > step;
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className={`rounded-lg px-1 py-2 text-center text-[11px] leading-tight ${
                current ? "bg-accent font-semibold text-on-accent" : done ? "bg-elevated text-fg" : "bg-surface text-fg-secondary"
              }`}
            >
              <span className="block font-bold">{done && !current ? "✓" : step}</span>
              {STEP_LABELS[step]}
            </li>
          );
        })}
      </ol>

      <main className="mt-5">
        {state.step === 1 && <DirectStep state={state} dispatch={dispatch} showError={showError} touch={touch} />}
        {state.step === 2 && <EstimateStep state={state} dispatch={dispatch} showError={showError} touch={touch} />}
        {state.step === 3 && <T3Step state={state} dispatch={dispatch} showError={showError} touch={touch} />}
        {state.step === 4 && (
          <ReviewStep
            state={state}
            persistent={persistent}
            saving={store.kind === "saving"}
            saveError={store.kind === "error" ? store.message : null}
            onComplete={() => void handleComplete()}
          />
        )}
      </main>

      {!state.completed && (
        <nav
          aria-label="단계 이동"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
          <div className="mx-auto flex max-w-[480px] gap-2 px-4 py-3">
            <button
              type="button"
              onClick={goBack}
              disabled={state.step === 1 || store.kind === "saving"}
              className="min-h-12 flex-1 rounded-xl border border-line px-4 text-sm font-medium disabled:opacity-35"
            >
              이전
            </button>
            {state.step < 4 && (
              <button
                type="button"
                onClick={goNext}
                aria-disabled={!stepValid}
                className={`min-h-12 flex-[2] rounded-xl px-4 text-sm font-bold ${
                  stepValid ? "bg-accent text-on-accent" : "bg-surface text-fg-muted"
                }`}
              >
                다음
              </button>
            )}
          </div>
          {!stepValid && attempted.has(state.step) && (
            <p role="alert" className="mx-auto max-w-[480px] px-4 pb-2 text-center text-xs text-danger">
              입력값을 확인해 주세요. 모든 값은 0보다 큰 숫자여야 합니다.
            </p>
          )}
        </nav>
      )}
    </div>
  );
}

type StepProps = {
  state: SetupState;
  dispatch: Dispatch<SetupAction>;
  showError: (fieldId: string) => boolean;
  touch: (fieldId: string) => void;
};

function StepIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{children}</p>
    </div>
  );
}

function DirectStep({ state, dispatch, showError, touch }: StepProps) {
  return (
    <section>
      <StepIntro title="4대 운동 1RM 입력">
        직접 측정했거나 알고 있는 1RM을 입력하세요. 초기 TM은 1RM의 90%로 계산됩니다.
      </StepIntro>
      <ul className="space-y-3">
        {DIRECT_LIFT_IDS.map((id) => {
          const fieldId = `direct-${id}`;
          const oneRm = getDirect1RM(state, id);
          return (
            <li key={id} className="rounded-2xl bg-surface p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="font-semibold">{DIRECT_LIFTS[id].name}</span>
                <span className="shrink-0 text-xs text-fg-secondary">{DIRECT_LIFTS[id].usage}</span>
              </div>
              <KgInput
                id={fieldId}
                label={`${DIRECT_LIFTS[id].name} 1RM (kg)`}
                value={state.direct[id]}
                error={getInputError(state.direct[id], showError(fieldId))}
                describedBy={`${fieldId}-tm`}
                onChange={(text) => dispatch({ type: "SET_DIRECT", id, text })}
                onBlur={() => touch(fieldId)}
              />
              <p id={`${fieldId}-tm`} className="mt-2 flex justify-between text-sm">
                <span className="text-fg-secondary">
                  직접 입력 1RM <span className="text-xs">→</span> 초기 TM (90%)
                </span>
                <span className="font-semibold tabular-nums">{oneRm === null ? "—" : `${formatKg(initialTM(oneRm))} kg`}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EstimateStep({ state, dispatch, showError, touch }: StepProps) {
  return (
    <section>
      <StepIntro title="나머지 T1/T2 운동 추정값 검토">
        4대 운동 1RM으로 계산한 초기 추천값입니다. 실제 값을 알고 있다면 수정하세요. 확정하거나 수정한 값은 기준 운동
        1RM을 바꿔도 자동으로 바뀌지 않습니다.
      </StepIntro>
      <ul className="space-y-3">
        {ESTIMATED_LIFT_IDS.map((id) => (
          <EstimateCard key={id} id={id} state={state} dispatch={dispatch} showError={showError} touch={touch} />
        ))}
        <li className="rounded-2xl border border-dashed border-line p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">스모 데드리프트</span>
            <span className="shrink-0 text-xs text-fg-secondary">목 T2</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
            1RM 입력이 필요하지 않습니다. 원본 nSuns Sumo Deadlift T2 템플릿을 사용할 예정이며, 세트 비율이 참조하는
            TM을 원본 시트에서 확인한 뒤 계산 방식을 확정합니다.
          </p>
          <span className="mt-2 inline-block rounded border border-warning/60 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
            원본 검증 대기 · 계산 없음
          </span>
        </li>
        <li className="rounded-2xl border border-dashed border-line p-4 text-sm text-fg-secondary">
          <span className="font-semibold text-fg">OHP (월 T2)</span>는 1단계의 OHP와 같은 운동 프로필·TM을 사용합니다.
        </li>
      </ul>
    </section>
  );
}

function EstimateCard({ id, state, dispatch, showError, touch }: StepProps & { id: EstimatedLiftId }) {
  const rule = ESTIMATE_RULES[id];
  const entry = state.estimated[id];
  const estimate = getEstimate1RM(state, id);
  const effective = getEffective1RM(state, id);
  const base = getEffective1RM(state, rule.baseId);
  const baseName = rule.baseId in DIRECT_LIFTS ? DIRECT_LIFTS[rule.baseId as keyof typeof DIRECT_LIFTS].name : ESTIMATE_RULES[rule.baseId as EstimatedLiftId].name;
  const fieldId = `estimated-${id}`;
  const inputValue = entry.source === "ESTIMATE" ? (estimate === null ? "" : formatKg(estimate)) : entry.text;
  const isLocked = entry.source !== "ESTIMATE";

  return (
    <li className={`rounded-2xl bg-surface p-4 ${isLocked ? "ring-1 ring-accent/40" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{rule.name}</span>
        <span className="shrink-0 text-xs text-fg-secondary">{rule.usage}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        <span className={`rounded border px-1.5 py-0.5 ${isLocked ? "border-accent/60 text-accent" : "border-line text-fg-secondary"}`}>
          {isLocked ? "🔒 " : ""}
          {SOURCE_LABEL[entry.source]}
        </span>
        <span className="rounded border border-fg-secondary/60 px-1.5 py-0.5 text-fg-secondary">Hybrid MVP 추천 비율</span>
      </div>
      <p id={`${fieldId}-formula`} className="mt-2 text-xs text-fg-secondary">
        추정: {baseName} {base === null ? "—" : `${formatKg(base)} kg`} × {percent(rule.ratio)} ={" "}
        <span className="tabular-nums text-fg">{estimate === null ? "—" : `${formatKg(estimate)} kg`}</span>
      </p>
      <div className="mt-2">
        <KgInput
          id={fieldId}
          label={`${rule.name} 1RM (kg)`}
          value={inputValue}
          error={getInputError(inputValue, isLocked && showError(fieldId))}
          describedBy={`${fieldId}-formula`}
          onChange={(text) => dispatch({ type: "EDIT_ESTIMATED", id, text })}
          onBlur={() => touch(fieldId)}
        />
      </div>
      <p className="mt-2 flex justify-between text-sm">
        <span className="text-fg-secondary">초기 TM (90%)</span>
        <span className="font-semibold tabular-nums">{effective === null ? "—" : `${formatKg(initialTM(effective))} kg`}</span>
      </p>
      <div className="mt-3 flex gap-2">
        {entry.source === "ESTIMATE" ? (
          <button
            type="button"
            disabled={estimate === null}
            onClick={() => dispatch({ type: "ACCEPT_ESTIMATE", id })}
            className="min-h-11 flex-1 rounded-xl border border-accent/60 px-3 text-sm font-medium text-accent disabled:opacity-35"
          >
            이 추정값으로 확정
          </button>
        ) : (
          <button
            type="button"
            onClick={() => dispatch({ type: "REVERT_ESTIMATE", id })}
            className="min-h-11 flex-1 rounded-xl border border-line px-3 text-sm"
          >
            자동 추정값으로 되돌리기{estimate === null ? "" : ` (${formatKg(estimate)} kg)`}
          </button>
        )}
      </div>
    </li>
  );
}

function T3Step({ state, dispatch, showError, touch }: StepProps) {
  return (
    <section>
      <StepIntro title="T3 (FST-7) 작업 중량">
        T3는 7세트 × 12회로 고정되며 1RM·TM을 사용하지 않습니다. 각 운동의 작업 중량을 직접 입력하세요.
      </StepIntro>
      <ul className="space-y-3">
        {T3_IDS.map((id) => {
          const info = T3_EXERCISES[id];
          const fieldId = `t3-${id}`;
          return (
            <li key={id} className="rounded-2xl bg-surface p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="font-semibold">{info.name}</span>
                <span className="shrink-0 text-xs text-fg-secondary">{info.usage} · 7×12</span>
              </div>
              <KgInput
                id={fieldId}
                label={`${info.name} 작업 중량 (kg)`}
                value={state.t3[id]}
                error={getInputError(state.t3[id], showError(fieldId))}
                describedBy={info.note ? `${fieldId}-note` : undefined}
                onChange={(text) => dispatch({ type: "SET_T3", id, text })}
                onBlur={() => touch(fieldId)}
              />
              {info.note && (
                <p id={`${fieldId}-note`} className="mt-1 text-xs text-warning">
                  {info.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type ReviewStepProps = {
  state: SetupState;
  persistent: boolean;
  saving: boolean;
  saveError: string | null;
  onComplete: () => void;
};

function ReviewStep({ state, persistent, saving, saveError, onComplete }: ReviewStepProps) {
  const pendingEstimates = ESTIMATED_LIFT_IDS.filter((id) => state.estimated[id].source === "ESTIMATE");

  return (
    <section>
      <StepIntro title={state.completed ? (persistent ? "저장된 설정" : "설정 완료 (Mock)") : "설정 확인"}>
        {state.completed
          ? persistent
            ? "이 기기에 저장된 설정입니다. 설정 수정(1RM·TM 재설정)은 정책 확정 전이라 아직 지원하지 않습니다 (U-05)."
            : "프로토타입 상태에서만 확정되었습니다. 실제로 저장되지 않으며 새로고침하면 초기화됩니다."
          : "값을 확인한 뒤 확정하세요. 수정하려면 '이전'으로 돌아가세요."}
      </StepIntro>

      <ReviewTable
        title="직접 입력 1RM"
        rows={DIRECT_LIFT_IDS.map((id) => {
          const value = getDirect1RM(state, id);
          return { key: id, name: DIRECT_LIFTS[id].name, badge: "직접 입력 1RM", oneRm: value, tm: value === null ? null : initialTM(value) };
        })}
      />
      <ReviewTable
        title="추정 기반 1RM (측정값 아님)"
        rows={ESTIMATED_LIFT_IDS.map((id) => {
          const value = getEffective1RM(state, id);
          const entry = state.estimated[id];
          return {
            key: id,
            name: ESTIMATE_RULES[id].name,
            badge: SOURCE_LABEL[entry.source],
            oneRm: value,
            tm: value === null ? null : initialTM(value),
          };
        })}
      />
      <p className="mb-4 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-fg-secondary">
        스모 데드리프트: 원본 Sumo T2 템플릿 기준 TM 확인 대기 (값 없음)
      </p>

      <section className="mb-4 rounded-2xl bg-surface p-4">
        <h3 className="text-sm font-semibold">T3 작업 중량 (7 × 12회)</h3>
        <dl className="mt-2 space-y-1 text-sm">
          {T3_IDS.map((id) => {
            const value = parsePositiveKg(state.t3[id]);
            return (
              <div key={id} className="flex justify-between gap-2">
                <dt className="text-fg-secondary">{T3_EXERCISES[id].name}</dt>
                <dd className="font-semibold tabular-nums">{value === null ? "—" : `${formatKg(value)} kg`}</dd>
              </div>
            );
          })}
        </dl>
        {persistent && (
          <p className="mt-2 text-[11px] leading-relaxed text-fg-secondary">
            FST-7 성공 시 증가 단위(초기 제안값): 덤벨 {SETUP_EQUIPMENT.dumbbell_lateral_raise.increment}kg(한 손), 그 외{" "}
            {SETUP_EQUIPMENT.lat_pulldown.increment}kg
          </p>
        )}
      </section>

      {state.completed && persistent ? (
        <div className="space-y-3">
          <p role="status" className="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-accent">
            ✓ 이 기기에 저장되었습니다
          </p>
          {saveError && (
            <p role="alert" className="rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
              {saveError}
            </p>
          )}
          <Link href="/workout" className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-bold text-on-accent">
            운동 기록하러 가기
          </Link>
        </div>
      ) : state.completed ? (
        <div className="space-y-3">
          <p role="status" className="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-accent">
            ✓ 초기 설정이 확정되었습니다 (Mock, 저장 안 됨)
          </p>
          <Link
            href="/prototype/workout"
            className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-bold text-on-accent"
          >
            Workout 프로토타입으로 이동
          </Link>
          <p className="text-center text-xs text-fg-secondary">
            Workout 프로토타입은 아직 Mock 세트 데이터를 사용합니다. 이 설정값은 전달되지 않습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingEstimates.length > 0 && (
            <p className="text-xs text-warning">
              자동 추정 상태인 값 {pendingEstimates.length}개는 확정 시 현재 값으로 고정됩니다.
            </p>
          )}
          {saveError && (
            <p role="alert" className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
              ⚠ {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={onComplete}
            disabled={saving}
            aria-busy={saving}
            className="min-h-12 w-full rounded-xl bg-accent px-4 font-bold text-on-accent disabled:opacity-60"
          >
            {persistent ? (saving ? "저장 중…" : saveError ? "다시 저장" : "이대로 확정하고 저장") : "이대로 확정 (Mock)"}
          </button>
        </div>
      )}
    </section>
  );
}

type ReviewRow = { key: string; name: string; badge: string; oneRm: number | null; tm: number | null };

function ReviewTable({ title, rows }: { title: string; rows: ReviewRow[] }) {
  return (
    <section className="mb-4 rounded-2xl bg-surface p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <table className="mt-2 w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-[11px] text-fg-secondary">
            <th scope="col" className="w-[44%] pb-1 font-medium">운동</th>
            <th scope="col" className="pb-1 text-right font-medium">1RM</th>
            <th scope="col" className="pb-1 text-right font-medium">초기 TM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line align-top">
              <th scope="row" className="py-2 pr-1 text-left font-normal">
                <span className="block">{row.name}</span>
                <span className="text-[11px] text-fg-secondary">{row.badge}</span>
              </th>
              <td className="py-2 text-right font-semibold tabular-nums">{row.oneRm === null ? "—" : formatKg(row.oneRm)}</td>
              <td className="py-2 text-right tabular-nums">{row.tm === null ? "—" : formatKg(row.tm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-right text-[11px] text-fg-secondary">단위 kg · 표시만 소수 둘째 자리</p>
    </section>
  );
}
