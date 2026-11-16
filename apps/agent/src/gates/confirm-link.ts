/**
 * What the confirmation page needs without Access (E7a): its two routes and the app's hashed files,
 * which hold no data (the code is the public repository's). Never a cookie's worth: the two routes
 * take only the token, and everything else of the Zuri stays behind Access.
 */
const PUBLIC_POSTS = new Set(["/api/c/view", "/api/c/answer", "/api/c/days", "/api/c/offer", "/api/c/reschedule"]);

export function confirmPassesAccess(method: string, pathname: string): boolean {
  if (method === "POST") return PUBLIC_POSTS.has(pathname);
  return (method === "GET" || method === "HEAD") && /^\/assets\/[A-Za-z0-9._-]+$/.test(pathname);
}
