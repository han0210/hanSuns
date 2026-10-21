import type { Metadata } from "next";
import { SetupPrototype } from "@/features/setup-prototype/components/SetupPrototype";

export const metadata: Metadata = {
  title: "초기 설정 프로토타입 · nSuns Hybrid",
};

/** 최초 설정 프로토타입 경로 (운영 경로 /setup과 분리) */
export default function SetupPrototypePage() {
  return <SetupPrototype />;
}
