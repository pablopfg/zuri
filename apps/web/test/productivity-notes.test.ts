import { NOTE_CONTENT_MAX, type Task } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { dayOffset } from "../src/lib/recents.ts";
import { appendDictation, localDayOffset, markdownFile, noteWhen } from "../src/pages/productivity/notes.ts";
import { groupTasks, taskGroup } from "../src/pages/productivity/task-groups.ts";

const SP = "America/Sao_Paulo";
// Monday 9 November 2026, 08:12 in São Paulo.
const NOW = new Date("2026-11-09T11:12:00.000Z");

describe("noteWhen", () => {
  const when = (iso: string, zone = SP) => noteWhen(iso, NOW, "pt-BR", zone, "ontem");

  it("shows the hour today, the word yesterday, the weekday within seven days and the date before", () => {
    expect(when("2026-11-09T11:02:00.000Z")).toBe("08:02");
    expect(when("2026-11-09T00:10:00.000Z")).toBe("ontem");
    expect(when("2026-11-06T22:02:00.000Z")).toBe("sex");
    expect(when("2026-11-03T23:40:00.000Z")).toBe("ter");
    expect(when("2026-11-02T23:40:00.000Z")).toBe("02/11");
    expect(when("2025-12-31T12:00:00.000Z")).toBe("31/12/2025");
  });

  it("counts the days in the owner's zone, never the device's", () => {
    // 02:30 UTC on the 9th is still the 8th in São Paulo and already the 9th in Lisbon.
    expect(when("2026-11-09T02:30:00.000Z")).toBe("ontem");
    expect(when("2026-11-09T02:30:00.000Z", "Europe/Lisbon")).toBe("02:30");
  });

  it("a clock a little ahead on the server still reads as today, and a broken date as nothing", () => {
    expect(when("2026-11-10T03:30:00.000Z")).toBe("00:30");
    expect(when("")).toBe("");
    expect(when("not a date")).toBe("");
  });
});

describe("appendDictation", () => {
  it("puts what was said at the end, as its own paragraph", () => {
    expect(appendDictation("Lista\n- caixas\n\n", " Ligar para a transportadora. ")).toBe("Lista\n- caixas\n\nLigar para a transportadora.");
  });

  it("starts an empty note with what was said", () => {
    expect(appendDictation("  \n", "Primeira ideia")).toBe("Primeira ideia");
  });

  it("never grows past what a note holds", () => {
    const full = "a".repeat(NOTE_CONTENT_MAX - 3);
    const out = appendDictation(full, "bcdef");
    expect(out.length).toBe(NOTE_CONTENT_MAX);
    expect(out.endsWith("\n\nb")).toBe(true);
  });
});

describe("markdownFile", () => {
  it("names the file after the title, without accents or symbols", () => {
    expect(markdownFile("Vistoria do Água Verde: às 9h!", "Levar a trena.\n\n")).toEqual({ name: "vistoria-do-agua-verde-as-9h.md", text: "# Vistoria do Água Verde: às 9h!\n\nLevar a trena.\n" });
  });

  it("falls back to a plain name, and never takes a path from the title", () => {
    expect(markdownFile("???", "").name).toBe("nota.md");
    expect(markdownFile("../../etc/passwd", "").name).toBe("etc-passwd.md");
    expect(markdownFile("a".repeat(300), "").name.length).toBe(63);
  });

  it("keeps the title on one line", () => {
    expect(markdownFile("um\n# dois", "x").text).toBe("# um # dois\n\nx\n");
  });
});

describe("task groups", () => {
  const task = (id: string, over: Partial<Task>): Task => ({
    id,
    title: id,
    description: "",
    status: "todo",
    priority: "medium",
    dueAt: null,
    projectId: null,
    completedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  });

  it("follows the server's views: late, today (and undated work under way), ahead, done", () => {
    expect(taskGroup(task("late", { dueAt: "2026-11-08T21:00:00.000Z" }), NOW, SP)).toBe("overdue");
    expect(taskGroup(task("late today", { dueAt: "2026-11-09T11:11:59.000Z" }), NOW, SP)).toBe("overdue");
    expect(taskGroup(task("now", { dueAt: "2026-11-09T11:12:00.000Z" }), NOW, SP)).toBe("today");
    // 23:59:59 in São Paulo is still today; midnight is tomorrow.
    expect(taskGroup(task("end of day", { dueAt: "2026-11-10T02:59:59.000Z" }), NOW, SP)).toBe("today");
    expect(taskGroup(task("midnight", { dueAt: "2026-11-10T03:00:00.000Z" }), NOW, SP)).toBe("upcoming");
    expect(taskGroup(task("doing", { status: "in_progress" }), NOW, SP)).toBe("today");
    expect(taskGroup(task("someday", {}), NOW, SP)).toBe("upcoming");
    expect(taskGroup(task("done late", { status: "done", dueAt: "2026-11-01T00:00:00.000Z" }), NOW, SP)).toBe("completed");
  });

  it("lists the groups late first and done last, keeping the server's order inside each, without empty ones", () => {
    const groups = groupTasks(
      [task("c", { status: "done" }), task("a", { dueAt: "2026-11-09T18:00:00.000Z" }), task("late", { dueAt: "2026-11-08T21:00:00.000Z" }), task("b", { dueAt: "2026-11-09T21:00:00.000Z" })],
      NOW,
      SP,
    );
    expect(groups.map((entry) => [entry.group, entry.tasks.map((item) => item.id)])).toEqual([
      ["overdue", ["late"]],
      ["today", ["a", "b"]],
      ["completed", ["c"]],
    ]);
    expect(groupTasks([], NOW, SP)).toEqual([]);
  });
});

describe("localDayOffset", () => {
  it("counts calendar days in the owner's zone, as dayOffset does, across midnight, months, years and daylight saving", () => {
    const now = new Date("2026-11-09T11:12:00.000Z");
    const cases = ["2026-11-09T02:59:59.000Z", "2026-11-09T03:00:00.000Z", "2026-11-10T02:59:59.000Z", "2026-11-10T03:00:00.000Z", "2026-10-31T12:00:00.000Z", "2025-12-31T23:59:59.000Z", "2027-01-01T03:00:00.000Z", "2026-03-29T00:30:00.000Z"];
    for (const zone of ["America/Sao_Paulo", "Europe/Lisbon", "Asia/Tokyo", "UTC"]) {
      for (const iso of cases) expect(localDayOffset(iso, now, zone), `${iso} in ${zone}`).toBe(dayOffset(iso, now, zone));
    }
    expect(localDayOffset("2026-11-09T02:59:59.000Z", now, "America/Sao_Paulo")).toBe(-1);
    expect(localDayOffset("2026-11-10T03:00:00.000Z", now, "America/Sao_Paulo")).toBe(1);
    // A 23-hour day (Lisbon springs forward on 29 March 2026) is still one day.
    expect(localDayOffset("2026-03-29T22:30:00.000Z", new Date("2026-03-28T23:30:00.000Z"), "Europe/Lisbon")).toBe(1);
  });
});
