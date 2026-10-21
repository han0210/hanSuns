import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest 설정: 계산 엔진 순수 함수 단위 테스트 (DOM 불필요 → node 환경)
 * "@/..." 경로 별칭은 tsconfig.json의 paths와 같게 맞춘다.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
