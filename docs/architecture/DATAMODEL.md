# nSuns Hybrid — DATAMODEL.md

> **버전:** v0.2 (2026-10-21, STEP 08-B 검토 반영 — Exercise·ExerciseProfile 분리, camelCase 확정, DIRECT 의미, 수정 차단 책임)
> **상태:** TypeScript 타입 확정 / Dexie 스키마 미구현
> **코드:** `src/domain/types/model.ts`, `src/domain/types/weight.ts`
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
| ExerciseProfile | exerciseId, weightUnit, oneRepMax, oneRepMaxSource, estimateRuleId, initialTM, currentTM, t3WorkingWeight, updatedAt | 사용자 기준 중량. `initialTM`은 파생값, `currentTM`은 독립 저장값 |
| WorkoutSession | sessionId, scheduledDay, workoutDate, status, startedAt, completedAt, schemaVersion | 하루 운동 |
| SessionExercise | sessionExerciseId, sessionId, exerciseId, tier, weightUnit, increment, templateId, templateVersion, tmAtSession, workingWeightAtSession, restSeconds, resetCount, lastResetAt | 세션 안의 운동 실행 단위. 운동별 리셋 대상, 세션 시작 스냅샷 보관 |
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
| 서비스 계층 (STEP 09) | 일반 세트 수정 요청으로 완료 세트를 바꾸는 것, 프로필·Exercise 단위 불일치 | 런타임 |
| Dexie 트랜잭션 (STEP 09) | 동시 요청 사이의 상태 변경, 리셋·완료 저장의 부분 실패 | 런타임 (트랜잭션 안에서 상태 재확인, 실패 시 전체 롤백) |

`readonly`는 컴파일된 JavaScript와 IndexedDB에 저장된 데이터에는 아무 효과가 없다. 따라서 "완료 세트 개별 수정 금지", "운동별 리셋만 허용", "완료·중도 종료 세션 리셋 거부"는 STEP 09에서 서비스 계층과 Dexie 트랜잭션으로 구현하고, 통합 테스트로 검증해야 완료로 본다.

## 6. 운동별 리셋과 증량 중복 방지

- 리셋은 `sessionExerciseId` 단위로 소속 SetRecord의 실제값·완료 상태를 초기화하고 `resetCount`·`lastResetAt`을 갱신한다 (CALCULATION_RULES 9.4). 목표값과 SessionExercise 스냅샷은 유지한다.
- 증량 중복 방지 키는 `(sourceSessionId, exerciseId, sourceTier)`이며 SessionExercise와 1:1로 대응한다.

## 7. 타입으로 확정하지 않은 미확정 정책

| 항목 | 현재 타입 처리 | 관련 |
|---|---|---|
| 덤벨 중량 표기 기준 (한 손 / 양손 합계) | 필드 없음 | U-19 |
| lb 단위 지원 범위·기본 증가 단위 | `WeightUnit`에 `lb`는 있으나 kg↔lb 변환 없음 | U-20 |
| 원본 T1/T2 템플릿, 스모 데드리프트 기준 TM | `templateId`·`templateVersion`이 null 허용 | U-01, U-02, U-08, U-18 |
| 완료·중도 종료 세션의 리셋 | 상태 값만 정의, 허용 규칙은 코드에 없음 | U-14, U-15 |
| 1RM 수정 시 currentTM 처리 | `TMChangeReason.USER_RESET`만 정의 | U-05 |
| 진행 중 T2 운동 변경 | SessionExercise 생성·교체 규칙 없음 | U-09 |
| 증가 단위 기본값 | Exercise 필드만 있고 기본값 없음 | FUNCTIONS 7.1 |

## 8. 변경 이력

- v0.2: Exercise·ExerciseProfile 분리, camelCase 확정 (FUNCTIONS 11장 예시 갱신), DIRECT 의미 명시, 수정 차단 책임(5장) 추가
- v0.1: STEP 08-B 최초 작성
