# nSuns Hybrid

nSuns 5/3/1 기반 Hybrid 5-Day 운동 기록 웹앱 (MVP 개발 중).
기획·설계 문서는 `docs/`, AI 작업 규칙은 `CLAUDE.md`를 참고합니다.

## 현재 상태

- 구현된 화면: **Workout UI 프로토타입** (`/prototype/workout`)
- Mock 데이터만 사용합니다. 계산 엔진·Dexie(IndexedDB) 저장은 연결되어 있지 않으며,
  새로고침하면 상태가 초기화됩니다.
- 프로토타입 코드: `src/features/workout-prototype/`

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm install          # 최초 1회 (package-lock.json 기준)
npm run dev          # http://localhost:3000/prototype/workout
```

검증 명령:

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run build        # 프로덕션 빌드
```

모바일 확인은 브라우저 개발자 도구의 기기 모드에서 320 / 390 / 430px 너비로 확인합니다.
같은 Wi-Fi의 휴대폰에서는 `npm run dev -- -H 0.0.0.0` 실행 후 `http://<PC IP>:3000/prototype/workout`으로 접속할 수 있습니다.
