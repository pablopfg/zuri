import { modelRate } from "./catalog-rates.ts";
import {
  AUDIO_SECONDS_PER_DAY,
  CHAT_MODELS,
  EMBEDDING_NEURONS_PER_MILLION,
  isPaidModel,
  PAID_MODEL_IDS,
  type ModelUsage,
  neuronsToUsd,
  paidUsd,
  paidProviderOf,
  ANTHROPIC_CACHE_RATES,
  type ChosenModel,
  type UsageHistory,
  type UsageHistoryDays,
  type UsageHours,
  type UsageMonths,
  USAGE_MONTHS,
  TRANSCRIPTION_NEURONS_PER_MINUTE,
  USAGE_RETENTION_DAYS,
  type UsageKind,
  type UsageReport,
  type ProviderState,
  type PaidProviderId,
  WORKERS_AI_PRICING,
} from "@zuri/shared";
import type { Database, SqlValue } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import type { StepUsage } from "./provider.ts";

/** The daily AI limits, from the owner's settings. */
export interface AiLimits {
  requestsPerDay: number;
  neuronsPerDay: number;
  maxOutputTokens: number;
  /** Step 21: the paid models' ceiling for the day in US cents; 0 (or absent) is no ceiling. */
  usdCentsPerDay?: number;
}

/** A call counted before it runs. Settled once with what it used, or released if it never started. */
export interface Reservation {
  readonly day: string;
  /** The UTC hour it was counted in: where the call shows in today's hours, whenever it ends. */
  readonly hour: number;
  readonly kind: UsageKind;
  readonly model: string;
  readonly billable: boolean;
  readonly neurons: number;
  readonly audioSeconds: number;
  /** US$ held for a paid model's call (step 21); 0 for every other. */
  readonly usd: number;
  /** The try was the fallback's (step 21): a release gives the count back too. */
  readonly fallback?: boolean;
  done: boolean;
}

const DAY_MS = 86_400_000;

/** The paid ids as SQL literals: ours, from a fixed list, never the owner's text. */
const PAID_IN = PAID_MODEL_IDS.map((id) => `'${id}'`).join(", ");

const LIMIT_MESSAGES = {
  requests: "error.aiLimit.requests",
  neurons: "error.aiLimit.neurons",
  audio: "error.aiLimit.audio",
  usd: "error.aiLimit.usd",
} as const;

/** Rates of the dearest chat model of the list: the estimate for a billable model without its own rate. */
const DEAREST = Object.values(CHAT_MODELS).reduce((a, b) => (b.input + b.output > a.input + a.output ? b : a));

/** Neurons of one chat step; a billable model off the list is priced as the dearest, never as free. */
export function stepNeurons(usage: StepUsage): number {
  // A paid model costs US$, never Neurons, whatever the flag says.
  if (!usage.billable || isPaidModel(usage.model)) return 0;
  const input = usage.input.reported + usage.input.estimated;
  const output = usage.output.reported + usage.output.estimated;
  // The catalog's last price (PR S21) or the dated table's; a model of neither is priced as the dearest.
  const rate = modelRate(usage.model);
  if (rate) return (input * rate.input + output * rate.output) / 1_000_000;
  return (input * DEAREST.input + output * DEAREST.output) / 1_000_000;
}

/** US$ of one step on a paid model (step 21); 0 for every other model. */
export function stepUsd(usage: Pick<StepUsage, "model" | "input" | "output" | "billedInput">): number {
  if (!isPaidModel(usage.model)) return 0;
  return paidUsd(usage.model, usage.billedInput ?? usage.input.reported + usage.input.estimated, usage.output.reported + usage.output.estimated);
}

export function audioNeurons(seconds: number): number {
  return (seconds / 60) * TRANSCRIPTION_NEURONS_PER_MINUTE;
}

/** Neurons of `tokens` sent to the embedding model (step 17). */
export function embeddingNeurons(tokens: number): number {
  return (tokens * EMBEDDING_NEURONS_PER_MILLION) / 1_000_000;
}

const recordModelSql = `INSERT INTO zur_model_usage_daily
    (day, model, kind, billable, calls, input_reported, input_estimated, output_reported, output_estimated, audio_seconds, neurons, cost_usd)
  VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (day, model, kind, billable) DO UPDATE SET
    calls = calls + 1,
    input_reported = input_reported + excluded.input_reported,
    input_estimated = input_estimated + excluded.input_estimated,
    output_reported = output_reported + excluded.output_reported,
    output_estimated = output_estimated + excluded.output_estimated,
    audio_seconds = audio_seconds + excluded.audio_seconds,
    neurons = neurons + excluded.neurons,
    cost_usd = cost_usd + excluded.cost_usd`;

/** What one settled call, failure or stop adds to its hour. */
interface HourUse {
  requests?: number;
  errors?: number;
  aborted?: number;
  fallbacks?: number;
  neurons?: number;
  paidUsd?: number;
  audioSeconds?: number;
}

/**
 * Today by the hour (PR S13): 24 rows that are reused. A row that still holds another day's numbers is
 * replaced by the first write of the same hour today, so midnight clears nothing. Every right-hand
 * `day` below is the row's value of before the write.
 */
const HOUR_COLUMNS = ["requests", "errors", "aborted", "fallbacks", "neurons", "paid_usd", "audio_seconds"] as const;
const recordHourSql = `INSERT INTO zur_usage_hourly (hour, day, ${HOUR_COLUMNS.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (hour) DO UPDATE SET
    ${HOUR_COLUMNS.map((c) => `${c} = excluded.${c} + CASE WHEN day = excluded.day THEN ${c} ELSE 0 END`).join(",\n    ")},
    day = excluded.day`;

/** The columns of a day that a month adds up, and the two reads of them: closed days into months, open days as they are. */
const MONTH_SUMS = `SUM(ai_requests > 0 OR ai_errors > 0 OR ai_aborted > 0 OR audio_seconds > 0 OR neurons > 0 OR paid_usd > 0) AS days, SUM(ai_requests) AS requests, SUM(ai_errors) AS errors, SUM(ai_aborted) AS aborted, SUM(ai_fallbacks) AS fallbacks,
  SUM(neurons) AS neurons, SUM(paid_usd) AS paid_usd, SUM(audio_seconds) AS audio_seconds`;
const MONTH_COLUMNS = ["days", ...HOUR_COLUMNS] as const;

interface MonthRow {
  month: string;
  days: number;
  requests: number;
  errors: number;
  aborted: number;
  fallbacks: number;
  neurons: number;
  paid_usd: number;
  audio_seconds: number;
}

/** `months` before (negative) or after the month of "YYYY-MM…". */
function shiftMonth(day: string, months: number): string {
  const total = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

interface DayRow {
  paid_usd: number;
  ai_fallbacks: number;
  ai_requests: number;
  ai_errors: number;
  ai_aborted: number;
  audio_seconds: number;
  neurons: number;
  cost_usd: number;
}

/**
 * The AI meter: every model call is counted against the day's limits *before*
 * it runs (rule P7), then settled with what it really used. Each check and its
 * count happen in one synchronous step of the Durable Object, which runs one
 * piece of JavaScript at a time: concurrent requests can never pass a limit
 * together. A call that reached the model is always settled, also when it failed
 * or was aborted halfway; one that never started gives its reservation back.
 *
 * Days are UTC days, because Cloudflare's free allocation resets at 00:00 UTC.
 */
export class UsageMeter {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  #writes = 0;
  /** The day whose closed days this wake already summed into the months. */
  #closed: string | null = null;
  #base: number | null = null;

  /**
   * The "usage" area's number (step 21): it moves with every write of the
   * counters, kept in memory so the heartbeat reads no row and the AI call
   * writes none more (rules P4 and P5). A new wake starts from a random
   * number, so the app looks again once after a restart.
   */
  get version(): number {
    // A shift, not a modulo: any 30-bit start is as likely as another, and far from the integer limit.
    this.#base ??= (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) >>> 2;
    return this.#base + this.#writes;
  }

  private write(query: string, ...params: SqlValue[]): void {
    this.db.run(query, ...params);
    this.#writes++;
  }

  static day(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  today(): string {
    return UsageMeter.day(this.clock());
  }

  private hour(): number {
    return new Date(this.clock()).getUTCHours();
  }

  /** The next 00:00 UTC, when the counters start over. */
  resetsAt(): string {
    return new Date((Math.floor(this.clock() / DAY_MS) + 1) * DAY_MS).toISOString();
  }

  /**
   * Counts one chat call of at most `inputTokens` + `maxOutputTokens`, or refuses
   * with AI_LIMIT_REACHED. `force` counts a call that already happened (the
   * provider made one more than was reserved) without checking anything.
   */
  reserveChat(
    call: { model: string; billable: boolean; inputTokens: number; maxOutputTokens: number; fallback?: boolean },
    limits: AiLimits,
    force = false,
  ): Reservation {
    const estimate = stepNeurons({
      model: call.model,
      billable: call.billable,
      input: { reported: 0, estimated: call.inputTokens },
      output: { reported: 0, estimated: call.maxOutputTokens },
    });
    // The hold is the dearest the call can cost: on Anthropic the whole prompt may be written to the cache.
    const cached = isPaidModel(call.model) && paidProviderOf(call.model) === "anthropic";
    const usd = stepUsd({
      model: call.model,
      input: { reported: 0, estimated: call.inputTokens },
      output: { reported: 0, estimated: call.maxOutputTokens },
      ...(cached ? { billedInput: call.inputTokens * ANTHROPIC_CACHE_RATES.write } : {}),
    });
    const day = this.today();
    const row = this.row(day);
    if (!force) {
      if ((row?.ai_requests ?? 0) >= limits.requestsPerDay) throw this.limitReached("requests", limits.requestsPerDay);
      if (estimate > 0 && (row?.neurons ?? 0) + estimate > limits.neuronsPerDay) throw this.limitReached("neurons", limits.neuronsPerDay);
      // The paid ceiling, only when the owner turned it on (0 is none). Compared in cents, so floats can't let one more through.
      const cents = limits.usdCentsPerDay ?? 0;
      if (usd > 0 && cents > 0 && Math.round(((row?.paid_usd ?? 0) + usd) * 1_000_000) > cents * 10_000) throw this.limitReached("usd", cents / 100);
    }
    if (!row) this.startDay(day);
    else this.closeMonths(day);
    this.write(
      // A try the fallback took over is counted in the same write (rule P4).
      `INSERT INTO zur_usage_daily (day, ai_requests, neurons, paid_usd, ai_fallbacks) VALUES (?, 1, ?, ?, ?)
       ON CONFLICT (day) DO UPDATE SET ai_requests = ai_requests + 1, neurons = neurons + excluded.neurons, paid_usd = paid_usd + excluded.paid_usd,
         ai_fallbacks = ai_fallbacks + excluded.ai_fallbacks`,
      day,
      estimate,
      usd,
      call.fallback ? 1 : 0,
    );
    return { day, hour: this.hour(), kind: "chat", model: call.model, billable: call.billable, neurons: estimate, audioSeconds: 0, usd, fallback: call.fallback === true, done: false };
  }

  /** Counts `seconds` of audio to transcribe against the hour a day and the Neuron cap. */
  reserveAudio(call: { model: string; seconds: number; billable?: boolean }, limits: AiLimits): Reservation {
    const seconds = Math.ceil(call.seconds);
    const billable = call.billable !== false;
    // The simulated transcriber costs no Neurons, but its seconds count like any others.
    const estimate = billable ? audioNeurons(seconds) : 0;
    const day = this.today();
    const row = this.row(day);
    if ((row?.audio_seconds ?? 0) + seconds > AUDIO_SECONDS_PER_DAY) throw this.limitReached("audio", AUDIO_SECONDS_PER_DAY);
    if ((row?.neurons ?? 0) + estimate > limits.neuronsPerDay) throw this.limitReached("neurons", limits.neuronsPerDay);
    if (!row) this.startDay(day);
    else this.closeMonths(day);
    this.write(
      `INSERT INTO zur_usage_daily (day, audio_seconds, neurons) VALUES (?, ?, ?)
       ON CONFLICT (day) DO UPDATE SET audio_seconds = audio_seconds + excluded.audio_seconds, neurons = neurons + excluded.neurons`,
      day,
      seconds,
      estimate,
    );
    return { day, hour: this.hour(), kind: "transcription", model: call.model, billable, neurons: estimate, audioSeconds: seconds, usd: 0, done: false };
  }

  /**
   * Counts one embedding call of about `tokens` input tokens against the Neuron
   * cap (step 17). `ceiling` lowers the cap for this call: the background
   * indexing passes half of it, so the chat always keeps the rest. Embeddings
   * are not chat requests: they never count in the requests per day.
   */
  reserveEmbedding(call: { model: string; billable: boolean; tokens: number }, limits: AiLimits, ceiling = limits.neuronsPerDay): Reservation {
    const estimate = call.billable ? embeddingNeurons(call.tokens) : 0;
    const day = this.today();
    const row = this.row(day);
    const cap = Math.min(ceiling, limits.neuronsPerDay);
    if ((row?.neurons ?? 0) + estimate > cap) throw this.limitReached("neurons", limits.neuronsPerDay);
    if (!row) this.startDay(day);
    else this.closeMonths(day);
    this.write(
      `INSERT INTO zur_usage_daily (day, neurons) VALUES (?, ?)
       ON CONFLICT (day) DO UPDATE SET neurons = neurons + excluded.neurons`,
      day,
      estimate,
    );
    return { day, hour: this.hour(), kind: "embedding", model: call.model, billable: call.billable, neurons: estimate, audioSeconds: 0, usd: 0, done: false };
  }

  /** Settles an embedding call that reached the model: `tokens` sent, estimated (the model reports none). */
  settleEmbedding(reservation: Reservation, tokens: number): void {
    if (reservation.done) return;
    reservation.done = true;
    const neurons = reservation.billable ? embeddingNeurons(tokens) : 0;
    const cost = neuronsToUsd(neurons);
    this.db.transaction(() => {
      this.adjust(reservation.day, neurons - reservation.neurons, cost);
      this.write(recordModelSql, reservation.day, reservation.model, reservation.kind, reservation.billable ? 1 : 0, 0, tokens, 0, 0, 0, neurons, cost);
      this.recordHour(reservation.day, reservation.hour, { neurons });
    });
  }

  /** Replaces a chat reservation with what the step used, on the day it was reserved. */
  settle(reservation: Reservation, usage: StepUsage): void {
    if (reservation.done) return;
    reservation.done = true;
    const neurons = stepNeurons(usage);
    const usd = stepUsd(usage);
    // A model's line keeps what it really cost: US$ for a paid one, Workers AI's list price for the rest.
    const cost = usd > 0 ? usd : neuronsToUsd(neurons);
    this.db.transaction(() => {
      this.adjust(reservation.day, neurons - reservation.neurons, usd > 0 ? 0 : cost, usd - reservation.usd);
      this.write(
        recordModelSql,
        reservation.day,
        usage.model,
        reservation.kind,
        usage.billable ? 1 : 0,
        usage.input.reported,
        usage.input.estimated,
        usage.output.reported,
        usage.output.estimated,
        0,
        neurons,
        cost,
      );
      this.recordHour(reservation.day, reservation.hour, { requests: 1, fallbacks: reservation.fallback ? 1 : 0, neurons, paidUsd: usd });
    });
  }

  /** Settles an audio reservation with the seconds really sent (never more than reserved). */
  settleAudio(reservation: Reservation, seconds: number): void {
    if (reservation.done) return;
    reservation.done = true;
    // Above the reservation when the model heard a longer clip than the estimate (MeteredAI.transcribe).
    const used = Math.max(0, Math.ceil(seconds));
    const neurons = reservation.billable ? audioNeurons(used) : 0;
    const cost = neuronsToUsd(neurons);
    this.db.transaction(() => {
      this.write(
        `UPDATE zur_usage_daily SET audio_seconds = max(0, audio_seconds - ?) WHERE day = ?`,
        reservation.audioSeconds - used,
        reservation.day,
      );
      this.adjust(reservation.day, neurons - reservation.neurons, cost);
      this.write(recordModelSql, reservation.day, reservation.model, reservation.kind, reservation.billable ? 1 : 0, 0, 0, 0, 0, used, neurons, cost);
      this.recordHour(reservation.day, reservation.hour, { audioSeconds: used, neurons });
    });
  }

  /** What is left of today's audio hour and Neuron cap (a Telegram file asks before using it, step 14). */
  room(limits: AiLimits): { audioSeconds: number; neurons: number } {
    const row = this.row(this.today());
    return {
      audioSeconds: Math.max(0, AUDIO_SECONDS_PER_DAY - (row?.audio_seconds ?? 0)),
      neurons: Math.max(0, limits.neuronsPerDay - (row?.neurons ?? 0)),
    };
  }

  /** Gives back a reservation whose call never reached the model. */
  release(reservation: Reservation): void {
    if (reservation.done) return;
    reservation.done = true;
    this.write(
      `UPDATE zur_usage_daily SET
         ai_requests = max(0, ai_requests - ?),
         audio_seconds = max(0, audio_seconds - ?),
         neurons = max(0, neurons - ?),
         paid_usd = max(0, paid_usd - ?),
         ai_fallbacks = max(0, ai_fallbacks - ?)
       WHERE day = ?`,
      reservation.kind === "chat" ? 1 : 0,
      reservation.audioSeconds,
      reservation.neurons,
      reservation.usd,
      reservation.fallback ? 1 : 0,
      reservation.day,
    );
  }

  /** One turn that ended in an error, or that was stopped before its end. */
  failed(day: string, aborted: boolean): void {
    this.write(
      aborted
        ? `INSERT INTO zur_usage_daily (day, ai_aborted) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET ai_aborted = ai_aborted + 1`
        : `INSERT INTO zur_usage_daily (day, ai_errors) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET ai_errors = ai_errors + 1`,
      day,
    );
    this.recordHour(day, this.hour(), aborted ? { aborted: 1 } : { errors: 1 });
  }

  /** Today against the limits, and the last 7 days: about 7 + one row per model used today. */
  report(
    limits: AiLimits,
    provider: UsageReport["provider"],
    model: ChosenModel,
    providers: { id: PaidProviderId; configured: boolean; state: ProviderState }[] = [],
  ): UsageReport {
    const day = this.today();
    const row = this.row(day);
    const from = UsageMeter.day(this.clock() - 6 * DAY_MS);
    const models = this.db
      .all<{
        model: string;
        kind: UsageKind;
        billable: number;
        calls: number;
        input_reported: number;
        input_estimated: number;
        output_reported: number;
        output_estimated: number;
        audio_seconds: number;
        neurons: number;
        cost_usd: number;
      }>(`SELECT * FROM zur_model_usage_daily WHERE day = ? ORDER BY neurons DESC, calls DESC, model`, day)
      .map(
        (m): ModelUsage => ({
          model: m.model,
          kind: m.kind,
          billable: m.billable === 1,
          calls: m.calls,
          inputTokens: m.input_reported + m.input_estimated,
          outputTokens: m.output_reported + m.output_estimated,
          estimatedTokens: m.input_estimated + m.output_estimated,
          audioSeconds: m.audio_seconds,
          neurons: m.neurons,
          costUsd: m.cost_usd,
        }),
      );
    const lastDays = this.db.all<{ day: string; requests: number; neurons: number }>(
      `SELECT day, ai_requests AS requests, neurons FROM zur_usage_daily WHERE day >= ? AND day <= ? ORDER BY day`,
      from,
      day,
    );
    return {
      day,
      resetsAt: this.resetsAt(),
      provider,
      model,
      today: {
        requests: row?.ai_requests ?? 0,
        errors: row?.ai_errors ?? 0,
        aborted: row?.ai_aborted ?? 0,
        neurons: row?.neurons ?? 0,
        costUsd: row?.cost_usd ?? 0,
        paidUsd: row?.paid_usd ?? 0,
        fallbacks: row?.ai_fallbacks ?? 0,
        audioSeconds: row?.audio_seconds ?? 0,
        models,
      },
      limits: {
        requestsPerDay: limits.requestsPerDay,
        neuronsPerDay: limits.neuronsPerDay,
        audioSecondsPerDay: AUDIO_SECONDS_PER_DAY,
        maxOutputTokens: limits.maxOutputTokens,
        usdCentsPerDay: limits.usdCentsPerDay ?? 0,
      },
      lastDays,
      providers,
      pricing: { ...WORKERS_AI_PRICING },
    };
  }

  /**
   * The usage panel (step 21): the last `days` days, today included. Reads at
   * most 90 day rows and the period's model rows, grouped in SQL (rule P2).
   */
  history(days: UsageHistoryDays): UsageHistory {
    const to = this.today();
    const from = UsageMeter.day(this.clock() - (days - 1) * DAY_MS);
    const dayRows = this.db.all<{
      day: string;
      requests: number;
      errors: number;
      aborted: number;
      fallbacks: number;
      neurons: number;
      paid_usd: number;
      audio_seconds: number;
    }>(
      `SELECT day, ai_requests AS requests, ai_errors AS errors, ai_aborted AS aborted, ai_fallbacks AS fallbacks, neurons, paid_usd, audio_seconds
       FROM zur_usage_daily WHERE day >= ? AND day <= ? ORDER BY day`,
      from,
      to,
    );
    const modelRows = this.db.all<{ model: string; kind: UsageKind; calls: number; input: number; output: number; neurons: number; cost_usd: number }>(
      `SELECT model, kind, SUM(calls) AS calls, SUM(input_reported + input_estimated) AS input, SUM(output_reported + output_estimated) AS output,
         SUM(neurons) AS neurons, SUM(cost_usd) AS cost_usd
       FROM zur_model_usage_daily WHERE day >= ? AND day <= ? GROUP BY model, kind ORDER BY SUM(calls) DESC, model`,
      from,
      to,
    );
    const paidRows = this.db.all<{ day: string; model: string; usd: number }>(
      `SELECT day, model, SUM(cost_usd) AS usd FROM zur_model_usage_daily
       WHERE day >= ? AND day <= ? AND model IN (${PAID_IN}) GROUP BY day, model ORDER BY day, model`,
      from,
      to,
    );
    return {
      from,
      to,
      days: dayRows.map((r) => ({
        day: r.day,
        requests: r.requests,
        errors: r.errors,
        aborted: r.aborted,
        fallbacks: r.fallbacks,
        neurons: r.neurons,
        paidUsd: r.paid_usd,
        audioSeconds: r.audio_seconds,
      })),
      models: modelRows.map((r) => ({
        model: r.model,
        kind: r.kind,
        calls: r.calls,
        inputTokens: r.input,
        outputTokens: r.output,
        neurons: r.neurons,
        costUsd: r.cost_usd,
        paid: isPaidModel(r.model),
      })),
      paidByDay: paidRows.filter((r) => r.usd > 0),
    };
  }

  /** Today by the hour (PR S13): the hours that had any use, out of 24 rows at most. Writes nothing. */
  hours(): UsageHours {
    const day = this.today();
    // The column only holds 0 to 23 (the hour of the UTC day the meter writes).
    const rows = this.db.all<{ hour: UsageHours["hours"][number]["hour"]; requests: number; errors: number; aborted: number; fallbacks: number; neurons: number; paid_usd: number; audio_seconds: number }>(
      `SELECT hour, ${HOUR_COLUMNS.join(", ")} FROM zur_usage_hourly WHERE day = ? ORDER BY hour`,
      day,
    );
    return {
      day,
      hours: rows.map((r) => ({
        hour: r.hour,
        requests: r.requests,
        errors: r.errors,
        aborted: r.aborted,
        fallbacks: r.fallbacks,
        neurons: r.neurons,
        paidUsd: r.paid_usd,
        audioSeconds: r.audio_seconds,
      })),
    };
  }

  /**
   * The year by the month (PR S13): the 12 months that end in the current one. Reads the months already
   * summed (12 rows at most) and the days not yet in them: today, yesterday, and whatever a long time
   * without use left open. Writes nothing.
   */
  months(): UsageMonths {
    const today = this.today();
    const to = today.slice(0, 7);
    const from = shiftMonth(to, 1 - USAGE_MONTHS);
    const summed = this.db.all<MonthRow & { last_day: string }>(
      `SELECT month, last_day, ${MONTH_COLUMNS.join(", ")} FROM zur_usage_monthly WHERE month >= ? AND month <= ? ORDER BY month`,
      from,
      to,
    );
    // The newest month holds the last day summed. With none in the year, every day summed is older than it.
    const last = summed.at(-1)?.last_day ?? "";
    const open = this.db.all<MonthRow>(
      `SELECT substr(day, 1, 7) AS month, ${MONTH_SUMS} FROM zur_usage_daily WHERE day > ? AND day >= ? AND day <= ? GROUP BY substr(day, 1, 7) ORDER BY month`,
      last,
      `${from}-01`,
      today,
    );
    const months = new Map<string, MonthRow>();
    for (const row of [...summed, ...open]) {
      const month = months.get(row.month);
      if (!month) months.set(row.month, { ...row });
      else for (const column of MONTH_COLUMNS) month[column] += row[column];
    }
    return {
      from,
      to,
      months: [...months.values()]
        // A day whose only reservation was given back used nothing: it is not a day, nor a month, with use.
        .filter((r) => r.days > 0)
        .sort((a, b) => (a.month < b.month ? -1 : 1))
        .map((r) => ({
          month: r.month,
          days: r.days,
          requests: r.requests,
          errors: r.errors,
          aborted: r.aborted,
          fallbacks: r.fallbacks,
          neurons: r.neurons,
          paidUsd: r.paid_usd,
          audioSeconds: r.audio_seconds,
        })),
    };
  }

  /** A call of another day (it ended after midnight) stays out: the hours are only today's. */
  private recordHour(day: string, hour: number, use: HourUse): void {
    if (day !== this.today()) return;
    this.write(recordHourSql, hour, day, use.requests ?? 0, use.errors ?? 0, use.aborted ?? 0, use.fallbacks ?? 0, use.neurons ?? 0, use.paidUsd ?? 0, use.audioSeconds ?? 0);
  }

  /**
   * Sums the closed days into their months, before the 90 days remove them. Yesterday stays open one
   * more day: a call that started before midnight may still be settled on it, and a sum taken now
   * would miss that. `months()` reads the open days themselves, so the year is never behind.
   */
  private closeMonths(day: string): void {
    // Once a day at a day's first call, and once more per wake (one row read): an instance updated on a
    // day it had already used would otherwise read every day at each look at the year until tomorrow.
    if (this.#closed === day) return;
    this.#closed = day;
    const through = UsageMeter.day(Date.parse(`${day}T00:00:00Z`) - 2 * DAY_MS);
    const last = this.db.one<{ last_day: string }>(`SELECT last_day FROM zur_usage_monthly ORDER BY month DESC LIMIT 1`)?.last_day ?? "";
    if (through > last) {
      this.write(
        `INSERT INTO zur_usage_monthly (month, last_day, ${MONTH_COLUMNS.join(", ")})
         SELECT substr(day, 1, 7), MAX(day), ${MONTH_SUMS} FROM zur_usage_daily WHERE day > ? AND day <= ? GROUP BY substr(day, 1, 7)
         ON CONFLICT (month) DO UPDATE SET last_day = excluded.last_day, ${MONTH_COLUMNS.map((c) => `${c} = ${c} + excluded.${c}`).join(", ")}`,
        last,
        through,
      );
      // A month out of the year the panel shows is of no use to anyone (rule P13). Only a new day
      // to sum can push one out, and the read of the year never goes past its 12 months anyway.
      this.write(`DELETE FROM zur_usage_monthly WHERE month < ?`, shiftMonth(day, 1 - USAGE_MONTHS));
    }
  }

  private row(day: string): DayRow | null {
    return this.db.one<DayRow>(
      `SELECT ai_requests, ai_errors, ai_aborted, ai_fallbacks, audio_seconds, neurons, cost_usd, paid_usd FROM zur_usage_daily WHERE day = ?`,
      day,
    );
  }

  /** A day's first call also sums the closed days into their months and removes the history past the retention: 90 days, today included (rule P13). */
  private startDay(day: string): void {
    const cutoff = UsageMeter.day(Date.parse(`${day}T00:00:00Z`) - USAGE_RETENTION_DAYS * DAY_MS);
    this.closeMonths(day);
    this.write(`DELETE FROM zur_usage_daily WHERE day <= ?`, cutoff);
    this.write(`DELETE FROM zur_model_usage_daily WHERE day <= ?`, cutoff);
  }

  /** `cost` is Workers AI's list price of the call; `usd` the change of what the paid models cost (step 21). */
  private adjust(day: string, neurons: number, cost: number, usd = 0): void {
    // An absent row (it was purged, or the day was never reserved) is created, so nothing is lost.
    this.write(
      `INSERT INTO zur_usage_daily (day, neurons, cost_usd, paid_usd) VALUES (?, max(0, ?), ?, max(0, ?))
       ON CONFLICT (day) DO UPDATE SET neurons = max(0, neurons + ?), cost_usd = cost_usd + excluded.cost_usd, paid_usd = max(0, paid_usd + ?)`,
      day,
      neurons,
      cost,
      usd,
      neurons,
      usd,
    );
  }

  private limitReached(limit: "requests" | "neurons" | "audio" | "usd", max: number): AppError {
    const resetsAt = this.resetsAt();
    const retryAfter = Math.max(1, Math.ceil((Date.parse(resetsAt) - this.clock()) / 1000));
    return new AppError("AI_LIMIT_REACHED", LIMIT_MESSAGES[limit], { limit, max, resetsAt, retryAfter });
  }
}
