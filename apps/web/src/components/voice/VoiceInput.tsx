import { ptBRVoice, VOICE_LIMITS } from "@zuri/shared";
import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { Button, cn } from "../ui.tsx";
import { type useVoice, voiceSupported } from "./voice.ts";

// The microphone's texts come with it, to whichever screen shows it first (rule P11).
addMessages(ptBRVoice);

type Voice = ReturnType<typeof useVoice>;

/** Seconds as the recording clock shows them: 0:03, 2:00. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * The one recording control of the app (Sinal, PRs S05 and S07): every field that
 * takes voice (the conversation, the Início, the text of a note) shows this
 * button and this line, so recording looks and reads the same wherever the
 * owner speaks. The button starts and stops; the line says the time while it
 * records, that the audio is becoming text, or what failed. Nothing shows
 * where the browser can't record. `label` names the button where "speak
 * instead of typing" would not say where the text lands.
 */
export function VoiceButton({ voice, disabled = false, label, className }: { voice: Voice; disabled?: boolean; label?: string; className?: string }) {
  const { t } = useI18n();
  if (!voiceSupported()) return null;
  const recording = voice.state.phase === "recording";
  return (
    <Button
      variant="ghost"
      className={cn("h-11 w-11 shrink-0 rounded-2xl px-0", className)}
      aria-label={recording ? t("web.voice.stop") : (label ?? t("web.voice.start"))}
      aria-pressed={recording}
      disabled={disabled || voice.state.phase === "transcribing"}
      onClick={() => (recording ? voice.stop() : void voice.start())}
    >
      {recording ? <Square className="h-4 w-4 shrink-0 fill-current text-danger" aria-hidden /> : <Mic className="h-5 w-5 shrink-0" aria-hidden />}
    </Button>
  );
}

/** What the recording is doing, above the field it writes to; empty while nothing happens. */
export function VoiceStatus({ voice }: { voice: Voice }) {
  const { t } = useI18n();
  const { state } = voice;
  const error = voice.error ? ("key" in voice.error ? t(voice.error.key) : voice.error.message) : null;
  if (state.phase === "idle" && !error) return null;
  return (
    <div aria-live="polite" className="flex items-center justify-between gap-2 px-3 pt-1 text-sm">
      {state.phase === "recording" && (
        <span className="inline-flex items-center gap-2 font-medium text-danger">
          <span className="h-2 w-2 rounded-full bg-danger motion-safe:animate-pulse" aria-hidden />
          {t("web.voice.recording", { time: clock(state.seconds), max: clock(VOICE_LIMITS.maxClipSeconds) })}
        </span>
      )}
      {state.phase === "transcribing" && (
        <span className="inline-flex items-center gap-2 text-fg-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
          {t("web.voice.transcribing")}
        </span>
      )}
      {error && state.phase === "idle" && (
        <span role="alert" className="flex-1 text-danger">
          {error}
        </span>
      )}
      {error && (
        <Button variant="ghost" className="h-11 w-11 px-0" aria-label={t("web.close")} onClick={voice.clearError}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
