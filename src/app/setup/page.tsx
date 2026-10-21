import type { Metadata } from "next";
import { SetupPrototype } from "@/features/setup-prototype/components/SetupPrototype";

export const metadata: Metadata = {
  title: "초기 설정 · nSuns Hybrid",
};

/** 최초 설정 (기기 IndexedDB에 저장). 저장 없는 Mock은 /prototype/setup */
export default function SetupPage() {
  return <SetupPrototype persistent />;
}
