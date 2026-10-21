import Link from "next/link";

/** 운영 Dashboard가 구현되기 전 임시 진입 화면 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">nSuns Hybrid</h1>
      <p className="text-sm text-fg-secondary">운영 화면은 아직 구현되지 않았습니다.</p>
      <Link
        href="/prototype/setup"
        className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-on-accent"
      >
        초기 설정 프로토타입 열기
      </Link>
      <Link
        href="/prototype/workout"
        className="flex min-h-12 items-center justify-center rounded-xl border border-line px-4 font-semibold"
      >
        Workout UI 프로토타입 열기
      </Link>
    </main>
  );
}
