// How a schedule reads ("De segunda a sexta às 09:00") and the days of the week, in pt-BR.
// Apart from the Automations screen's texts because the flows of the CRM word their
// schedules the same way: each screen that shows a schedule loads this part with its
// own code (rule P11), without the other screen's texts.
export const ptBRSchedule = {
  "web.automations.day.0": "Dom",
  "web.automations.day.1": "Seg",
  "web.automations.day.2": "Ter",
  "web.automations.day.3": "Qua",
  "web.automations.day.4": "Qui",
  "web.automations.day.5": "Sex",
  "web.automations.day.6": "Sáb",
  "web.automations.dayLong.0": "domingo",
  "web.automations.dayLong.1": "segunda",
  "web.automations.dayLong.2": "terça",
  "web.automations.dayLong.3": "quarta",
  "web.automations.dayLong.4": "quinta",
  "web.automations.dayLong.5": "sexta",
  "web.automations.dayLong.6": "sábado",
  "web.automations.schedule.once": "Uma vez, em {when}",
  "web.automations.schedule.daily": "Todo dia às {time}",
  "web.automations.schedule.weekdays": "De segunda a sexta às {time}",
  "web.automations.schedule.weekend": "Sábado e domingo às {time}",
  "web.automations.schedule.weekly": "{days}, às {time}",
  "web.automations.schedule.monthly": "Todo dia {day} às {time}",
  "web.automations.schedule.monthlyEnd": "Todo dia {day} às {time} (ou no último dia do mês)",
  "web.automations.schedule.hourly": "A cada hora",
  "web.automations.schedule.hours": "A cada {hours} horas",
  "web.automations.schedule.and": "{list} e {last}",
} as const;
