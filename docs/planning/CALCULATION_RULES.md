# nSuns Hybrid — CALCULATION_RULES.md

> **프로젝트:** nSuns Hybrid 5-Day
> **문서 버전:** v0.10
> **문서 상태:** Draft — 설계 결정 반영 완료 / U-03·U-12·기록 잠금 및 운동별 리셋(H-14)·Setup 추정 제안(H-15, 4개 비율 승인) 확정 / 계산 상수(템플릿 비율·AMRAP 증량값) 검증 대기
> **작성일:** 2026-10-20
> **상위 문서:** `PTS.md`, `PRD.md`, `FUNCTIONS.md`, `TECHSTACK.md`
> **이전 버전:** `CALCULATION_RULES.v0.1.bak.md` (v0.1 백업)

### v0.9 → v0.10 변경 요약 (U-19 확정)

- **H-16 확정:** 덤벨 중량은 한 손 기준 (kg·lb 공통, 모든 덤벨 운동). U-19 RESOLVED (4.4절)
- 계산식 변경 없음. 목표 중량·작업 중량·증가 단위·실제 수행 중량이 모두 한 손 기준 값이 된다

### v0.8 → v0.9 변경 요약 (STEP 08-B — 계산 함수 TDD)

- 확정 규칙만 순수 함수로 구현: `validateWeightInput`, `calculateTM`, `roundToIncrement`, `estimateInitialOneRM`, `resolveInitialOneRepMaxes`, `evaluateFST7Progress` (10.13절)
- 모든 중량 계산은 단위(kg/lb)를 함께 받고, 단위가 다르면 `UNIT_MISMATCH` (U-20 신설: lb 지원 범위)
- T1 AMRAP 증량(U-04)·T2 증량(U-08)·T1/T2 세트 계산(U-01·U-02·U-08)·스모(U-18)는 미구현 유지

### v0.7 → v0.8 변경 요약 (STEP 07 마무리 — 추천 비율 승인)

- U-16(바벨 로우 0.55)·U-17(인클라인 0.85) **승인** → 4개 비율 모두 nSuns Hybrid MVP 초기 추천값 (3.6절)
- Mock 표시 규칙 삭제, 1RM 출처 구분 규칙 보강 (확정·수정해도 측정 1RM으로 취급하지 않음)
- U-18: 원본 Sumo Deadlift T2 후보 템플릿과 원본 시트 확인 결과 기록 (기준 TM은 여전히 미확정)
- 10.12절 테스트 갱신 (CR-SU-11 활성화)

### v0.6 → v0.7 변경 요약 (STEP 07 — 초기 1RM 설정)

- **H-15 신설:** Setup 초기 1RM 추정 제안과 출처·덮어쓰기 규칙 (3.6절)
- 프론트 스쿼트 0.80(MVP 추천), 슈러그 0.50×로우(Hybrid 규칙) 반영
- 바벨 로우 0.55(U-16), 인클라인 0.85(U-17)는 승인 대기 Mock, 스모 데드리프트 원본 검증(U-18), 덤벨 표기(U-19) 추가
- 7.1절 "비율 환산 금지" 규칙과의 관계 명시 (C-13), Setup 테스트 명세 10.12절 추가

### v0.5 → v0.6 변경 요약 (세트 완료 체크박스)

- 세트 완료 상태 정의: 체크박스 체크 → 입력값 검증 → 저장 성공 시에만 `completed = true` (9.4절)
- `currentSetIndex` 저장 제거, 현재 세트는 완료되지 않은 첫 세트로 계산
- 완료 상태 테스트 CR-CK-01~11 추가, CR-RS-03 수정 (10.10~10.11절)
- 계산 규칙·증량 판정 시점·주간 프로그램 변경 없음

### v0.4 → v0.5 변경 요약 (STEP 04 — 운동별 전체 세트 리셋)

- **H-14 리셋 범위 변경:** 하루 세션 전체 리셋 → 운동(SessionExercise)별 전체 세트 리셋 (9.4절)
- 스냅샷 위치를 SessionExercise(운동 단위)와 SetRecord(세트 단위)로 구분 (9.1절)
- 리셋은 실제 수행 데이터만 초기화, `manualTargetWeight` 포함 목표값 보존
- CR-RS 테스트 재정의 (10.10절)
- U-14·U-15는 미확정 유지

### v0.3 → v0.4 변경 요약 (기록 잠금·세션 리셋)

- **H-14 확정:** 세트 완료 후 기록 잠금, 기록 재입력은 진행 중 세션 리셋으로만 가능 (9.4절)
- 기존 "완료된 기록 수정 허용" 규칙 폐기 → U-07은 대체됨
- 완료된 세션 리셋 시 TM 증량 처리를 U-14로 신설 (확정 전 완료 세션 리셋 불허)
- ABANDONED 세션 리셋을 U-15로 신설
- 리셋 테스트 명세 추가 (10.10절)

### v0.2 → v0.3 변경 요약 (STEP 02)

- **U-03 확정:** 정확한 중간값은 높은 중량으로 반올림 (4.2절)
- **U-12 확정:** 동일 exerciseId는 T1·T2에서 하나의 프로필·currentTM 공유 (3.2절, 7.6절)
- T2 currentTM 변경 경로, AMRAP 증량의 공통 TM 반영 설명 수정 (6.4절, 7.5절)
- 공통 TM 테스트 명세(10.9절)와 반올림 경계 테스트 활성화
- 기존 기획 문서 충돌 C-01~C-11 해결 현황 갱신 (11.2절)

### v0.1 → v0.2 변경 요약

- 요청된 11개 장 구성으로 재편
- 규칙마다 **출처 태그**(`[원본]`, `[Hybrid]`, `[미확정]`)를 부착
- TM 상태 모델(`input1RM` / `initialTM` / `currentTM`)과 TM 이력 구조를 구체화
- T2 운동 변경 시 **진행 중 세션의 완료 세트 처리 규칙** 추가
- 검증 대기 수치(T1 세트 수, AMRAP 증량 범위)를 규칙 본문에서 제거하고 11장 승인 항목으로 이동
- Vitest 테스트 명세를 함수 단위 `describe` 구조로 재작성하고, 미승인 상수 의존 테스트를 `it.todo`로 분리
- 기존 기획 문서와의 충돌 목록을 11장에 명시

---

## 1. 문서 목적

이 문서는 nSuns Hybrid 계산 엔진의 **단일 기준 명세(Single Source of Truth)** 다.

계산 엔진의 책임 범위는 다음과 같다.

1. T1·T2의 Training Max(TM) 계산 및 상태 관리
2. 세트 템플릿을 적용한 세트별 목표 중량 계산
3. 운동별 증가 단위에 맞춘 최종 중량 반올림
4. T1 AMRAP 결과 기반 다음 세션 TM 조정
5. T2 운동 변경 시 자동 중량 스케일링
6. T3 FST-7 수행 결과 기반 작업 중량 증량
7. 계산 결과와 과거 수행 기록의 일관성 보장

### 1.1 적용 원칙

| 원칙 | 내용 |
|---|---|
| 순수성 | 계산 함수는 React, Dexie(IndexedDB), 브라우저 API에 의존하지 않는 순수 TypeScript 함수로 구현한다. |
| 결정성 | 같은 입력과 같은 템플릿 버전은 항상 같은 결과를 반환한다. |
| 검증 게이트 | `verified` 상태가 아닌 템플릿·상수를 사용하는 계산은 결과를 생성하지 않고 **차단 사유**를 반환한다. |
| 비파괴성 | 완료된 세션 기록은 계산 엔진이 절대 수정하지 않는다. |
| 추적성 | 모든 자동 증량은 적용 규칙 ID·버전과 함께 이력으로 남긴다(PRD AC-06 "계산 근거 확인" 대응). |

### 1.2 출처 태그

| 태그 | 의미 |
|---|---|
| `[원본]` | nSuns 원본 프로그램에서 가져와야 하는 규칙. 원본 자료 대조 전에는 수치를 등록하지 않는다. |
| `[Hybrid]` | 본 프로젝트가 확정한 자체 규칙. 원본 nSuns에는 없다. |
| `[미확정]` | 승인 전 규칙. 운영 계산에 사용하지 않는다. 11장에서 관리한다. |

---

## 2. 원본 nSuns와 Hybrid 규칙 구분

### 2.1 원본 nSuns에서 가져올 규칙 `[원본]`

다음 항목은 **원본 자료와 대조한 뒤** 템플릿 데이터로 등록한다. 현재 모두 검증 대기 상태다.

| 항목 | 사용처 | 상태 |
|---|---|---|
| T1 운동별 세트 수·반복 횟수·TM 대비 강도 비율 | 5장 | 검증 대기 |
| "5/3/1 벤치형" T1 템플릿의 정확한 세트 데이터 | 5.3절 바벨 로우 | 검증 대기 |
| 진행 판정에 쓰이는 AMRAP 세트(1+ 세트)의 위치 | 6장 | 검증 대기 |
| AMRAP 반복 횟수 구간별 TM 증량 범위 | 6장 | 검증 대기 |
| T2 원본 세트별 반복·강도 비율 | 7장 | 검증 대기 |

### 2.2 Hybrid 자체 규칙 `[Hybrid]`

| ID | 규칙 | 관련 장 |
|---|---|---|
| H-01 | TM = 입력 1RM × 90% | 3장 |
| H-02 | 운동별 독립 TM 관리, 초기 TM과 현재 TM 구분 | 3장 |
| H-03 | 내부 TM은 반올림하지 않고, 최종 세트 중량만 운동별 증가 단위로 반올림 | 4장 |
| H-04 | 토요일 T1 바벨 로우 추가, "일반 5/3/1 벤치형" T1 템플릿 재사용 | 5.3절 |
| H-05 | AMRAP 증량은 원본 증량 **범위 내의 고정값**으로 자동 적용 (값 미확정) | 6장 |
| H-06 | T2 종목 변경 가능, 운동 유형별 지원 템플릿 적용 | 7장 |
| H-07 | T2 운동마다 독립 1RM·TM 사용 (다른 운동의 값을 빌려 쓰지 않음) | 7장 |
| H-08 | T2 운동 변경 시 전체 세트 중량 자동 재계산, 기존 기록 보존 | 7·9장 |
| H-09 | T3 FST-7: 12회 × 7세트 고정, 운동별 작업 중량 직접 입력 | 8장 |
| H-10 | T3: 7세트 모두 12회 이상 + 목표 중량 이상 수행 시 다음 세션 한 단계 증량 | 8장 |
| H-11 | 주 5일 스케줄(월·화·목·금·토) | PTS 5.1 |
| H-12 | 정확한 중간값은 높은 중량으로 반올림 (v0.3 확정, 구 U-03) | 4.2절 |
| H-13 | 동일 exerciseId는 T1·T2에서 공통 프로필·currentTM 사용 (v0.3 확정, 구 U-12) | 3.2절, 7.6절 |
| H-14 | 세트 완료 후 기록 잠금, 재입력은 운동별 전체 세트 리셋으로만 허용 (v0.4 확정, v0.5 범위 변경) | 9.4절 |
| H-15 | Setup 초기 1RM 추정 제안: 4대 운동 직접 입력, 나머지는 추천값 → 사용자 확정 후 자체 1RM (v0.7, v0.8 비율 4개 승인) | 3.6절 |
| H-16 | 덤벨 중량은 한 손 기준으로 입력·표시·저장, 양손 합산 없음, kg·lb 공통 (v0.10 확정, 구 U-19) | 4.4절 |

> **참고:** 원본 nSuns는 T2 보조 운동의 중량을 관련 T1 리프트의 TM으로 계산하는 구조로 알려져 있다. Hybrid는 H-07에 따라 T2 운동마다 독립 TM을 쓰므로, 원본 T2 비율을 그대로 적용해도 결과 중량이 원본과 달라질 수 있다. 이 차이는 의도된 Hybrid 변형이며, 원본 구조 자체는 2.1의 원본 대조 시 함께 확인한다.

---

## 3. TM 계산 및 상태 관리

### 3.1 초기 TM `[Hybrid H-01]`

```text
initialTM = input1RM × 0.9
```

| input1RM | initialTM |
|---|---|
| 100kg | 90kg |
| 82.5kg | 74.25kg (반올림하지 않음) |

`initialTM`은 반올림하지 않는다(H-03).

### 3.2 TM 상태 모델 `[Hybrid H-02]`

TM은 운동(exerciseId) 단위로 관리한다. **같은 exerciseId를 T1과 T2에서 사용하면 하나의 프로필(input1RM, initialTM, currentTM, tmHistory)을 공유한다**(H-13). 서로 다른 exerciseId는 완전히 독립이다.

| 필드 | 타입 | 의미 | 변경 주체 |
|---|---|---|---|
| `exerciseId` | string | 운동 식별자 | — |
| `input1RM` | number | 사용자가 입력한 1RM | 사용자 |
| `initialTM` | number | `input1RM × 0.9` 파생값 | 1RM 입력 시 계산 |
| `currentTM` | number | 다음 세션 계산에 쓰는 현재 TM | 자동 증량 / 사용자 승인 재설정 |
| `tmHistory` | TMChange[] | `currentTM` 변경 이력 | 계산 엔진 |

`TMChange` 구조:

| 필드 | 의미 |
|---|---|
| `from` / `to` | 변경 전·후 TM |
| `reason` | `INITIAL` / `AMRAP_PROGRESSION` / `USER_RESET` |
| `sourceSessionId` | 증량 근거 세션 (AMRAP_PROGRESSION일 때) |
| `sourceTier` | 증량 근거 티어 (공통 프로필에서 어느 티어가 변경을 일으켰는지 추적) |
| `ruleId`, `ruleVersion` | 적용 규칙 식별 |
| `appliedAt` | 적용 시각 |

### 3.3 상태 전이

```text
[1RM 최초 입력]
   input1RM = x
   initialTM = x × 0.9
   currentTM = initialTM            (reason: INITIAL)

[세션 완료 + AMRAP 증량 승인 규칙 존재]
   currentTM = currentTM + Δ        (reason: AMRAP_PROGRESSION, 6장)

[사용자가 1RM 수정]
   input1RM, initialTM 갱신
   currentTM 처리 → [미확정] U-05 (사용자 확인 없이 암묵적으로 초기화하지 않음)
```

### 3.4 기존 문서와의 관계

FUNCTIONS.md v1.0의 11.2절은 `training_max`를 "1RM으로 재계산 가능한 파생값"으로 정의했다(v1.1에서 `initial_tm`/`current_tm`으로 수정됨). 그러나 AMRAP 증량이 발생하면 `currentTM`은 더 이상 1RM에서 도출할 수 없다. 따라서 본 문서는 **`initialTM`만 파생값**으로, **`currentTM`은 독립 저장값**으로 정의한다(11장 충돌 C-04).

### 3.5 유효성 검사

| 입력 | 처리 |
|---|---|
| 0 이하 | `INVALID_1RM` 오류 |
| `NaN`, `Infinity`, 숫자가 아닌 값 | `INVALID_1RM` 오류 |
| 미입력 | 계산하지 않고 `MISSING_1RM` 반환 (임의 값 생성 금지) |
| 비정상적으로 큰 값 | 계산은 수행하되 UI 확인 절차 필요 — 상한 기준은 [미확정] U-11 |

### 3.6 초기 1RM 추정 제안 (Setup) `[Hybrid H-15]` — v0.7 신설

최초 설정에서 사용자는 4대 운동(벤치프레스, 컨벤셔널 데드리프트, 백 스쿼트, OHP)의 1RM만 직접 입력한다. 나머지 T1/T2 운동은 아래 규칙으로 **초기 1RM 추천값**을 보여준다.

> 이 비율은 "처음 입력할 1RM을 제안"하는 용도다. T1/T2 세트별 강도 비율(원본 nSuns 템플릿, 5·7장)과는 무관하며, 운동 간 검증된 환산 공식도 아니다. 화면에서 실제 측정 1RM으로 표시하지 않는다. 직접 입력 1RM(`DIRECT`)도 사용자가 입력한 값일 뿐 측정 검증을 뜻하지 않는다.

| 운동 | 기준 | 비율 | 상태 |
|---|---|---|---|
| 프론트 스쿼트 (화 T2) | 백 스쿼트 1RM | 0.80 | 승인 — MVP 초기 추천값 |
| 바벨 로우 (토 T1) | 컨벤셔널 데드리프트 1RM | 0.55 | 승인 — MVP 초기 추천값 (v0.8, 구 U-16) |
| 인클라인 벤치프레스 (금 T2) | 벤치프레스 1RM | 0.85 | 승인 — MVP 초기 추천값 (v0.8, 구 U-17) |
| 바벨 슈러그 (토 T2) | 바벨 로우 기준 1RM (사용자 확정값 우선) | 0.50 | 승인 — MVP 초기 추천값 |
| 스모 데드리프트 (목 T2) | — | — | **[미확정] U-18** — 기준 TM 확인 전 값 없음 |
| OHP (월 T2) | — | — | 추정 없음. 1단계 OHP와 같은 프로필 (H-13) |

4개 비율은 nSuns Hybrid의 MVP 초기 추천값으로 승인되었다. 원본 nSuns 공식 환산 비율로 설명하지 않는다. 슈러그는 바벨 로우의 현재 기준 1RM(사용자가 확정·수정한 값 우선)에 0.50을 곱한다.

#### 스모 데드리프트 후보 템플릿 `[원본]` — U-18 검증 대기

원본 nSuns Sumo Deadlift T2 템플릿을 사용하기로 했다. 공개 프로그램 자료에 공통으로 제시되는 구성은 다음과 같다.

| 세트 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| 반복 | 5 | 5 | 3 | 5 | 7 | 4 | 6 | 8 |
| TM 비율 | 50% | 60% | 70% | 70% | 70% | 70% | 70% | 70% |

참고 시트: [nSuns 원본 스프레드시트](https://docs.google.com/spreadsheets/d/1z0cbO0u7P1fwcTWRE6tP_snaDCm8DO04oEELuYK1hto/edit)

2026-10-21 시트 확인 결과 (값만 보이고 수식은 보이지 않음):

- 5-Day 시트의 Sumo Deadlift(화요일) 행은 8세트이며, 반복은 위 표와 같다.
- 시트에 Sumo 전용 TM은 없다. 예시 TM은 Deadlift·Squat·Bench·OHP가 **모두 65**로 같아서, 무게(35·40·45)만으로는 어느 TM을 참조하는지 구분할 수 없다.
- 무게는 65 × 50·60·70%를 5 단위로 반올림한 값과 일치한다 (추론이며, 시트가 수식으로 보여준 값은 아님).

따라서 **기준 TM은 여전히 미확정**이다. 계산 엔진에 적용하지 않는다. 이 템플릿을 채택하면 H-07(T2 독립 TM)과의 관계도 함께 정해야 한다.

#### 추정값 출처와 덮어쓰기 규칙

| 출처 | 의미 | 기준 1RM 변경 시 |
|---|---|---|
| 직접 입력 | 4대 운동 1RM | — |
| 자동 추정 | 기준 1RM × 비율 | 다시 계산 |
| 추정값 확정 | 사용자가 추정값을 그대로 확정 | 바뀌지 않음 |
| 직접 수정 | 사용자가 값을 수정 | 바뀌지 않음 |

- 추천값은 설정 확정 전까지 TM·세트 계산에 쓰지 않는다. 설정을 확정하면 자동 추정 상태의 값은 그 시점 값으로 확정되고, 이후 해당 운동의 **자체 input1RM**이 된다 (H-07 독립 TM 유지).
- 확정 후 `initialTM = input1RM × 0.9`, `currentTM = initialTM` (3.1절)을 그대로 적용한다. 추정값 자체도 반올림하지 않는다.
- 한 운동의 값을 바꿔도 다른 운동의 확정·수정값은 바꾸지 않는다. 이미 시작한 세션의 스냅샷도 바꾸지 않는다 (9.1절).
- T3는 추정을 적용하지 않는다. 운동별 작업 중량을 직접 입력한다 (8.2절).

---

## 4. 세트별 중량 계산과 반올림

### 4.1 계산식 `[Hybrid H-03]`

```text
rawWeight    = currentTM × intensityRatio      // 반올림하지 않음
targetWeight = roundToIncrement(rawWeight, increment)
```

- `intensityRatio`는 `verified` 상태 템플릿에서만 가져온다.
- 반올림은 **최종 세트 목표 중량에서 단 한 번** 수행한다. TM, 중간 계산값은 반올림하지 않는다.

### 4.2 `roundToIncrement` 규칙

```text
roundToIncrement(weight, increment)
  = (weight / increment 를 가장 가까운 정수로 반올림, 정확히 .5면 올림) × increment
```

| 입력 weight | increment | 결과 | 비고 |
|---|---|---|---|
| 73.4 | 2.5 | 72.5 | FUNCTIONS TC-002와 일치 |
| 62 | 2.5 | 62.5 | |
| 63 | 2.5 | 62.5 | |
| 64 | 2.5 | 65 | |
| 61.25 | 2.5 | **62.5** | 정확한 중간값 → 높은 쪽 (H-12) |
| 61.24 | 2.5 | 60 | 중간값 미만 → 가까운 쪽 |
| 61.26 | 2.5 | 62.5 | 중간값 초과 → 가까운 쪽 |

**확정 (v0.3, 구 U-03):** 양수 중량 기준 가장 가까운 사용 가능 중량을 고르고, 정확히 두 단계의 중간값이면 **높은 중량**을 선택한다. 반올림은 최종 세트 목표 중량에만 적용하며, 사용자는 세트 완료 전까지 실제 수행 중량을 직접 입력·수정할 수 있다(9.4절).

### 4.3 부동소수점 처리 요구사항

- 결과는 `increment`의 정확한 배수여야 한다. 예: `72.49999999` 같은 값을 반환하면 안 된다.
- `0.1 + 0.2` 유형의 오차가 중간값 판정을 뒤집지 않아야 한다(예: 이론상 61.25인 값이 61.2499999로 계산되어 내림 처리되는 경우).
- 구현 방식(정수 스케일링 등)은 구현 단계에서 결정하되, 위 두 조건을 테스트로 고정한다.

### 4.4 증가 단위(`increment`)

| 항목 | 규칙 |
|---|---|
| 저장 위치 | 운동별 설정 |
| 유효 조건 | 0보다 큰 유한한 숫자 |
| 덤벨 `[Hybrid H-16]` | 덤벨 운동 중량은 kg·lb 모두 **한 손 기준**으로 입력·표시·저장하며 양손 중량을 합산하지 않는다. 모든 덤벨 운동에 동일하게 적용한다. 증가 단위·목표 중량·작업 중량·실제 수행 중량 모두 한 손 기준 값이며, 계산식은 바벨과 같다 |
| 단위 변경 시 | **시작 전** 세트만 재계산. 완료된 세트·과거 세션은 재계산하지 않음 |
| 이중 용도 | 반올림 단위이자 T3 "한 단계" 증량 폭(8장)으로 사용 |

기본 증가 단위값(바벨 2.5kg 등)은 FUNCTIONS 7.1의 "초기 제안값"이며 계산 규칙상 상수가 아니다.

### 4.5 반올림 결과의 하한

`rawWeight`가 매우 작을 때 반올림 결과가 0kg이 되거나, 빈 바(바벨 자체 무게)보다 가벼운 값이 나올 수 있다. 최소 중량 처리는 [미확정] U-10이며, 승인 전에는 **0 이하 결과를 오류로 처리**한다.

---

## 5. T1 템플릿 및 바벨 로우

### 5.1 요일별 T1과 템플릿 매핑

| 요일 | T1 운동 | 적용 템플릿 | 출처 | 상태 |
|---|---|---|---|---|
| 월 | 벤치프레스 | 원본 대응 템플릿 | `[원본]` | 매핑·데이터 검증 대기 |
| 화 | 데드리프트 | 원본 대응 템플릿 | `[원본]` | 매핑·데이터 검증 대기 |
| 목 | 스쿼트 | 원본 대응 템플릿 | `[원본]` | 매핑·데이터 검증 대기 |
| 금 | OHP | 원본 대응 템플릿 | `[원본]` | 매핑·데이터 검증 대기 |
| 토 | 바벨 로우 | 일반 5/3/1 벤치형 재사용 | `[Hybrid H-04]` | 결정 확정 / 세트 데이터 검증 대기 |

Hybrid 주간 스케줄은 원본 5-Day 구성과 요일·종목 배치가 다를 수 있으므로, **각 Hybrid 요일이 원본의 어느 템플릿에 대응하는지**도 원본 대조 시 함께 확정한다(U-01).

### 5.2 템플릿 데이터 구조

```text
T1Template {
  templateId:      string        // 예: "t1-531-bench"
  templateVersion: number
  source:          "ORIGINAL" | "HYBRID"
  status:          "verified" | "pending"
  sets: T1Set[]
}

T1Set {
  setNumber:      number
  targetReps:     number
  intensityRatio: number         // TM 대비 비율 (0~1 이상 가능)
  isAmrap:        boolean
  isProgressionAmrap: boolean    // 증량 판정용 AMRAP 여부 (6장)
}
```

- 세트 수, `targetReps`, `intensityRatio` 값은 **원본 검증 전 등록 금지**.
- `status: "pending"` 템플릿으로 `calculateT1Sets()`를 호출하면 `TEMPLATE_NOT_VERIFIED`를 반환한다.
- 계산 엔진은 휴식 시간(`rest_seconds`)을 참조하지 않는다. 템플릿 데이터에 휴식 기본값을 함께 둘지는 타이머 설계에서 정하며, 계산 결과에는 영향이 없다.

### 5.3 바벨 로우 T1 `[Hybrid H-04]`

**확정:** 바벨 로우는 "일반 5/3/1 벤치형" T1 템플릿을 재사용한다.

| 항목 | 규칙 |
|---|---|
| 1RM | 바벨 로우 전용 값 입력 |
| TM | 바벨 로우 전용 `initialTM`·`currentTM` (벤치프레스 TM과 공유하지 않음) |
| 세트 구조 | 벤치형 템플릿의 세트 수·반복·강도 비율을 동일하게 사용 |
| 템플릿 참조 | 데이터 복제 대신 같은 `templateId`를 참조 → 원본 수정 시 동기화 |
| AMRAP | 벤치형 템플릿의 AMRAP 표시를 그대로 따름 |
| 증량 이력 | 바벨 로우 단독으로 관리 |
| 표시 | 원본 nSuns 운동이 아닌 Hybrid 추가 운동임을 UI에 명시 |

주의:

- "일반 5/3/1 벤치형"이 원본의 **어느 운동일 템플릿**을 가리키는지 `templateId` 수준으로 특정해야 한다(U-02).
- 원본 템플릿 재사용이 바벨 로우에 적합한 강도라는 보장은 없다. 실제 훈련 검증 대상이다.
- 바벨 로우 AMRAP 증량값을 벤치프레스와 같게 할지는 6장 U-04에 포함해 결정한다.

---

## 6. AMRAP 자동 증량

### 6.1 확정 원칙 `[Hybrid H-05]`

- AMRAP 결과에 따른 TM 증량은 **원본 nSuns가 제시하는 증량 범위 안에서 선택한 단일 고정값**을 쓴다.
- 범위 자체는 `[원본]`, 범위 안에서 고정값을 고르는 것은 `[Hybrid]` 규칙이다.
- **구체적인 구간 경계와 증량값은 미확정**이다(U-04). 승인 전에는 자동 증량을 실행하지 않는다.

### 6.2 증량 규칙 데이터 구조

수치는 비워 두고 구조만 정의한다.

```text
AmrapProgressionRule {
  ruleId:      string
  ruleVersion: number
  status:      "verified" | "pending"
  appliesTo:   exerciseId[] | "ALL_T1"
  brackets: [
    { minReps: number, maxReps: number | null, tmIncreaseKg: number }
  ]
}
```

- `brackets`는 겹치거나 빈 구간이 없어야 한다(테스트 대상).
- 원본 증량값이 lb 단위라면 kg 변환 방식도 함께 확정한다(U-04-c).
- `tmIncreaseKg`는 TM에 더하는 값이므로 **TM 자체는 반올림하지 않는다**(H-03). 세트 중량에서만 반올림된다.

### 6.3 판정 입력

| 입력 | 규칙 |
|---|---|
| 판정 대상 세트 | 템플릿의 `isProgressionAmrap = true` 세트 1개 |
| 그 외 AMRAP 세트 | 기록만 하고 증량 판정에 중복 사용하지 않음 |
| 실제 반복 횟수 | 사용자가 입력한 `actualReps` |
| 실제 중량 | `actualWeight`가 해당 세트 `targetWeight` 미만이면 처리 정책 [미확정] U-06 |
| 판정 세트 미완료·미입력 | 처리 정책 [미확정] U-06 — 승인 전에는 **TM 유지** |

### 6.4 적용 시점과 중복 방지

```text
세션 완료(COMPLETED)
  → evaluateT1Progress(session, rule)
  → nextTM = currentTM + Δ
  → 다음 해당 운동 세션부터 적용
```

- 이미 계산·시작된 세션의 세트 중량은 변경하지 않는다.
- 증량은 운동 프로필의 공통 `currentTM`에 반영되므로, 같은 exerciseId를 쓰는 T2의 **아직 시작하지 않은** 세션에도 적용된다(7.6절).
- 같은 세션의 완료 이벤트가 두 번 들어와도 증량은 한 번만 반영한다(멱등성 키: `sessionId + exerciseId + tier`).
- 완료된 세트·세션 기록은 수정할 수 없으므로(H-14) 기록 수정에 따른 TM 재계산은 발생하지 않는다.
- 완료된 세션의 운동을 리셋할 때 이미 적용된 증량을 어떻게 처리할지는 [미확정] U-14이며, 확정 전에는 완료된 세션의 운동 리셋을 허용하지 않는다.

---

## 7. T2 운동 유형별 스케일링

### 7.1 핵심 계산 `[Hybrid H-06, H-07]`

```text
선택 운동 → 해당 운동의 currentTM 조회
         → 운동 유형으로 지원 템플릿 조회
         → rawWeight = currentTM × intensityRatio
         → roundToIncrement(rawWeight, 해당 운동 increment)
```

- 다른 운동의 1RM·TM을 복사하거나 비율로 환산해 쓰지 않는다. 단, 최초 설정의 추천값(3.6절)은 사용자가 확정한 뒤 해당 운동의 자체 1RM이 되므로 이 규칙과 충돌하지 않는다. 운동 교체 시 자동 환산은 여전히 하지 않는다.
- 선택 운동에 1RM이 없으면 `MISSING_1RM`을 반환하고 입력을 요청한다.

### 7.2 운동 유형별 템플릿

```text
T2Template {
  templateId, templateVersion, status
  exerciseType:          string        // 예: PRESS, SQUAT, HINGE, ...
  supportedExerciseIds:  string[]
  sets: { setNumber, targetReps, intensityRatio }[]
}
```

| 유형(후보) | 기본 스케줄 운동 | 템플릿 상태 |
|---|---|---|
| 프레스형 | OHP, 인클라인 벤치프레스 | 비율 검증 대기 |
| 스쿼트형 | 프론트 스쿼트 | 비율 검증 대기 |
| 힙힌지형 | 스모 데드리프트 | 비율 검증 대기 |
| 미분류 | 슈러그 | 지원 여부 자체가 미확정(U-08) |

유형 분류는 설계 후보이며, 지원 운동 목록과 비율은 승인 대상이다.

### 7.3 지원 판정

| 상황 | 결과 |
|---|---|
| 운동이 어떤 템플릿의 `supportedExerciseIds`에도 없음 | `UNSUPPORTED_EXERCISE` — 임의 비율 부여 금지 |
| 템플릿이 `pending` | `TEMPLATE_NOT_VERIFIED` |
| 1RM 없음 | `MISSING_1RM` |
| 모두 충족 | 세트 목록 반환 |

### 7.4 운동 변경 처리 `[Hybrid H-08]`

`replaceExercise()`의 계산 규칙:

| 세트 상태 | 처리 |
|---|---|
| 미래 세션의 모든 세트 | 새 운동 기준으로 전체 재계산 |
| 진행 중 세션의 **시작 전** 세트 | 새 운동 기준으로 재계산 |
| 진행 중 세션의 **완료된** 세트 | 기존 운동 기록으로 보존, 재계산하지 않음 |
| 과거 세션 | 변경하지 않음 |

진행 중 세션에서 운동을 바꿀 때 완료 세트가 섞이는 경우의 표시·세트 번호 처리는 [미확정] U-09.

### 7.5 T2 증량

T2의 `currentTM` 자동 증량 규칙은 **미확정**이다(U-08). PRD FR-008은 "T2는 별도 진행 규칙"을 요구하지만 정의된 규칙이 없다. 승인 전에는 T2에서 자동 증량을 실행하지 않는다. T2 운동의 `currentTM`은 (a) 사용자의 1RM 수정(U-05), (b) 같은 exerciseId를 쓰는 T1의 AMRAP 증량(7.6절)으로만 바뀐다.

### 7.6 동일 운동의 T1·T2 공통 TM `[Hybrid H-13]` — v0.3 확정

OHP는 금요일 T1이자 월요일 T2다. 두 티어는 **같은 OHP 프로필**을 참조한다.

| 규칙 | 내용 |
|---|---|
| 공유 대상 | 동일 exerciseId → 공통 `input1RM`, `initialTM`, `currentTM`, `tmHistory` |
| 독립 대상 | 서로 다른 exerciseId → 1RM·TM 독립 |
| 세트 템플릿 | 같은 TM이라도 T1·T2 템플릿은 각각 별도 적용 |
| TM 증량 | T1 AMRAP 증량(승인된 규칙)만 공통 `currentTM`에 반영. T2에서 별도의 중복 증량 금지 |
| 반영 범위 | 변경된 `currentTM`은 아직 시작하지 않은 세션(T1·T2)부터 적용 |
| 스냅샷 | 이미 시작·완료한 세션은 시작 시점 스냅샷 유지 |
| 기록 | 날짜·세션·티어별로 독립 보존 |
| 이력 | `tmHistory`에 `sourceSessionId`·`sourceTier`를 남겨 어느 세션·티어가 TM을 바꿨는지 추적 |

T1 AMRAP의 구체 증량값(U-04)과 T2 자체 증량 규칙(U-08)은 여전히 미확정이다.

---

## 8. T3 FST-7 증량

### 8.1 고정 구성 `[Hybrid H-09]`

```text
sets            = 7
targetReps      = 12
totalTargetReps = 84
```

- T3는 1RM·TM을 사용하지 않는다.
- 세트 수와 목표 반복은 MVP에서 변경 불가.
- `generateFST7Sets(workingWeight)`는 7개 세트 모두 `targetWeight = workingWeight`, `targetReps = 12`로 생성한다.

### 8.2 작업 중량

| 항목 | 규칙 |
|---|---|
| 입력 | 운동별 작업 중량 직접 입력 |
| 유효성 | 0보다 큰 유한한 숫자 |
| 미입력 | `MISSING_WORKING_WEIGHT` — 임의 값 생성 금지 |
| 운동 변경 시 | 새 운동의 저장값 사용, 이전 운동 값 복사 금지 |
| 입력값이 `increment`의 배수가 아닐 때 | [미확정] U-13 (승인 전에는 입력값을 변경하지 않음) |

### 8.3 증량 판정 `[Hybrid H-10]`

다음 조건을 **모두** 만족하면 증량한다.

1. 7개 세트가 모두 완료 상태
2. 모든 세트의 `actualReps ≥ 12`
3. 모든 세트의 `actualWeight`가 입력되어 있음
4. 모든 세트의 `actualWeight ≥ 세션 시작 시점의 작업 중량`

```text
조건 충족   → nextWorkingWeight = currentWorkingWeight + increment
조건 미충족 → nextWorkingWeight = currentWorkingWeight
```

- 판정 기준 중량은 **세션 스냅샷의 작업 중량**이다. 세션 중 사용자가 개별 세트 목표를 낮춰도 기준은 바뀌지 않는다.
- 증량은 다음 세션부터 적용하고, 과거 기록은 바꾸지 않는다.
- 중복 완료 이벤트에도 한 번만 증량한다(6.4와 같은 멱등성 키).

### 8.4 예시

| 현재 작업 중량 | increment | 수행 결과 | 다음 작업 중량 |
|---|---|---|---|
| 30kg | 2.5kg | 7세트 모두 30kg × 12회 | 32.5kg |
| 30kg | 2.5kg | 7세트 모두 30kg × 15회 | 32.5kg (한 단계만) |
| 30kg | 2.5kg | 1세트 30kg × 11회 | 30kg |
| 30kg | 2.5kg | 1세트 27.5kg × 12회 | 30kg |
| 30kg | 2.5kg | 6세트만 완료 | 30kg |
| 15kg | 2kg | 7세트 모두 성공 | 17kg |

### 8.5 감량

T3 감량 규칙은 확정 결정에 포함되지 않았다. 반복 미달 시 감량은 적용하지 않는다. 자동 감량은 MVP 범위에서 제외하고 후속 검토한다(11장 C-06 — RESOLVED).

---

## 9. 데이터 일관성 및 과거 기록 보존

### 9.1 세션 스냅샷

세션이 `IN_PROGRESS`로 바뀌는 시점에 다음 값을 복사해 고정한다. 운동 단위 값은 SessionExercise에, 세트 단위 값은 SetRecord에 저장한다(FUNCTIONS 11.3·11.4.1).

| 스냅샷 항목 | 저장 위치 | 목적 |
|---|---|---|
| `sessionExerciseId`, `exerciseId`, `tier` | SessionExercise | 기록 대상 식별 |
| `templateId`, `templateVersion` | SessionExercise | 템플릿 변경 후에도 당시 계산 재현 |
| `tmAtSession` (T1·T2) / `workingWeightAtSession` (T3) | SessionExercise | 증량 판정 기준 |
| `increment` | SessionExercise | 당시 반올림 단위 |
| `targetWeight`, `targetReps`, `setNumber` | SetRecord | 목표값 보존 |

이후 프로필(1RM, TM, increment, 템플릿)이 바뀌어도 스냅샷은 바뀌지 않는다.

### 9.2 값의 구분

| 값 | 의미 | 계산 엔진이 수정 가능? |
|---|---|---|
| `targetWeight` (자동 계산) | 템플릿 기반 목표 | 시작 전 세트만 |
| `manualTargetWeight` | 사용자가 세트 완료 전에 수정한 목표 | 아니오 (재계산 시에도 보존) |
| `actualWeight`, `actualReps` | 실제 수행 | 아니오 |

재계산 시 `manualTargetWeight`가 있는 세트를 어떻게 다룰지(유지 vs 사용자 확인 후 덮어쓰기)는 FUNCTIONS 12.2 "사용자 수동 수정값은 임의로 삭제하지 않는다"에 따라 **기본 유지**로 한다.

### 9.3 증량 멱등성

- 증량 이벤트는 `(sessionId, exerciseId, tier)` 키로 한 번만 기록한다.
- 같은 키의 이벤트가 이미 있으면 증량을 다시 적용하지 않는다.

### 9.4 기록 잠금과 운동별 전체 세트 리셋 `[Hybrid H-14]` — v0.5 갱신

v0.4의 하루 세션 전체 리셋은 **운동별 전체 세트 리셋**으로 대체한다.

| 규칙 | 내용 |
|---|---|
| 완료 전 세트 | 실제 중량·반복 입력·수정 가능 |
| 완료 확정 | 사용자가 체크박스를 체크 → 입력값 검증 → 저장 성공 시에만 `completed = true` |
| 완료된 세트 | 기록 잠금, 직접 수정·체크 해제 불가 (저장 계층에서도 거부) |
| 현재 세트 | 저장하지 않고 `completed = false`인 첫 세트(가장 작은 `setNumber`)로 계산 |
| 재입력 방법 | 해당 운동(SessionExercise)의 전체 세트를 사용자 확인 후 리셋하고 첫 세트부터 재입력 |
| 리셋 대상 식별 | `sessionExerciseId` (같은 `exerciseId`가 여러 세션에 존재하므로 `exerciseId`로 식별하지 않음) |
| 리셋 허용 조건 | 하루 세션 상태가 IN_PROGRESS 또는 PAUSED |
| 초기화 필드 | 대상 운동 세트의 `actualWeight`, `actualReps`, `completed`, `completedAt` |
| 재설정 필드 | 대상 운동의 진행 상태(저장하는 경우 NOT_STARTED), `resetCount`(+1), `lastResetAt`. 현재 세트는 계산값이므로 자동으로 첫 세트가 됨 |
| 보존 필드 | `targetWeight`, `targetReps`, `setNumber`, `manualTargetWeight`, 운동의 `templateId`·`templateVersion`, `tmAtSession`·`workingWeightAtSession`·`increment` 스냅샷 |
| 변경 금지 | 같은 세션의 다른 운동, 하루 세션 상태, `currentTM`, `tmHistory`, T3 다음 목표 작업 중량, 다른 세션 |

v0.4는 리셋 시 세트 완료 전 수정한 목표값을 스냅샷 값으로 되돌렸으나, v0.5에서는 실제 수행 데이터만 초기화하므로 `manualTargetWeight`도 보존한다.

#### 리셋과 증량 이력의 관계

- 자동 증량 판정(6.4절 T1, 8.3절 T3)은 **하루 세션이 COMPLETED가 될 때** 실행된다(6.4절). 개별 운동의 모든 세트가 완료되어도 하루 세션이 진행 중이면 증량은 확정되지 않는다.
- 따라서 운동별 리셋이 허용되는 세션(IN_PROGRESS·PAUSED)에는 확정된 증량이 없으며, 리셋은 TM·작업 중량을 새로 만들지 않고 증량 이벤트도 만들지 않는다.
- 리셋 후 재입력을 마치고 하루 세션이 완료되면 그때 증량 판정을 한 번 실행한다. 멱등성 키 `(sessionId, exerciseId, tier)`(9.3절)는 SessionExercise와 1:1로 대응하므로 같은 운동의 증량 중복을 막는다.
- 완료 세션은 진행 판정 근거가 확정된 상태이므로, 리셋으로 기록을 지우면 이미 적용된 증량의 근거가 사라진다. 증량 취소·유지·재판정 정책은 **[미확정] U-14**이며, 확정 전에는 COMPLETED 세션의 운동 리셋을 허용하지 않는다.
- ABANDONED 세션의 운동 리셋은 재개 정책과 함께 **[미확정] U-15**로 관리하며, 결정 전에는 허용하지 않는다.
- 계산 엔진은 완료된 세트·세션을 수정하지 않는다(1.1절 비파괴성). 리셋은 저장 계층의 원자적 트랜잭션으로 수행한다(TECHSTACK 5.4).

### 9.5 운동 변경과 기록

- 운동을 바꿔도 이전 운동의 프로필(1RM, TM, 작업 중량, 이력)과 세션 기록은 삭제하지 않는다.
- 이전 운동으로 되돌리면 저장된 프로필을 그대로 재사용한다.

---

## 10. Vitest 기반 TDD 테스트 명세

### 10.1 원칙

- 계산 함수마다 **실패하는 테스트 작성 → 실패 확인 → 구현 → 통과 → 리팩터링** 순서로 진행한다.
- 테스트 ID는 FUNCTIONS.md의 `TC-xxx`와 겹치지 않도록 `CR-<영역>-<번호>`를 사용한다.
- 미승인 상수에 의존하는 테스트는 `it.todo`로 등록하고, 승인되면 구현 테스트로 전환한다.
- 구조 검증용 **테스트 픽스처 템플릿**은 `tests/fixtures/`에만 두고 이름에 `FIXTURE_`를 붙인다. 픽스처 비율은 운영 템플릿(`src/domain/templates/`)으로 옮기지 않는다.
- 예상 테스트 파일 위치(TECHSTACK 4장 기준): `tests/unit/calculations/*.test.ts`

### 10.2 `calculateTM()` — `tm.test.ts`

| ID | 입력 | 기대 결과 |
|---|---|---|
| CR-TM-01 | 1RM 100 | initialTM 90 |
| CR-TM-02 | 1RM 82.5 | 74.25 (반올림 없음) |
| CR-TM-03 | 1RM 0 | `INVALID_1RM` |
| CR-TM-04 | 1RM -10 | `INVALID_1RM` |
| CR-TM-05 | 1RM `NaN` / `Infinity` | `INVALID_1RM` |
| CR-TM-06 | 1RM 미입력(`undefined`) | `MISSING_1RM` |
| CR-TM-07 | 최초 입력 후 프로필 | `currentTM === initialTM`, `tmHistory[0].reason === "INITIAL"` |
| CR-TM-08 | 1RM 수정 | `initialTM` 갱신 / `currentTM` 처리는 `it.todo` (U-05) |

### 10.3 `roundToIncrement()` — `rounding.test.ts`

| ID | 입력 (weight, increment) | 기대 결과 |
|---|---|---|
| CR-RD-01 | (73.4, 2.5) | 72.5 |
| CR-RD-02 | (62, 2.5) | 62.5 |
| CR-RD-03 | (63, 2.5) | 62.5 |
| CR-RD-04 | (64, 2.5) | 65 |
| CR-RD-05 | (72.5, 2.5) 이미 배수 | 72.5 |
| CR-RD-06 | (13.3, 1) | 13 |
| CR-RD-07 | 결과가 increment의 정확한 배수 | `Number.isInteger(result / increment)` 성립, 소수 오차 없음 |
| CR-RD-08 | increment 0 / 음수 / `NaN` | `INVALID_INCREMENT` |
| CR-RD-09 | (61.25, 2.5) 정확한 중간값 | 62.5 (H-12) |
| CR-RD-10 | 부동소수점 연산 결과로 만든 중간값 (예: 이론값 61.25) | 62.5 — 오차로 내림되지 않음 |
| CR-RD-11 | 결과가 0 이하 | 오류 반환 (4.5절) |
| CR-RD-12 | (61.24, 2.5) 중간값 미만 | 60 |
| CR-RD-13 | (61.26, 2.5) 중간값 초과 | 62.5 |

### 10.4 `calculateT1Sets()` — `t1.test.ts`

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-T1-01 | `pending` 템플릿 | `TEMPLATE_NOT_VERIFIED`, 세트 미생성 |
| CR-T1-02 | FIXTURE 템플릿 + currentTM | 세트 수 = 템플릿 세트 수, 각 세트 `roundToIncrement(TM × ratio)` |
| CR-T1-03 | FIXTURE 템플릿 | TM 자체는 반올림되지 않은 값으로 계산에 사용됨 |
| CR-T1-04 | 같은 입력 2회 호출 | 동일 결과 (결정성) |
| CR-T1-05 | 1RM 없는 운동 | `MISSING_1RM` |
| CR-T1-06 | 바벨 로우 | 벤치형 `templateId`를 참조, 바벨 로우의 `currentTM` 사용 |
| CR-T1-07 | 바벨 로우·벤치프레스 TM이 다를 때 | 두 운동의 세트 중량이 각자의 TM으로 계산됨 (TM 공유 없음) |
| CR-T1-08 | 실제 원본 템플릿 데이터 | `it.todo` (U-01, U-02) |

### 10.5 `evaluateT1Progress()` — `t1-progress.test.ts`

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-AM-01 | 규칙 `pending` | 증량 없음, `RULE_NOT_VERIFIED` |
| CR-AM-02 | FIXTURE 규칙 + 구간 내 반복 | `nextTM = currentTM + 해당 구간 Δ` |
| CR-AM-03 | FIXTURE 규칙 | 진행 판정 AMRAP 외 다른 AMRAP 세트는 결과에 영향 없음 |
| CR-AM-04 | 같은 세션 2회 평가 | 증량 1회만 반영 |
| CR-AM-05 | 증량 후 | 완료된 세션의 세트 중량 불변 |
| CR-AM-06 | 증량 후 | `tmHistory`에 `ruleId`, `ruleVersion`, `sourceSessionId` 기록 |
| CR-AM-07 | FIXTURE 규칙의 구간이 겹치거나 빈 구간 존재 | 규칙 검증 오류 |
| CR-AM-08 | AMRAP 미입력 | 승인 전 기본값: TM 유지 / 최종 정책은 `it.todo` (U-06) |
| CR-AM-09 | 실제 원본 증량값 | `it.todo` (U-04) |

### 10.6 `calculateT2Sets()` / `replaceExercise()` — `t2.test.ts`

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-T2-01 | 지원 템플릿 없는 운동 | `UNSUPPORTED_EXERCISE` |
| CR-T2-02 | `pending` 템플릿 | `TEMPLATE_NOT_VERIFIED` |
| CR-T2-03 | A(TM 70) → B(TM 80), FIXTURE 비율 0.75 | A 52.5 / B 60 (FUNCTIONS TC-003 구조와 일치) |
| CR-T2-04 | A → B, B에 1RM 없음 | `MISSING_1RM`, A의 값 미복사 |
| CR-T2-05 | 운동 변경 | 미래 세션 세트 전부 재계산 |
| CR-T2-06 | 진행 중 세션에서 변경 | 완료 세트 보존, 시작 전 세트만 재계산 |
| CR-T2-07 | 운동 변경 | 과거 세션 기록 불변 |
| CR-T2-08 | B → A로 복원 | A의 저장 프로필 재사용 |
| CR-T2-09 | `manualTargetWeight`가 있는 세트 재계산 | 수동값 유지 |
| CR-T2-10 | 실제 유형별 원본 비율 | `it.todo` (U-08) |

### 10.7 `generateFST7Sets()` / `evaluateFST7Progress()` — `fst7.test.ts`

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-F7-01 | 작업 중량 30 | 7세트, 각 12회, 각 30kg |
| CR-F7-02 | 작업 중량 미입력 | `MISSING_WORKING_WEIGHT` |
| CR-F7-03 | 작업 중량 0 / 음수 / `NaN` | 입력 오류 |
| CR-F7-04 | 7세트 모두 30×12, increment 2.5 | 다음 32.5 |
| CR-F7-05 | 7세트 모두 30×15 | 다음 32.5 (한 단계만) |
| CR-F7-06 | 1세트 11회 | 유지 30 |
| CR-F7-07 | 1세트 실제 중량 27.5 | 유지 30 |
| CR-F7-08 | 6세트만 완료 | 유지 30 |
| CR-F7-09 | 1세트 `actualWeight` 미입력 | 유지 30 |
| CR-F7-10 | 세션 중 목표를 25로 낮추고 25×12 수행 | 유지 30 (판정 기준은 세션 스냅샷) |
| CR-F7-11 | 같은 세션 2회 평가 | 증량 1회만 |
| CR-F7-12 | 15kg, increment 2 | 다음 17 |
| CR-F7-13 | 운동 변경 | 새 운동 작업 중량 사용, 이전 값 미복사 |
| CR-F7-14 | 작업 중량이 increment 배수가 아님 | `it.todo` (U-13) |

### 10.8 데이터 일관성 — `consistency.test.ts`

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-DC-01 | 세션 시작 후 프로필 TM 변경 | 세션 스냅샷 값 불변 |
| CR-DC-02 | 템플릿 버전 변경 | 과거 세션은 당시 `templateVersion`으로 재현 가능 |
| CR-DC-03 | increment 변경 | 시작 전 세트만 재계산, 완료 세트 불변 |
| CR-DC-04 | 완료 세트 수정 시도 | `SET_LOCKED` 거부, 기존 값 유지 |
| CR-DC-05 | 완료 세션의 운동 리셋 후 증량 처리 | `it.todo` (U-14) |

### 10.9 공통 TM 공유 — `profile-sharing.test.ts`

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-SH-01 | 월요일 T2 OHP, 금요일 T1 OHP | 두 세트 계산이 같은 OHP 프로필의 `currentTM` 참조 |
| CR-SH-02 | 같은 `currentTM`, T1·T2 FIXTURE 템플릿 | 세트 수·반복·비율은 각 티어 템플릿을 따름 (결과 세트 구성이 다름) |
| CR-SH-03 | T1 AMRAP로 `currentTM` 변경 (FIXTURE 증량 규칙) | 아직 시작하지 않은 다음 T2 OHP 세션에 새 TM 적용 |
| CR-SH-04 | 위 변경 이후 | 이미 완료된 T2 OHP 세션의 목표 중량·스냅샷 불변 |
| CR-SH-05 | T2 세션 완료 | 공통 `currentTM` 증량 없음 (T2 중복 증량 금지) |
| CR-SH-06 | 서로 다른 exerciseId (예: 벤치프레스·인클라인 벤치프레스) | 1RM·TM 독립, 한쪽 변경이 다른 쪽에 영향 없음 |
| CR-SH-07 | T1 AMRAP 증량 후 이력 조회 | `tmHistory`에 `sourceSessionId`, `sourceTier = "T1"` 기록 |

CR-SH-03은 증량값 자체가 미확정(U-04)이므로 FIXTURE 증량 규칙으로 **전파 구조만** 검증한다.

#### STEP 02 요청 테스트와의 매핑

| 요청 ID | 내용 | 본 문서 ID | FUNCTIONS ID |
|---|---|---|---|
| TC-01 | 61.25kg / 2.5kg → 62.5kg | CR-RD-09, CR-RD-10 | TC-010 |
| TC-02 | 중간값이 아니면 가장 가까운 중량 | CR-RD-02~04, CR-RD-12, CR-RD-13 | TC-011 |
| TC-03 | T2 OHP·T1 OHP 동일 currentTM | CR-SH-01 | TC-012 |
| TC-04 | 같은 TM이라도 T1·T2 템플릿 다름 | CR-SH-02 | TC-013 |
| TC-05 | T1 AMRAP 변경 TM이 다음 T2 세션에 적용 | CR-SH-03 | TC-014 |
| TC-06 | 완료된 T2 세션 목표 중량 불변 | CR-SH-04 | TC-015 |
| TC-07 | 중복 완료 시 증량 1회 | CR-AM-04, CR-F7-11 | TC-016 |
| TC-08 | 다른 exerciseId는 1RM·TM 독립 | CR-SH-06, CR-T1-07 | TC-017 |

### 10.10 기록 잠금·운동별 리셋 — `session-exercise-reset.test.ts`

리셋 가능 여부 판정과 리셋 결과 계산은 순수 함수로 단위 테스트하고, 원자성·롤백(CR-RS-07)은 TECHSTACK 6장의 통합 테스트에서 검증한다. v0.4의 CR-RS-01~12(하루 세션 리셋 기준)는 아래 번호로 **재정의**한다. 아직 구현된 테스트가 없으므로 번호를 재사용한다.

예시 세션(설명용, 세트 수는 검증된 템플릿 기준이 아님): 월요일 T1 벤치프레스, T2 OHP, T3 케이블 플라이.

| ID | 요청 ID | 조건 | 기대 결과 |
|---|---|---|---|
| CR-RS-01 | RS-01 | T2 OHP 리셋 | OHP 세트의 실제값·완료 상태만 초기화 |
| CR-RS-02 | RS-02 | T2 OHP 리셋 | T1 벤치프레스·T3 케이블 플라이 세트 기록 불변 |
| CR-RS-03 | RS-03 | 리셋 후 | 계산된 현재 세트 = 첫 세트, 모든 체크 해제 상태 |
| CR-RS-04 | RS-04 | 완료된 개별 세트 직접 수정 | `SET_LOCKED` 거부, 기존 값 유지 |
| CR-RS-05 | RS-05 | 리셋 전후 비교 | `targetWeight`·`targetReps`·`manualTargetWeight`·템플릿 ID/버전·TM 스냅샷 동일 |
| CR-RS-06 | RS-06 | 리셋 | 운동 프로필 `currentTM` 불변 |
| CR-RS-07 | RS-07 | 리셋 트랜잭션 중 오류 | 세트·진행 상태·리셋 이력 전체 롤백 (통합 테스트) |
| CR-RS-08 | RS-08 | 하루 세션 COMPLETED에서 리셋 | `RESET_NOT_ALLOWED` (U-14 확정 전) |
| CR-RS-09 | RS-09 | 하루 세션 ABANDONED에서 리셋 | `RESET_NOT_ALLOWED` (U-15 확정 전) |
| CR-RS-10 | RS-10 | 같은 `exerciseId`가 다른 세션에도 존재 | 선택한 `sessionExerciseId`의 세트만 초기화 |
| CR-RS-11 | RS-11 | 리셋 | `resetCount` +1, `lastResetAt` 갱신 |
| CR-RS-12 | RS-12 | 리셋 | 증량 이벤트·`tmHistory` 항목 생성 없음 |
| CR-RS-13 | — | 미완료 세트 실제값 변경 | 허용 |
| CR-RS-14 | — | 하루 세션 PAUSED에서 리셋 | 허용 (CR-RS-01과 같은 결과) |
| CR-RS-15 | — | 리셋 | 하루 세션 상태 불변 |
| CR-RS-16 | — | 리셋 전 다른 세션 완료로 `currentTM` 변경된 상태 | 리셋 후 목표값은 기존 스냅샷 값 유지 |
| CR-RS-17 | — | 리셋 → 재입력 → 하루 세션 완료 (FIXTURE 증량 규칙) | 해당 운동 증량 1회만 반영 |
| CR-RS-18 | — | 요청 세션에 속하지 않는 `sessionExerciseId` | `NOT_FOUND` 거부, 아무것도 변경하지 않음 |
| CR-RS-19 | — | 리셋 | T3 다음 목표 작업 중량 불변 |

FUNCTIONS 테스트 매핑: TC-018 → CR-RS-13, TC-019 → CR-RS-04, TC-020 → CR-RS-01·02·03·05, TC-022 → CR-RS-08·09, TC-023 → CR-RS-12·17, TC-024 → CR-RS-07. TC-021(취소)은 컴포넌트 테스트 대상이다.

### 10.11 세트 완료 체크 — `set-completion.test.ts`

입력값 검증과 현재 세트 계산은 순수 함수로 단위 테스트하고, 저장 성공·실패 처리는 TECHSTACK 6장의 컴포넌트·통합 테스트에서 검증한다.

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-CK-01 | 유효한 실제 중량·반복으로 체크, 저장 성공 | `completed = true`, `completedAt` 기록 |
| CR-CK-02 | `actualWeight` 미입력·0 이하·`NaN` | `INVALID_ACTUAL_WEIGHT`, 저장하지 않음 |
| CR-CK-03 | `actualReps` 미입력·음수·소수 | `INVALID_ACTUAL_REPS`, 저장하지 않음 |
| CR-CK-04 | 저장 실패 (통합) | `completed = false` 유지, 입력값 보존, 타이머 미시작 |
| CR-CK-05 | 이미 완료된 세트를 다시 체크 (중복 이벤트) | 거부, `completedAt` 불변 |
| CR-CK-06 | 완료된 세트 체크 해제 요청 | `SET_LOCKED` 거부 |
| CR-CK-07 | 1·2세트 완료, 3세트 미완료 | 현재 세트 = 3 |
| CR-CK-08 | 모든 세트 완료 | 현재 세트 없음 |
| CR-CK-09 | 다음 미완료 세트가 남은 상태로 체크 저장 성공 | 휴식 타이머 시작 신호 반환 |
| CR-CK-10 | 마지막 미완료 세트 체크 저장 성공 | 휴식 타이머 시작 신호 없음 |
| CR-CK-11 | T2 OHP 세트 체크 | T1·T3 세트의 체크 상태 불변 |

FUNCTIONS 테스트 매핑: TC-025 → CR-CK-01·09, TC-026 → CR-CK-02·03, TC-027 → CR-CK-04, TC-028 → CR-CK-06, TC-029 → CR-CK-10, TC-030 → CR-CK-07.

T3 증량 판정의 "7세트 모두 완료"(8.3절)는 이 절의 `completed = true`(저장 성공 기준)를 그대로 사용한다.

### 10.12 Setup 초기 1RM — `setup-estimate.test.ts`

4개 추천 비율은 v0.8에서 승인되어 Setup 테스트에 포함한다. 스모 데드리프트(U-18)는 기준 TM 확인 전 `it.todo`로 둔다.

| ID | 조건 | 기대 결과 |
|---|---|---|
| CR-SU-01 | 벤치 100 / 데드 140 / 스쿼트 120 / OHP 62.5 입력 | initialTM 90 / 126 / 108 / 56.25 (반올림 없음) |
| CR-SU-02 | 1RM 0·음수·문자·빈 값 | 다음 단계 진행 불가 |
| CR-SU-03 | 백 스쿼트 120 | 프론트 스쿼트 추천 96 |
| CR-SU-04 | 바벨 로우 1RM 77 (자동 추정) | 슈러그 추천 38.5, TM 34.65 |
| CR-SU-05 | 로우 1RM을 사용자가 90으로 수정 | 슈러그 추천 45 (수정값 기준) |
| CR-SU-06 | 자동 추정 상태에서 기준 1RM 변경 | 추천값 다시 계산 |
| CR-SU-07 | 추정값 확정·직접 수정 후 기준 1RM 변경 | 값 유지, 다른 운동 값도 유지 |
| CR-SU-08 | 되돌리기 | 자동 추정 상태로 복귀 |
| CR-SU-09 | T3 작업 중량 5개 입력 | 운동별 독립 저장, 1RM·TM 미적용 |
| CR-SU-10 | 설정 확정 | 자동 추정 값이 확정값으로 고정 |
| CR-SU-11 | 데드리프트 140 / 벤치 100 | 로우 77 / 인클라인 85 (승인 비율) |
| CR-SU-13 | 추정값 확정·수정 | 출처가 `DIRECT`(직접 입력)로 바뀌지 않음 |
| CR-SU-12 | 스모 데드리프트 계산 | `it.todo` (U-18) |

### 10.13 구현 현황 (v0.9, Vitest)

| 함수 | 파일 | 테스트 | 대응 명세 |
|---|---|---|---|
| `validateWeightInput` | `src/domain/calculations/weight.ts` | `tests/unit/calculations/weight.test.ts` | CR-TM-03~06, CR-SU-02 |
| `roundToIncrement` | 같은 파일 | 같은 파일 | CR-RD-01~13 (CR-RD-11은 `NON_POSITIVE_RESULT`) |
| `calculateTM` | `trainingMax.ts` | `training-max.test.ts` | CR-TM-01~06 |
| `estimateInitialOneRM`, `resolveInitialOneRepMaxes` | `initialOneRepMax.ts` | `initial-one-rep-max.test.ts`, `setup-consistency.test.ts` | CR-SU-01, 03~08, 11, 13 |
| `evaluateFST7Progress` | `fst7Progress.ts` | `fst7-progress.test.ts` | CR-F7-04~12 |

함수 계약:

- 오류는 예외 대신 `{ ok: false, error }`로 돌려준다.
- 중량은 `{ value, unit }`으로 다루며 kg↔lb 자동 변환을 하지 않는다. 단위가 다르면 `UNIT_MISMATCH`.
- FST-7 유지 사유: `SET_COUNT_MISMATCH`, `SET_INCOMPLETE`, `ACTUAL_WEIGHT_MISSING`, `ACTUAL_REPS_MISSING`, `REPS_BELOW_TARGET`, `WEIGHT_BELOW_TARGET`.
- 판정 시점(하루 세션 완료)과 증량 중복 방지는 저장 계층이 맡는다.

미구현 (미확정 정책): `calculateT1Sets`, `calculateT2Sets`, `evaluateT1Progress`(U-04), T2 증량(U-08), 스모 데드리프트(U-18).

> 저장·복원(IndexedDB) 테스트는 계산 엔진 범위가 아니므로 TECHSTACK 6장의 통합 테스트에서 다룬다.

---

## 11. 미확정 계산 규칙 및 승인 필요 항목

### 11.1 미확정 규칙 (U-xx)

| ID | 항목 | 필요한 결정 | 차단되는 기능 |
|---|---|---|---|
| U-01 | 원본 T1 템플릿 데이터와 Hybrid 요일 매핑 | 운동별 세트 수·반복·비율, 요일별 대응 템플릿 | T1 전체 계산 |
| U-02 | "일반 5/3/1 벤치형"의 정확한 지정 | 원본의 어느 템플릿인지 `templateId` 수준 특정 | 바벨 로우 T1 |
| U-03 | 반올림 중간값 처리 | **확정 (v0.3)**: 높은 중량 선택 → H-12, 4.2절 | — |
| U-04 | AMRAP 증량값 | (a) 구간 경계, (b) 구간별 고정 Δ, (c) lb→kg 변환, (d) 하체·상체·바벨 로우 구분 여부 | T1 자동 증량 |
| U-05 | 1RM 수정 시 currentTM | 재설정 / 유지 / 사용자 선택 | 1RM 수정 흐름 |
| U-06 | AMRAP 미입력·실제 중량 미달 처리 | 유지 / 판정 제외 / 기타 | T1 자동 증량 |
| U-07 | 완료 기록 수정 시 증량 재평가 | **대체됨 (v0.4)**: 완료 기록 수정 불가(H-14) → U-14로 이관 | — |
| U-08 | T2 유형별 템플릿과 T2 증량 | 유형 분류, 지원 운동, 비율, 증량 규칙 (슈러그 지원 여부 포함) | T2 전체 계산 |
| U-09 | 진행 중 세션의 T2 운동 변경 시 세트 표시 | 세트 번호·완료 세트 처리 방식 | 세션 중 종목 변경 |
| U-10 | 최소 중량 하한 | 0kg/빈 바 이하 결과 처리 | 저중량 운동 |
| U-11 | 비정상적으로 큰 입력 경고 기준 | 경고 기준 | 입력 검증 UX |
| U-12 | 동일 운동의 T1·T2 TM 공유 | **확정 (v0.3)**: 동일 exerciseId 공통 프로필·currentTM → H-13, 7.6절 | — |
| U-13 | T3 작업 중량이 increment 배수가 아닌 경우 | 그대로 사용 / 반올림 / 경고 | T3 입력 |
| U-14 | 완료된 세션의 운동 리셋 시 기존 TM 증량 처리 | 증량 취소(롤백) / 유지 / 재판정 중 택1, 이후 세션 영향 범위 | 완료 세션의 운동 리셋 (확정 전 불허) |
| U-15 | ABANDONED 세션 리셋·재개 | 리셋 허용 여부, 재개 정책과의 관계 | 중도 종료 세션의 운동 리셋 (결정 전 불허) |
| U-16 | 바벨 로우 초기 추정 비율 (데드리프트 × 0.55) | **확정 (v0.8)**: MVP 초기 추천값 → 3.6절 | — |
| U-17 | 인클라인 벤치 초기 추정 비율 (벤치 × 0.85) | **확정 (v0.8)**: MVP 초기 추천값 → 3.6절 | — |
| U-18 | 스모 데드리프트 기준 TM | 원본 Sumo T2 템플릿 사용은 결정됨. 비율이 참조하는 TM을 원본 시트 **수식**으로 확인하고, H-07(T2 독립 TM)과의 관계 결정 (3.6절) | 스모 T2 계산 (값 없음) |
| U-20 | lb 단위 지원 범위 | lb 입력 허용 여부, kg↔lb 변환 제공 여부, lb 기본 증가 단위 | 단위 설정 (현재 타입은 lb를 표현하지만 변환 없음) |
| U-19 | 덤벨 운동 중량 표기 | **RESOLVED (v0.10)**: 한 손 기준, 양손 합산 없음, kg·lb 공통 → H-16, 4.4절 | — |

**참고 — v0.1에 있던 AMRAP 증량 범위표:** v0.1에는 "이전 조사"를 근거로 한 lb 단위 구간표가 있었으나 출처 대조가 끝나지 않아 이번 문서에서는 규칙 본문에 넣지 않았다. U-04를 결정할 때 원본 자료와 함께 다시 검토한다.

### 11.2 기존 문서와의 충돌 (C-xx) — v0.3 해결 현황

v0.3 작업(STEP 02)에서 실제 문서를 다시 확인하고 아래와 같이 반영했다.

| ID | 문서·위치 | 기존 내용 | 확정 기준 | 상태 | 반영 내용 |
|---|---|---|---|---|---|
| C-01 | PTS 4.2·8.2, PRD 3.2·FR-002·11 | 바벨 로우 "별도 계산·증량 규칙", "별도 템플릿 지원" | 벤치형 T1 템플릿 **재사용** | RESOLVED | 재사용 정책으로 문구 수정. 벤치형 템플릿의 세트 데이터는 U-01·U-02로 계속 검증 |
| C-02 | TECHSTACK 2·5.1·9 | "사용자가 **선택한** 기존 T1 템플릿을 재사용" | 벤치형으로 **고정** | RESOLVED | "일반 5/3/1 벤치형 T1 템플릿 재사용"으로 수정 |
| C-03 | FUNCTIONS 1.2·5.1~5.3·15, PTS 4.3·8.2, PRD 3.3·FR-003 | T2 단일 "T2 세트 비율"·"검증된 기본 템플릿" | **운동 유형별** 지원 템플릿 | RESOLVED | 운동 유형별 템플릿으로 문구 수정. 유형 분류·비율 값은 U-08로 미확정 유지 |
| C-04 | FUNCTIONS 3.2·11.2 | `training_max`는 1RM으로 재계산 가능한 파생값 | `initialTM`은 파생값, `currentTM`은 독립 저장값 | RESOLVED | `initial_tm`/`current_tm` 분리, 3.2.1 TM 공유·3.2.2 TM 이력·11.5 TMChange 추가 |
| C-05 | TECHSTACK 5.1·5.4·6 | 프로필 저장 항목에 1RM·T3 작업 중량만 있음 | currentTM·TM 이력·세션 스냅샷 저장 | RESOLVED | 저장 항목 표에 initialTM/currentTM, TM 변경 이력, 세션 스냅샷 추가 |
| C-06 | PTS 8.2, PRD FR-008·11 | T3 "증량·감량", "증량·유지·감량 조건" | 증량·유지만 확정 | RESOLVED | 증량·유지 규칙 명시, 자동 감량은 "MVP 제외·후속 검토"로 표기 (새 감량 규칙은 추가하지 않음) |
| C-07 | FUNCTIONS 1.2 | T3 증량 조건 "7세트 모두 12회 성공" (중량 조건 없음) | 12회 이상 **+ 목표 중량 이상** | RESOLVED | 1.2 표에 중량 조건 추가 (6.3절은 원래 일치) |
| C-08 | FUNCTIONS 3.2·15 | "TM 자체의 반올림 정책은 후속 확정" | TM 미반올림, 최종 세트만 반올림 | RESOLVED | 확정 문구로 수정, 중간값 상향 규칙(U-03)을 7.2에 추가 |
| C-09 | PRD 3.3·FR-008 | "T2는 별도 진행 규칙 사용" | T2 자체 증량 규칙 미확정 | PENDING | U-08 결정 필요. PRD에 "미확정, 승인 전 미적용, T2에서 공통 TM 중복 증량 금지"로 표기 |
| C-10 | FUNCTIONS 4.2 | 템플릿 필드에 `rest_seconds` 포함 | — | NO_CONFLICT | 계산 결과에 영향 없음. 본 문서 5.2절을 "계산 엔진은 rest_seconds를 참조하지 않는다"로 완화해 양립 |
| C-11 | FUNCTIONS 14장 | 테스트 ID `TC-001~009` | 계산 테스트는 `CR-*` | NO_CONFLICT | FUNCTIONS에 TC-010~017 추가, 본 문서 10.9절에서 상호 매핑 |
| C-13 | 본 문서 7.1, FUNCTIONS 5.3, PRD FR-004 (v0.7 추가) | 다른 운동 1RM의 비율 환산 금지, 임의 무게 적용 금지 | Setup 추천값 (H-15) | RESOLVED | 추천값은 사용자 확정 전 계산에 쓰지 않고, 확정 후 운동 자체 1RM이 됨을 7.1·3.6절에 명시. 스모 원본 방식은 U-18로 PENDING |
| C-12 | PRD FR-007, FUNCTIONS 9.2, TECHSTACK 5.2, 본 문서 9.4 (v0.4 추가) | "완료 후 기록 수정 허용" | 세트 완료 잠금 + 운동별 전체 세트 리셋 (H-14) | RESOLVED | 4개 문서를 새 정책으로 대체. v0.5에서 리셋 단위를 운동별 전체 세트로 변경. 완료 세션 리셋의 증량 처리는 U-14로 PENDING |

### 11.3 TDD 구현 착수 조건

다음이 충족되면 해당 함수의 구현을 시작할 수 있다.

| 함수 | 착수 가능 여부 | 선행 조건 |
|---|---|---|
| `calculateTM()` | **즉시 가능** | 없음 (U-05는 별도 함수로 분리) |
| `roundToIncrement()` | **즉시 가능** | 없음 (U-03 확정) |
| `generateFST7Sets()` | **즉시 가능** | 없음 |
| `evaluateFST7Progress()` | **즉시 가능** | U-13은 입력 단계 문제로 분리 가능 |
| `calculateT1Sets()` | 구조만 가능 (FIXTURE) | 운영 활성화에 U-01, U-02 필요 |
| `evaluateT1Progress()` | 구조만 가능 (FIXTURE) | 운영 활성화에 U-04, U-06 필요 |
| `calculateT2Sets()` / `replaceExercise()` | 구조만 가능 (FIXTURE) | 운영 활성화에 U-08, U-09 필요 (U-12 확정) |

**운영 활성화 기준:** 함수가 사용하는 모든 템플릿·규칙이 `status: "verified"`이고, 관련 `it.todo`가 실제 테스트로 전환되어 통과한 상태.
