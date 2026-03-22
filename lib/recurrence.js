import {
  format as formatDateValue,
  getDaysInMonth,
  isValid as isValidDate,
  parseISO,
  setDate as setDayOfMonth,
  startOfMonth as getStartOfMonth,
} from "date-fns";
import { RRule } from "rrule";

function parseDateKey(value) {
  return parseISO(String(value ?? ""));
}

function localDate(date) {
  return formatDateValue(date, "yyyy-MM-dd");
}

export function buildRecurringDatesWithRRule({ startDate, frequency, endDate, isRecurringIndefinite, displayEnd }) {
  if (!startDate) return [];

  const start = parseDateKey(startDate);
  const limit = parseDateKey(displayEnd);
  const explicitEnd = endDate ? parseDateKey(endDate) : null;

  if (!isValidDate(start) || !isValidDate(limit) || start > limit) {
    return [];
  }

  if (frequency === "Unico") {
    return [localDate(start)];
  }

  if (!isRecurringIndefinite && !explicitEnd) {
    return [localDate(start)];
  }

  const effectiveEnd = explicitEnd && explicitEnd < limit ? explicitEnd : limit;

  if (frequency === "Mensual") {
    return new RRule({
      freq: RRule.MONTHLY,
      interval: 1,
      dtstart: getStartOfMonth(start),
      until: effectiveEnd,
      bymonthday: 1,
    })
      .all()
      .slice(0, 5000)
      .map((monthAnchor) => {
        const monthStart = getStartOfMonth(monthAnchor);
        const safeDay = Math.min(start.getDate(), getDaysInMonth(monthStart));

        return setDayOfMonth(monthStart, safeDay);
      })
      .filter((candidateDate) => candidateDate >= start && candidateDate <= effectiveEnd)
      .map((candidateDate) => localDate(candidateDate));
  }

  const interval = frequency === "Bi-semanal" ? 2 : 1;

  return new RRule({
    freq: RRule.WEEKLY,
    interval,
    dtstart: start,
    until: effectiveEnd,
  })
    .all()
    .slice(0, 5000)
    .map((candidateDate) => localDate(candidateDate));
}
