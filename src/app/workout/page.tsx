import type { Metadata } from "next";
import { WorkoutScreen } from "@/features/workout/components/WorkoutScreen";

export const metadata: Metadata = {
  title: "운동 기록 · nSuns Hybrid",
};

/** 실제 운동 기록 (T1·T2 Hybrid 템플릿 + T3 FST-7). 저장 없는 Mock은 /prototype/workout */
export default function WorkoutPage() {
  return <WorkoutScreen />;
}
