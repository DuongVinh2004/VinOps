import { DomainError } from '../errors.js';

export type ProjectCalendarConfig = {
  workingDays: readonly number[]; // 1 = Mon, ..., 7 = Sun
  holidays: readonly string[]; // ISO YYYY-MM-DD
};

export const defaultProjectCalendar: ProjectCalendarConfig = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getIsoDayOfWeek(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWorkingDay(date: Date, calendar: ProjectCalendarConfig): boolean {
  const isoDay = getIsoDayOfWeek(date);
  if (!calendar.workingDays.includes(isoDay)) {
    return false;
  }
  const dateStr = toIsoDate(date);
  if (calendar.holidays.includes(dateStr)) {
    return false;
  }
  return true;
}

/**
 * Adds N working days to a startDate according to calendar.
 */
export function addWorkingDays(
  startDate: Date,
  businessDays: number,
  calendar: ProjectCalendarConfig = defaultProjectCalendar,
): Date {
  if (businessDays <= 0) {
    throw new DomainError('INVALID_BUSINESS_DAYS', 'Business days must be greater than zero.');
  }

  const result = new Date(startDate.getTime());
  let daysAdded = 0;

  while (daysAdded < businessDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isWorkingDay(result, calendar)) {
      daysAdded += 1;
    }
  }

  return result;
}

/**
 * Counts working days between two dates [startDate, endDate).
 */
export function calculateWorkingDaysBetween(
  startDate: Date,
  endDate: Date,
  calendar: ProjectCalendarConfig = defaultProjectCalendar,
): number {
  if (endDate.getTime() <= startDate.getTime()) {
    return 0;
  }

  let count = 0;
  const cursor = new Date(startDate.getTime());
  while (cursor.getTime() < endDate.getTime()) {
    if (isWorkingDay(cursor, calendar)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

export type SlaStatusResult = {
  status: 'ok' | 'warning_48h' | 'warning_24h' | 'breached';
  hoursRemaining: number;
  isBreached: boolean;
};

/**
 * Evaluates SLA status based on due date and current time.
 */
export function evaluateSlaStatus(dueDate: Date, now: Date = new Date()): SlaStatusResult {
  const diffMs = dueDate.getTime() - now.getTime();
  const hoursRemaining = Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;

  if (diffMs <= 0) {
    return {
      status: 'breached',
      hoursRemaining,
      isBreached: true,
    };
  }

  if (hoursRemaining <= 24) {
    return {
      status: 'warning_24h',
      hoursRemaining,
      isBreached: false,
    };
  }

  if (hoursRemaining <= 48) {
    return {
      status: 'warning_48h',
      hoursRemaining,
      isBreached: false,
    };
  }

  return {
    status: 'ok',
    hoursRemaining,
    isBreached: false,
  };
}
