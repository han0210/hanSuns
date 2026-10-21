"use client";

type KgInputProps = {
  id: string;
  label: string;
  value: string;
  error: string | null;
  describedBy?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

/** kg 단위 숫자 입력 (모바일 소수점 키패드). 오류는 입력칸 바로 아래에 표시한다. */
export function KgInput({ id, label, value, error, describedBy, onChange, onBlur }: KgInputProps) {
  const errorId = `${id}-error`;
  const ariaDescribedBy = [describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="0"
          aria-invalid={Boolean(error)}
          aria-describedby={ariaDescribedBy}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`h-12 w-full rounded-xl border bg-elevated pl-3 pr-10 text-lg font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-fg-muted focus-visible:border-accent ${
            error ? "border-danger" : "border-line"
          }`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-secondary">kg</span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          ⚠ {error}
        </p>
      )}
    </div>
  );
}
