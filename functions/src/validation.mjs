import { z } from 'zod';
import { DateTime } from 'luxon';
import { HttpsError } from 'firebase-functions/v2/https';

export const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const text = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 1000) => z.string().trim().max(max).default('');
export const instant = z.string().datetime({offset:true});
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => DateTime.fromISO(v).isValid);
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const money = z.number().int().min(0).max(10000000);
export const presets = ['Rose','Champagne','Blossom','Noir','Clean','Lavender','Luxury','Minimal'];
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpsError('invalid-argument', 'Confira os campos informados.', result.error.flatten());
  return result.data;
}
export function fail(message, code = 'failed-precondition') { throw new HttpsError(code, message); }
export function requireUser(uid) { if (!uid) fail('Entre na sua conta para continuar.', 'unauthenticated'); return uid; }
export function authorize(member, roles) {
  if (!member || member.status !== 'ACTIVE' || !roles.includes(member.role)) fail('Sem permissão para esta operação.', 'permission-denied');
}
export function ownAppointment(a, uid, member, staff = true) {
  if (a.client_id === uid) return;
  if (staff && member?.status === 'ACTIVE' && (['OWNER','MANAGER','RECEPTIONIST'].includes(member.role) || (member.role === 'PROFESSIONAL' && member.professionalId === a.professional_id))) return;
  fail('Agendamento não encontrado.', 'permission-denied');
}
export const overlaps = (a, b) => a.start < b.end && a.end > b.start;
export function activeEntries(entries, now) { return entries.filter(e => !e.expiresAt || e.expiresAt > now); }
export function scheduleWindow(catalog, professional, unitId, startISO, duration, now = Date.now()) {
  const unit = catalog.units.find(x => x.id === unitId);
  if (!unit) fail('Unidade inválida.');
  const start = DateTime.fromISO(startISO, {zone:unit.timezone});
  if (!start.isValid) fail('Data inválida.');
  const end = start.plus({minutes:duration});
  const settings = catalog.settings;
  if (start.toMillis() < now + settings.min_notice_minutes * 60000 || start.toMillis() > now + settings.max_future_days * 86400000) fail('Horário fora da janela permitida.');
  if (start.second !== 0 || start.millisecond !== 0 || (start.hour * 60 + start.minute) % settings.slot_minutes !== 0) fail('Escolha um horário da agenda.');
  const weekday = start.weekday % 7;
  const schedule = professional.schedules?.find(s => s.unit_id === unitId && s.weekdays.includes(weekday));
  const opening = unit.schedule;
  if (!schedule || !opening || !opening.weekdays.includes(weekday)) fail('A profissional não atende nesta data.');
  const minutes = start.hour * 60 + start.minute;
  const toMinutes = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3));
  if (start.toISODate() !== end.toISODate() || minutes < Math.max(toMinutes(schedule.opens),toMinutes(opening.opens)) || minutes + duration > Math.min(toMinutes(schedule.closes),toMinutes(opening.closes))) fail('Horário fora da jornada.');
  for (const interval of [...(schedule.breaks || []),...(opening.breaks || [])]) {
    if (overlaps({start:minutes,end:minutes + duration},{start:toMinutes(interval.start),end:toMinutes(interval.end)})) fail('Horário de intervalo.');
  }
  return {start:start.toMillis(),end:end.toMillis(),day:start.toISODate(),timezone:unit.timezone};
}
