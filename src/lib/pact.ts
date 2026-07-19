// Study Pact math — pure and shared by the popup (drawer) and the study page.
// The pact stores only the student's weekly slots (days + time of day);
// everything here is COMPUTED from "now" forward, which is what makes missed
// slots redistribute silently: Tuesday skipped simply means the remaining
// questions divide across fewer future slots. No completion tracking, ever.

import type { DocDestination, PactTime } from '../types'

export type Pact = NonNullable<DocDestination['pact']>

export const PACT_TIME_HOUR: Record<PactTime, number> = {
  morning: 9,
  lunch: 13,
  evening: 18,
  night: 21,
}

export const PACT_TIME_LABEL: Record<PactTime, string> = {
  morning: 'morning',
  lunch: 'after lunch',
  evening: 'evening',
  night: 'night',
}

export const PACT_DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// All remaining slots: dates on the pact's weekdays at the pact hour,
// strictly after `from` and no later than end-of-day of the deadline.
export function upcomingSlots(pact: Pact, dueDate: string, from = new Date(), max = 20): Date[] {
  if (pact.days.length === 0) return []
  const end = new Date(`${dueDate}T23:59:59`)
  if (isNaN(end.getTime()) || end <= from) return []
  const slots: Date[] = []
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  for (let i = 0; i < 370 && slots.length < max; i++) {
    if (pact.days.includes(cursor.getDay())) {
      const slot = new Date(cursor)
      slot.setHours(PACT_TIME_HOUR[pact.time], 0, 0, 0)
      if (slot > from && slot <= end) slots.push(slot)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return slots
}

// "today evening" / "tomorrow morning" / "Tuesday evening" — or null when no
// slot remains before the deadline.
export function nextSlotLabel(pact: Pact, dueDate: string, from = new Date()): string | null {
  const [next] = upcomingSlots(pact, dueDate, from, 1)
  if (!next) return null
  const day =
    next.toDateString() === from.toDateString() ? 'today'
    : next.toDateString() === new Date(from.getTime() + 86_400_000).toDateString() ? 'tomorrow'
    : next.toLocaleDateString(undefined, { weekday: 'long' })
  return `${day} ${PACT_TIME_LABEL[pact.time]}`
}

// Local wall-clock RFC3339, no offset (e.g. "2026-07-26T18:00:00"). Paired
// with an explicit IANA timeZone, this is how the Google Calendar event body
// wants floating-local times. Shared with the .ics builder.
export function rfc3339Local(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

// A minimal, standards-plain VCALENDAR: one 15-minute floating-local VEVENT
// per slot. A SNAPSHOT on purpose — it can't self-update without a server;
// the in-app pact line is the live truth.
export function buildPactIcs(docName: string, slots: Date[]): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
  const now = stamp(new Date())
  const safeName = docName.replace(/[\\;,]/g, ' ').slice(0, 80)
  const events = slots
    .map(slot => {
      const endSlot = new Date(slot.getTime() + 15 * 60 * 1000)
      return [
        'BEGIN:VEVENT',
        `UID:snipkeep-${slot.getTime()}@snipkeep`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(slot)}`,
        `DTEND:${stamp(endSlot)}`,
        `SUMMARY:SnipKeep · Review ${safeName}`,
        'END:VEVENT',
      ].join('\r\n')
    })
    .join('\r\n')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SnipKeep//Study Pact//EN', events, 'END:VCALENDAR'].join('\r\n')
}
