import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const EMAIL = "dono@exemplo.com.br";
/** The password whose hash is OWNER_PASSWORD_HASH in playwright.config.ts. */
export const PASSWORD = "e2e girafa trombone neblina";
export const CSRF = { "x-zuri-request": "1" };

/**
 * A word no other test of the run will repeat: `prefix` and 12 random letters.
 * The database lives through the whole run (one server, one worker), so a title
 * made by two tests must never come out the same (#240). Each hex digit turns
 * into a letter (0-9 into g-p), keeping all its randomness without a digit,
 * which would read as a number in the screens' counts.
 */
export function uniqueTag(prefix: string): string {
  return `${prefix}${crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .replace(/\d/g, (d) => String.fromCharCode(103 + Number(d)))}`;
}

/** The sign-in form, as the owner fills it (pt-BR, the default). */
export async function signIn(page: Page, password = PASSWORD) {
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  // The button no longer waits for the robot check (it marks it instead): the helper does.
  await page.locator('[data-testid="turnstile"][data-solved="true"]').waitFor();
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** No serious or critical axe violation on the page as it is now. */
export async function expectAccessible(page: Page, label: string) {
  // Mid-entrance a fading element reads as low contrast: check the state the owner ends up seeing.
  // Only finite animations: an endless one (a spinner, the busy logo) never settles.
  // A theme switched just before (emulateMedia) starts its color transitions only at the next style pass:
  // wait two frames so getAnimations sees them, instead of reading half-faded colors.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(serious).toEqual([]);
}

/**
 * Nothing of the entry frame is cut off or scrolls sideways, on the narrowest phone and on a wide
 * computer. The window goes back to the size the test had.
 */
export async function expectFits(page: Page, label: string) {
  const before = page.viewportSize();
  for (const [width, height] of [
    [320, 568],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // What is drawn from a measured size (the memory map) follows the window at the next frame: read the settled layout.
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const wide = [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && !el.closest(".zuri-entry-art, .sr-only") && (box.right > root.clientWidth + 1 || box.left < -1);
      });
      return { sideways: root.scrollWidth > root.clientWidth, wide: wide.map((el) => `${el.tagName}.${el.className}`) };
    });
    expect(overflow, `${label} at ${width}x${height}`).toEqual({ sideways: false, wide: [] });
  }
  if (before) await page.setViewportSize(before);
}

/** Visible controls under 44 px tall (the touch target the interface promises). */
export function tooSmallControls(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, a[href], select, input:not([type=radio])")]
      // Visible ones only; the skip link is 1 px until focused, then a full-size target.
      .filter((el) => el.offsetParent !== null && !el.matches(".sr-only, .zuri-skip:not(:focus)"))
      .map((el) => ({ text: el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName, height: el.getBoundingClientRect().height }))
      // Layout works in 1/64 px units and a transform or zoom can leave a 44 px box at
      // 43.9999 px: anything within one layout unit of 44 is 44, never a smaller target.
      .filter((el) => el.height < 44 - 1 / 64),
  );
}

/** True where settings shows tabs (a computer); a phone gets a list of sections, each on its own screen. */
export function settingsHasTabs(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** The page title inside a settings section: "Configurações" beside the tabs on a computer, the section's own name on a phone (stage 26c). */
export function settingsTitle(page: Page, section: string) {
  return page.getByRole("heading", { level: 1, name: settingsHasTabs(page) ? "Configurações" : section, exact: true });
}

/** Opens a settings section the way the owner does: the tab on a computer, the list on a phone. */
export async function openSettingsSection(page: Page, name: string) {
  const sections = page.getByRole("navigation", { name: "Seções das configurações" });
  if (!settingsHasTabs(page) && (await sections.count()) === 0) await page.getByRole("link", { name: "Todas as configurações" }).click();
  await sections.getByRole("link", { name, exact: true }).click();
}

/** True where the shell is the phone's: a top bar and a bottom bar instead of the side menu (Tailwind's md). */
export function navIsPhone(page: Page) {
  return (page.viewportSize()?.width ?? 0) < 768;
}

/** The places of the phone's bottom bar; the others are behind "Mais". */
const TABS = ["Início", "Conversa", "Tarefas", "Agenda"];

/**
 * Goes to a place the way the owner does: the side menu on a computer; on a
 * phone, the bottom bar or the "Mais" sheet. Tarefas may carry today's count.
 */
export async function openPlace(page: Page, place: string) {
  const name = new RegExp(`^${place}( \\d+)?$`);
  if (!navIsPhone(page)) return page.locator("aside").getByRole("link", { name }).click();
  if (TABS.includes(place)) return page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page.getByRole("dialog", { name: "Mais" }).getByRole("link", { name }).click();
}

/** Opens the account panel (Conta e perfil, Segurança, Avisos, Configurações, Versão, tema, Sair): beside the menu on a computer, a sheet on a phone. */
export async function openAccountMenu(page: Page) {
  // The side menu's button on a computer, the top bar's on a phone: only one shows.
  await page.getByRole("button", { name: /^Menu da conta:/ }).filter({ visible: true }).click();
  return page.getByRole("dialog", { name: "Sua conta" });
}

/** Signs out the way the owner does: the account panel's "Sair". */
export async function signOutFromMenu(page: Page) {
  const panel = await openAccountMenu(page);
  await panel.getByRole("button", { name: "Sair", exact: true }).click();
}

/** Picks an action from a row's "⋯ Mais opções" menu (stage 26c). */
export async function rowAction(row: Locator, page: Page, name: string) {
  await row.getByRole("button", { name: /^Mais opções/ }).click();
  await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
}

/**
 * Notes every sound the page asks the browser to play, by the pitch of each
 * note (Hz), in order: the test hears with it. Call before the page loads.
 */
export async function listenToSounds(page: Page) {
  await page.addInitScript(() => {
    const heard: number[] = [];
    (window as unknown as { zuriHeard: number[] }).zuriHeard = heard;
    const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const oscillator = make.call(this);
      const set = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      oscillator.frequency.setValueAtTime = (value: number, at: number) => {
        heard.push(value);
        return set(value, at);
      };
      return oscillator;
    };
  });
}

/** The pitches played since the page loaded (see listenToSounds). */
export function soundsHeard(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { zuriHeard: number[] }).zuriHeard);
}

/** The notes of each sound, as the prototype the owner approved has them. */
export const SOUND_NOTES = {
  sino: [987.77, 1975.5, 1318.5, 2637],
  gota: [1500, 760],
  marimba: [783.99, 3135.96, 987.77, 3951.08, 1174.66, 4698.64],
  start: [620, 930],
  stop: [930, 620],
} as const;
