import type { Metadata } from "next";
import { WorkoutPrototype } from "@/features/workout-prototype/components/WorkoutPrototype";

export const metadata: Metadata = {
  title: "Workout 프로토타입 · nSuns Hybrid",
};

/** Workout UI 프로토타입 경로 (운영 경로 /workout/[day]와 분리) */
export default function WorkoutPrototypePage() {
  return <WorkoutPrototype />;
}
