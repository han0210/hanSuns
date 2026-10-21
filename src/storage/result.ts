/**
 * 저장 계층 결과 타입.
 * 호출자는 ok로 성공/실패를 구분하고, 실패 시 error 코드로 이유를 판단한다.
 * IndexedDB 자체 오류(트랜잭션 중단, 저장 공간 부족 등)는 STORAGE_ERROR로 통일하고 message에 원인을 담는다.
 */
export type StorageFailure<E extends string> = {
  readonly ok: false;
  readonly error: E | "STORAGE_ERROR";
  readonly message?: string;
};

export type StorageResult<T, E extends string> = { readonly ok: true; readonly value: T } | StorageFailure<E>;

export const success = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const failure = <E extends string>(error: E, message?: string): StorageFailure<E> =>
  message === undefined ? { ok: false, error } : { ok: false, error, message };

/** 트랜잭션 안에서 검증 실패를 표현하는 내부 값. 쓰기 전에 반환하므로 아무것도 저장되지 않는다. */
export class ValidationStop<E extends string> {
  constructor(readonly error: E, readonly message?: string) {}
}

/**
 * 저장 작업을 실행하고 예외를 STORAGE_ERROR 결과로 바꾼다.
 * 트랜잭션 안에서 예외가 나면 Dexie가 트랜잭션 전체를 롤백한다.
 * @param mapError 특정 예외를 도메인 오류 코드로 바꿀 때 사용 (예: 유일 인덱스 위반 → DUPLICATE_PROGRESSION)
 */
export async function runStorage<T, E extends string>(
  work: () => PromiseLike<T | ValidationStop<E>>,
  mapError?: (error: unknown) => E | null,
): Promise<StorageResult<T, E>> {
  try {
    const result = await work();
    if (result instanceof ValidationStop) return failure(result.error, result.message);
    return success(result);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const mapped = mapError?.(error) ?? null;
    if (mapped !== null) return failure(mapped, message);
    return { ok: false, error: "STORAGE_ERROR", message };
  }
}
