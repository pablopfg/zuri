let titleBadge = "";

/** What leads the tab's title now: the bell's number ("(3) "), or nothing (E12b). */
export function currentBadge(): string {
  return titleBadge;
}

/** Swaps the number in front of the tab's title and keeps the page's name after it. */
export function setTitleBadge(badge: string): void {
  // A page that named the tab without the badge keeps its whole name.
  const title = document.title.startsWith(titleBadge) ? document.title.slice(titleBadge.length) : document.title;
  document.title = badge + title;
  titleBadge = badge;
}
