# nSuns Hybrid — DATAMODEL.md

> **버전:** v0.5 (2026-10-21, U-21·U-22 확정 반영, 완료 세트 잠금 강화, displayOrder / v0.4 STEP 09 Dexie 스키마 v1·저장 계층 구현 / v0.3 덤벨 한 손 기준 확정 / v0.2 Exercise·ExerciseProfile 분리, camelCase 확정, DIRECT 의미, 수정 차단 책임)
> **상태:** TypeScript 타입 확정 / Dexie 스키마 v1 구현 (UI 미연동)
> **코드:** `src/domain/types/model.ts`, `src/domain/types/weight.ts`, `src/storage/db.ts`, `src/storage/repositories/`
> **상위 문서:** `FUNCTIONS.md` 9·11장, `TECHSTACK.md` 5.4, `CALCULATION_RULES.md` 3·9장

---

## 1. 목적

Dexie(IndexedDB) 연동 전에 저장할 엔티티의 형태를 TypeScript 타입으로 고정한다. 계산 엔진(`src/domain/calculations/`)과 이후 저장 계층이 같은 타입을 쓴다.

## 2. 공통 원칙

| 원칙 | 내용 |
|---|---|
| 직렬화 | 모든 엔티티는 JSON 직렬화 가능한 평범한 객체. 날짜는 ISO 8601 문자열 |
| 필드 이름 | **camelCase로 확정** (TypeScript 타입과 Dexie 저장 모델 모두). snake_case 필드를 만들지 않는다 |
| 단위 | 중량 숫자는 엔티티의 `weightUnit`(kg / lb) 기준. 단위 간 자동 변환 없음. 다른 단위끼리 계산하면 `UNIT_MISMATCH` |
| 덤벨 중량 | `equipment: "DUMBBELL"`인 운동의 모든 중량 값(1RM·TM·작업 중량·증가 단위·목표·실제 중량)은 **한 손 기준**이다. 양손 합산 값을 저장하지 않는다. kg·lb 공통 (U-19 확정, CALCULATION_RULES H-16) |
| 불변성 | 모든 필드 `readonly`. 변경은 새 객체로 만든다 (컴파일 시점 제약, 5장 참고) |
| 완료 세트 | `CompletedSetRecord`는 실제 중량·반복·완료 시각이 반드시 있다 |
| 미확정 정책 | 타입으로 강제 확정하지 않는다 (7장) |

## 3. 관계

```text
Exercise 1 ─ 1 ExerciseProfile 1 ─ N TMChange          (exerciseId 기준, 프로필은 T1·T2 공통)
WorkoutSession 1 ─ N SessionExercise 1 ─ N SetRecord
SessionExercise.exerciseId → Exercise.exerciseId / ExerciseProfile.exerciseId
```

## 4. 엔티티

| 엔티티 | 핵심 필드 | 설명 |
|---|---|---|
| Exercise | exerciseId, name, equipment, weightUnit, increment, updatedAt | 운동 마스터. 사용자 기록과 무관한 운동 정보·단위·증가 단위 |
| ExerciseProfile | exerciseId, weightUnit, oneRepMax, oneRepMaxSource, estimateRuleId, initialTM, currentTM, t3WorkingWeight, t3WorkingWeightRevision, updatedAt | 사용자 기준 중량. `initialTM`은 파생값, `currentTM`은 독립 저장값. `t3WorkingWeightRevision`은 T3 작업 중량 변경 번호(v0.5) |
| WorkoutSession | sessionId, scheduledDay, workoutDate, status, startedAt, completedAt, schemaVersion | 하루 운동 |
| SessionExercise | sessionExerciseId, sessionId, exerciseId, tier, weightUnit, increment, templateId, templateVersion, tmAtSession, workingWeightAtSession, workingWeightRevisionAtSession, displayOrder, restSeconds, resetCount, lastResetAt, progressionEvaluatedAt | 세션 안의 운동 실행 단위. 운동별 리셋 대상, 세션 시작 스냅샷 보관. `progressionEvaluatedAt`은 하루 세션 완료 시 증량 판정을 마친 시각(v0.4, T3만 기록). `displayOrder`는 세션 안 표시 순서(v0.5). `workingWeightRevisionAtSession`은 T3 시작 시점 프로필 변경 번호(v0.5, U-22) |
| SetRecord | setRecordId, sessionExerciseId, setNumber, weightUnit, targetWeight, targetReps, isAmrap, manualTargetWeight, completed, actualWeight, actualReps, completedAt | `IncompleteSetRecord` / `CompletedSetRecord` 구분 |
| TMChange | tmChangeId, exerciseId, weightUnit, fromTM, toTM, reason, sourceSessionId, sourceTier, ruleId, ruleVersion, appliedAt | currentTM 변경 이력 |

### 4.1 Exercise와 ExerciseProfile의 분리

- **Exercise**는 운동 자체의 정보(이름, 장비, 단위, 증가 단위)다. 운동 목록·운동 변경 화면에서 쓰며 사용자 기록 값을 담지 않는다.
- **ExerciseProfile**은 그 운동에 대한 사용자의 기준 중량(1RM, TM, T3 작업 중량)이다.
- 두 엔티티는 `exerciseId`로 1:1 연결된다. 프로필의 `weightUnit`은 프로필 값의 단위를 스스로 밝히기 위해 두며, Exercise의 `weightUnit`과 같아야 한다. 불일치 검증은 STEP 09 서비스 계층에서 한다.
- `increment`는 Exercise에 둔다. 세션 시작 시 SessionExercise에 스냅샷으로 복사되므로, 이후 운동의 증가 단위를 바꿔도 진행 중·과거 세션은 바뀌지 않는다.

### 4.2 1RM 출처

| 값 | 의미 |
|---|---|
| `DIRECT` | 4대 운동 1RM을 사용자가 **직접 입력**함. 실제 측정 여부를 검증했다는 뜻이 아니다 |
| `ESTIMATE_ACCEPTED` | 초기 추천값을 그대로 확정 |
| `USER_EDITED` | 추천값을 사용자가 수정 |

`ESTIMATE_ACCEPTED`와 `USER_EDITED`는 확정·수정 후에도 `DIRECT`로 바꾸지 않으며, `estimateRuleId`로 출발 규칙을 남긴다.

### 4.3 저장하지 않고 계산하는 값

- 현재 세트 위치: `completed = false`인 첫 세트
- 운동 진행 상태(NOT_STARTED / IN_PROGRESS / COMPLETED): 소속 세트 완료 여부
- 자동 추천 1RM: 기준 1RM × 비율

## 5. 수정 차단의 책임 (readonly의 한계)

| 계층 | 막는 것 | 시점 |
|---|---|---|
| TypeScript 타입 (`readonly`, 완료 세트 타입) | 코드에서 완료 세트 필드에 대입하는 실수 | 컴파일 시점 (STEP 08-B 완료) |
| 서비스 계층 (`src/storage/repositories/`, STEP 09 구현) | 일반 세트 수정 요청으로 완료 세트를 바꾸는 것(`SET_LOCKED`), 중복 완료(`SET_ALREADY_COMPLETED`), 프로필·Exercise 단위 불일치(`UNIT_MISMATCH`), 완료·중도 종료 세션 리셋(`RESET_NOT_ALLOWED`) | 런타임 |
| Dexie 테이블 훅 (`src/storage/db.ts`, STEP 09 구현, v0.5 강화) | 서비스를 거치지 않은 직접 쓰기(`update`·`put`·`bulkPut`·`modify`·`delete`·`bulkDelete`·`where().delete()`·`clear()`)로 완료 세트를 바꾸거나 지우는 것, 실제값 없이 `completed = true`로 만드는 것 | 런타임 (`CompletedSetLockedError`·`InvalidSetRecordError` → 트랜잭션 롤백) |
| Dexie 트랜잭션·유일 인덱스 (STEP 09 구현) | 동시 요청(다른 탭 포함) 사이의 상태 변경, 리셋·완료·증량 저장의 부분 실패, 증량 이력 중복 | 런타임 (트랜잭션 안에서 상태 재확인, 실패 시 전체 롤백) |

`readonly`는 컴파일된 JavaScript와 IndexedDB에 저장된 데이터에는 아무 효과가 없다. 위 런타임 차단은 fake-indexeddb 기반 Vitest 테스트(`tests/unit/storage/`)로 검증했다. UI·기능 코드는 테이블을 직접 쓰지 않고 repositories 함수만 쓴다.

**완료 세트 잠금 해제 조건 (v0.5):** v0.4는 "4개 필드를 초기값으로 되돌리는 변경"이면 훅이 통과시켜, 서비스를 거치지 않은 직접 쓰기로도 잠금을 풀 수 있었다. v0.5부터는 아래를 **모두** 만족해야 한다.

1. `resetSessionExercise()`가 같은 트랜잭션 안에서 소속(세션↔운동)과 세션 상태(IN_PROGRESS·PAUSED)를 검증한 뒤 **그 트랜잭션에만 유효한 리셋 허가**(`db.grantExerciseReset`, 트랜잭션 객체를 키로 한 WeakMap)를 남겼다.
2. 변경 대상 세트가 허가된 세션·운동(`sessionExerciseId`)에 속한다. 같은 트랜잭션에서도 다른 운동의 세트는 거부한다.
3. 변경 내용이 정확히 4개 필드(`completed`·`actualWeight`·`actualReps`·`completedAt`)를 초기값으로 되돌리는 것이다.

하나라도 어기면 예외가 나고 트랜잭션 전체(같은 트랜잭션의 다른 쓰기 포함)가 롤백된다. 완료 세트 삭제는 어떤 경우에도 거부한다.

**한계:** 이 잠금은 앱 코드의 실수나 잘못된 호출 경로를 막는 장치다. 클라이언트 로컬 DB이므로 사용자가 브라우저 개발자 도구로 IndexedDB를 직접 수정·삭제하거나, 다른 코드가 `grantExerciseReset`을 남용하는 것까지 완벽히 막을 수는 없다. `grantExerciseReset`은 저장 계층 전용(@internal)이다.

## 6. 운동별 리셋과 증량 중복 방지

- 리셋은 `sessionExerciseId` 단위로 소속 SetRecord의 실제값·완료 상태를 초기화하고 `resetCount`·`lastResetAt`을 갱신한다 (CALCULATION_RULES 9.4). 목표값과 SessionExercise 스냅샷은 유지한다.
- 증량 중복 방지 키는 `(sourceSessionId, exerciseId, sourceTier)`이며 SessionExercise와 1:1로 대응한다. TMChange 테이블의 유일 복합 인덱스로 강제한다(최초 설정 INITIAL은 `sourceSessionId`가 null이라 인덱스에 들어가지 않는다).
- T3 작업 중량 증량은 TMChange를 쓰지 않으므로, `SessionExercise.progressionEvaluatedAt`과 "세션 상태가 IN_PROGRESS일 때만 완료 처리" 규칙으로 한 번만 반영한다.
- **세션 완료 조건 (U-21 확정):** 모든 예정 세트가 완료되어야 COMPLETED가 된다. 미완료 세트가 있으면 거부하며 T3 증량도 적용하지 않는다. 중도 종료는 ABANDONED로 별도 처리한다(후속 구현).
- **세션 중 T3 수정 우선 (U-22 확정):** 프로필 `t3WorkingWeightRevision`은 작업 중량이 바뀔 때마다 오르고, 세션 시작 시 `workingWeightRevisionAtSession`으로 복사된다. 완료 시 두 번호가 같을 때만 자동 증량을 반영한다. 사용자가 세션 도중 값을 바꿨다면(시작 값으로 되돌렸더라도) 사용자 값을 유지한다. 값 비교 대신 번호를 쓰는 이유는 "바꿨다가 되돌린" 경우를 구분하고, 휴대폰 시계 변경에 영향받지 않기 위해서다.

## 6.1 Dexie 스키마 v1 (`src/storage/db.ts`)

DB 이름 `nsuns-hybrid`, 스키마 버전 1. 기본 키는 모두 명시적 문자열 ID다(자동 증가 키 없음).

| 테이블 | 기본 키 | 인덱스 | 용도 |
|---|---|---|---|
| exercises | exerciseId | equipment | 장비별 조회 |
| exerciseProfiles | exerciseId | — | 운동당 1개 |
| workoutSessions | sessionId | status, workoutDate, startedAt | 진행 중 세션 조회(`status`), 날짜별 기록 |
| sessionExercises | sessionExerciseId | sessionId, exerciseId, **&[sessionId+exerciseId+tier]**, **&[sessionId+displayOrder]** | 세션별 운동, 같은 세션에 같은 운동·티어 중복 금지, 표시 순서 중복 금지 |
| setRecords | setRecordId | sessionExerciseId, sessionId, **&[sessionExerciseId+setNumber]** | 운동별 세트, 세트 번호 중복 금지 |
| tmChanges | tmChangeId | exerciseId, appliedAt, **&[sourceSessionId+exerciseId+sourceTier]** | 운동별 이력, 증량 중복 금지 |

`&`는 유일 인덱스, `[a+b]`는 복합 인덱스다. `completed`(boolean)는 IndexedDB 키가 될 수 없어 인덱스로 쓰지 않는다.

ID 규칙: `sessionId`·`tmChangeId`는 UUID(`createId()`, HTTP LAN 접속 대비 `getRandomValues` 대체 포함). `sessionExerciseId = ${sessionId}:${tier}:${exerciseId}`, `setRecordId = ${sessionExerciseId}#${setNumber}`.

스키마를 바꿀 때는 `SCHEMA_VERSION`을 올리고 Dexie `version(n).upgrade()`로 마이그레이션한다(아직 없음). v0.5의 필드·인덱스 추가는 저장 계층이 아직 어떤 화면에도 연결되지 않아 실제 사용자 DB가 없으므로 버전 1을 유지했다. UI 연결 이후의 스키마 변경부터는 반드시 버전을 올린다.

## 6.2 표시 순서와 유일 인덱스 검토 (v0.5)

- `displayOrder`는 `startWorkoutSession()`이 계획 배열 순서(0부터)로 붙인다. 호출자가 번호를 넘기지 않으므로 빈 번호·중복 번호가 생기지 않는다. 조회는 `displayOrder` 오름차순이며 ID 문자열 순서에 의존하지 않는다.
- `&[sessionId+displayOrder]` 유일 인덱스로 같은 세션의 순서 번호 중복을 막는다.
- 기존 `&[sessionId+exerciseId+tier]`와의 관계: 같은 세션에 같은 운동·같은 티어는 계획 검증(`INVALID_SESSION_PLAN`)과 인덱스로 이중 거부한다. 같은 운동을 **다른 티어**로 넣는 것(예: T1·T2 모두 OHP)은 키가 달라 충돌하지 않으며, 둘 다 공통 currentTM을 스냅샷한다(H-13). `sessionExerciseId`도 `${sessionId}:${tier}:${exerciseId}`로 서로 다르다.
- 같은 운동·같은 티어를 하루에 두 번 하는 루틴이 필요해지면 이 인덱스와 증량 멱등성 키(9.3)를 함께 다시 설계해야 한다. 현재 nSuns Hybrid 일정에는 해당 사례가 없다.

## 7. 타입으로 확정하지 않은 미확정 정책

| 항목 | 현재 타입 처리 | 관련 |
|---|---|---|
| lb 단위 지원 범위·기본 증가 단위 | `WeightUnit`에 `lb`는 있으나 kg↔lb 변환 없음 | U-20 |
| 원본 T1/T2 템플릿, 스모 데드리프트 기준 TM | `templateId`·`templateVersion`이 null 허용 | U-01, U-02, U-08, U-18 |
| 완료·중도 종료 세션의 리셋 | 저장 계층이 거부(`RESET_NOT_ALLOWED`). 허용 시 처리 정책은 미확정 | U-14, U-15 |
| 중도 종료(ABANDONED) 전환·재개 | 상태 값만 정의, 전환 함수는 후속 단계 | U-15 |
| 1RM 수정 시 currentTM 처리 | `TMChangeReason.USER_RESET`만 정의 | U-05 |
| 진행 중 T2 운동 변경 | SessionExercise 생성·교체 규칙 없음 | U-09 |
| 증가 단위 기본값 | Exercise 필드만 있고 기본값 없음 | FUNCTIONS 7.1 |

## 8. 변경 이력

- v0.5: U-21(모든 세트 완료 시에만 COMPLETED)·U-22(세션 중 사용자 T3 수정 우선, 변경 번호) 확정 반영, 완료 세트 잠금을 "리셋 허가 + 대상 운동 + 4개 필드" 조건으로 강화, `displayOrder`·`t3WorkingWeightRevision`·`workingWeightRevisionAtSession` 추가, 표시 순서·유일 인덱스 검토(6.2절)
- v0.4: STEP 09 — Dexie 스키마 v1(6.1절)과 저장 계층 구현, `SessionExercise.progressionEvaluatedAt` 추가, 수정 차단 책임(5장)을 구현 기준으로 갱신
- v0.3: 덤벨 중량 한 손 기준 확정 (U-19 RESOLVED). 모든 덤벨 운동 공통 규칙이라 운동별 표기 필드를 두지 않음
- v0.2: Exercise·ExerciseProfile 분리, camelCase 확정 (FUNCTIONS 11장 예시 갱신), DIRECT 의미 명시, 수정 차단 책임(5장) 추가
- v0.1: STEP 08-B 최초 작성
