export function escapeUsernameLikePattern(username: string) {
  return username.replace(/[\\%_]/g, "\\$&");
}
