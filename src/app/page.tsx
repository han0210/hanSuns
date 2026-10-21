import Link from "next/link";

/** 시작 화면: 초기 설정과 운동 기록 진입. 저장 없는 디자인 프로토타입 링크는 아래에 둔다 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">nSuns Hybrid</h1>
      <p className="text-sm leading-relaxed text-fg-secondary">
        기록은 이 기기의 브라우저에만 저장됩니다. T1·T2는 원본 nSuns에서 착안한 Hybrid 자체 템플릿, T3는 FST-7입니다.
      </p>
      <Link href="/workout" className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-on-accent">
        운동 기록
      </Link>
      <Link href="/setup" className="flex min-h-12 items-center justify-center rounded-xl border border-line px-4 font-semibold">
        초기 설정
      </Link>
      <details className="rounded-xl border border-dashed border-line px-3 text-xs text-fg-secondary">
        <summary className="min-h-11 cursor-pointer py-3">디자인 프로토타입 (저장 안 됨)</summary>
        <div className="flex flex-col pb-2">
          <Link href="/prototype/setup" className="flex min-h-11 items-center underline">
            Setup 프로토타입 (Mock)
          </Link>
          <Link href="/prototype/workout" className="flex min-h-11 items-center underline">
            Workout 프로토타입 (Mock)
          </Link>
        </div>
      </details>
    </main>
  );
}
