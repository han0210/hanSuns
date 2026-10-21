/**
 * ID와 시각 유틸.
 * crypto.randomUUID는 보안 컨텍스트(HTTPS·localhost)에서만 동작하므로,
 * 휴대폰에서 개발 서버(http://LAN IP)로 접속하는 경우를 위해 getRandomValues로 대체 생성한다.
 */
export function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 저장 시각은 항상 UTC ISO 8601 (밀리초 포함, 예: 2026-10-21T09:00:00.000Z) */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
export const toIsoDateTime = (clock: Clock): string => clock().toISOString();
