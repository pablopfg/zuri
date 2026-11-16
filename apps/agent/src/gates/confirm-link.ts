/**
 * What the confirmation page needs without Access (E7a): its two routes and the app's hashed files,
 * which hold no data (the code is the public repository's). Never a cookie's worth: the two routes
 * take only the token, and everything else of the Zuri stays behind Access.
 */
export function confirmPassesAccess(method: string, pathname: string): boolean {
  if (method === "POST") return pathname === "/api/c/view" || pathname === "/api/c/answer";
  return (method === "GET" || method === "HEAD") && /^\/assets\/[A-Za-z0-9._-]+$/.test(pathname);
}
