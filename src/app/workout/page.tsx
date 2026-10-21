import type { Metadata } from "next";
import { WorkoutScreen } from "@/features/workout/components/WorkoutScreen";

export const metadata: Metadata = {
  title: "운동 기록 · nSuns Hybrid",
};

/** 실제 운동 기록 (STEP 10 Lite: T3 FST-7 전용). 저장 없는 Mock은 /prototype/workout */
export default function WorkoutPage() {
  return <WorkoutScreen />;
}
