export function isTanzaniaNinFormat(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{20}$/.test(value);
}
