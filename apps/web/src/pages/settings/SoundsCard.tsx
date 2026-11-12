import type { MessageKey, NoticeSound, Settings, SoundPrefs } from "@zuri/shared";
import { Bell } from "lucide-react";
import { useId } from "react";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn } from "../../components/ui.tsx";
import { useSettingsMutation } from "../../hooks/settings.ts";
import { errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { NOTICE_NOTES, NOTICE_SOUNDS, play, RECORDING_NOTES } from "../../lib/sounds.ts";

// One literal key per sound, so the i18n lint sees each one.
const NAME = { sino: "web.sounds.name.sino", gota: "web.sounds.name.gota", marimba: "web.sounds.name.marimba" } as const satisfies Record<NoticeSound, MessageKey>;
const HINT = { sino: "web.sounds.hint.sino", gota: "web.sounds.hint.gota", marimba: "web.sounds.hint.marimba" } as const satisfies Record<NoticeSound, MessageKey>;

/** The "play" triangle, drawn here: the icon library's would become a piece of its own in the first load's list (rule P11). */
const Play = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
  </svg>
);

/** The end of the starting sound, then a pause: the two recording sounds one after the other, as in a short recording. */
const BETWEEN_MS = 900;

/**
 * Configurações › Avisos › Som dos avisos (12/11/2026): whether a new notice
 * sounds while the app is open, which of the three sounds, and the short sound
 * around a voice recording. Each choice is saved as it is made, and "Ouvir"
 * plays without saving anything.
 */
export function SoundsCard({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useSettingsMutation();
  const id = useId();
  const prefs = settings.sounds;
  // The card is saved whole: a second choice made while the first is still on its way builds on it, not on what was stored before.
  const latest = (save.isPending && save.variables?.sounds) || prefs;
  const change = (patch: Partial<SoundPrefs>) => save.mutate({ sounds: { ...latest, ...patch } }, { onSuccess: () => toast(t("web.alerts.saved")) });

  return (
    <Card title={t("web.sounds.title")} description={t("web.sounds.description")}>
      <div className="space-y-3">
        <Switch label={t("web.sounds.notice")} checked={prefs.notice} busy={save.isPending} onChange={(notice) => change({ notice })} />
        <div role="radiogroup" aria-label={t("web.sounds.pick")} className="space-y-2">
          {NOTICE_SOUNDS.map((sound) => {
            const picked = prefs.pick === sound;
            return (
              <div key={sound} className="flex items-center gap-3">
                <label
                  className={cn(
                    "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    picked ? "border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]" : "border-border",
                    prefs.notice ? "cursor-pointer hover:bg-raised" : "opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name={id}
                    className="sr-only"
                    checked={picked}
                    disabled={!prefs.notice}
                    aria-describedby={`${id}-${sound}`}
                    onChange={() => {
                      // The owner hears what they picked, as in the prototype.
                      play(NOTICE_NOTES[sound]);
                      change({ pick: sound });
                    }}
                  />
                  <span aria-hidden className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2", picked ? "border-accent" : "border-fg-muted")}>
                    {picked && <span className="h-2 w-2 rounded-full bg-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{t(NAME[sound])}</span>
                    <span id={`${id}-${sound}`} className="block text-fg-muted">
                      {t(HINT[sound])}
                    </span>
                  </span>
                </label>
                <Button variant="secondary" aria-label={t("web.sounds.listenNamed", { name: t(NAME[sound]) })} onClick={() => play(NOTICE_NOTES[sound])}>
                  <Play />
                  {t("web.sounds.listen")}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/60 pt-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Switch label={t("web.sounds.recording")} describedBy={`${id}-recording`} checked={prefs.recording} busy={save.isPending} onChange={(recording) => change({ recording })} />
            </div>
            <Button
              variant="secondary"
              aria-label={t("web.sounds.listenRecording")}
              onClick={() => {
                play(RECORDING_NOTES.start);
                window.setTimeout(() => play(RECORDING_NOTES.stop), BETWEEN_MS);
              }}
            >
              <Play />
              {t("web.sounds.listen")}
            </Button>
          </div>
          <p id={`${id}-recording`} className="text-sm leading-6 text-fg-muted">
            {t("web.sounds.recordingHint")}
          </p>
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4">
          <Button
            variant="secondary"
            onClick={() => {
              if (prefs.notice) play(NOTICE_NOTES[prefs.pick]);
              toast(t(prefs.notice ? "web.sounds.tested" : "web.sounds.testedOff"));
            }}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {t("web.sounds.test")}
          </Button>
          <p className="min-w-0 flex-1 basis-64 text-sm leading-6 text-fg-muted">{t("web.sounds.firstTouch")}</p>
        </div>
      </div>
    </Card>
  );
}
