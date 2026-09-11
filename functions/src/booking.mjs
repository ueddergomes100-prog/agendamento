import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { id, instant, parse, fail, authorize, ownAppointment, activeEntries, overlaps, scheduleWindow } from './validation.mjs';

const managers = ['OWNER','MANAGER','RECEPTIONIST'];
const holdInput = z.object({service_id:id,professional_id:id,unit_id:id,starts_at:instant,addons:z.array(id).max(10).default([]),client_user_id:id.optional(),request_id:id});
const toISO = ms => new Date(ms).toISOString();
const row = snap => snap.exists ? snap.data() : null;
export const dayRef = (salon, professionalId, day) => salon.collection('scheduleDays').doc(`${professionalId}_${day}`);

// Shared across units: one professional cannot be booked simultaneously in two units.
// A bounded per-professional/day document serializes every booking, cancellation and block.
function busy(entry, entries, now, ignoreId) {
  return activeEntries(entries, now).some(e => e.id !== ignoreId && overlaps(e, entry));
}
function serviceDetails(catalog, p) {
  const service = catalog.services.find(x => x.id === p.service_id);
  const pro = catalog.professionals.find(x => x.id === p.professional_id);
  const unit = catalog.units.find(x => x.id === p.unit_id);
  if (!service || !pro || !unit || !catalog.service_professionals.some(x => x.service_id === service.id && x.professional_id === pro.id)) fail('Serviço, profissional ou unidade inválida.');
  const extras = catalog.addons.filter(x => x.service_id === service.id && p.addons.includes(x.id));
  if (new Set(p.addons).size !== p.addons.length || extras.length !== p.addons.length) fail('Extra inválido para este serviço.');
  return {service,pro,unit,extras,duration:service.duration_minutes + extras.reduce((n,x) => n+x.duration_minutes,0)};
}
function appendEntry(tx, ref, entries, entry, now, removeId) {
  const next = activeEntries(entries, now).filter(e => e.id !== removeId && e.id !== entry?.id);
  if (entry) next.push(entry);
  if (next.length > 400) fail('Limite de reservas do dia atingido.', 'resource-exhausted');
  tx.set(ref, {entries:next,updatedAt:Timestamp.fromMillis(now)});
}
function audit(tx, salon, uid, appointment, action, eventId = randomUUID()) {
  const now = new Date().toISOString();
  tx.set(salon.collection('auditLogs').doc(eventId), {salonId:salon.id,actorId:uid,appointmentId:appointment.id,action,created_at:now});
}
function notify(tx, db, salon, uid, a, action) {
  const eventId = randomUUID();
  audit(tx,salon,uid,a,action,eventId);
  const notice = {id:eventId,salon_id:salon.id,appointment_id:a.id,title:action==='booking_cancelled'?'Horário cancelado':action==='booking_rescheduled'?'Seu novo horário está confirmado':'Seu agendamento foi atualizado',body:`${a.service_name} com ${a.professional_name}.`,created_at:new Date().toISOString()};
  tx.set(db.doc(`users/${a.client_id}/notifications/${eventId}`),notice);
  // External delivery is a separate adapter; creating a notice never claims WhatsApp delivery.
  tx.set(salon.collection('outbox').doc(eventId),{salonId:salon.id,clientId:a.client_id,appointmentId:a.id,action,status:'PENDING',scheduledAt:Timestamp.now(),createdAt:Timestamp.now()});
  if(['booking_confirmed','booking_rescheduled'].includes(action))for(const hours of [24,2]){
    const scheduled=Date.parse(a.starts_at)-hours*3600000;
    if(scheduled>Date.now())tx.set(salon.collection('outbox').doc(`${eventId}_${hours}h`),{salonId:salon.id,clientId:a.client_id,appointmentId:a.id,expectedStart:a.starts_at,action:'booking_reminder',status:'PENDING',scheduledAt:Timestamp.fromMillis(scheduled),createdAt:Timestamp.now()});
  }
}

export async function hold(db, salon, uid, payload) {
  const p = parse(holdInput,payload);
  const holdId = `${uid}_${p.request_id}`;
  if (holdId.length > 240) fail('Identificador inválido.');
  return db.runTransaction(async tx => {
    const now = Date.now();
    const [catalogSnap,memberSnap,existing,profile,confirmed] = await tx.getAll(db.doc(`publicSalons/${salon.id}`),salon.collection('members').doc(uid),salon.collection('appointmentHolds').doc(holdId),db.doc(`users/${p.client_user_id||uid}`),salon.collection('appointments').doc(holdId));
    const member = row(memberSnap);
    const clientId = p.client_user_id || uid;
    if (clientId !== uid) authorize(member,managers);
    if (confirmed.exists) { ownAppointment(confirmed.data(),uid,member); return confirmed.data(); }
    if (existing.exists) { const a = existing.data(); ownAppointment(a,uid,member); if (a.hold_expires_at <= toISO(now)) fail('Esta reserva expirou. Escolha novamente.'); return a; }
    const published = row(catalogSnap);
    if (!published?.published) fail('Salão indisponível.');
    const catalog = published.catalog;
    const {service,pro,unit,extras,duration} = serviceDetails(catalog,p);
    if (!profile.exists || !profile.data().phone || !profile.data().name) fail('Complete nome e telefone antes de agendar.');
    const window = scheduleWindow(catalog,pro,unit.id,p.starts_at,duration+service.cleanup_minutes,now);
    const ref = dayRef(salon,pro.id,window.day);
    const day = await tx.get(ref);
    const entries = day.data()?.entries || [];
    if (busy(window,entries,now)) fail('Esse horário acabou de ser reservado. Escolha outro.', 'already-exists');
    const expires = now + 300000;
    const a = {id:holdId,salon_id:salon.id,client_id:clientId,createdBy:uid,unit_id:unit.id,professional_id:pro.id,service_id:service.id,service_name:service.name,professional_name:pro.name,client_name:profile.data().name,client_phone:profile.data().phone,starts_at:toISO(window.start),ends_at:toISO(window.start+duration*60000),blocked_until:toISO(window.end),schedule_day:window.day,status:'HOLD',hold_expires_at:toISO(expires),price_cents:service.price_cents+extras.reduce((n,x)=>n+x.price_cents,0),deposit_cents:service.deposit_cents,addons:extras,address:unit.address,timezone:unit.timezone,source:clientId===uid?'WEB':'RECEPTION',created_at:toISO(now),updated_at:toISO(now)};
    appendEntry(tx,ref,entries,{id:holdId,start:window.start,end:window.end,expiresAt:expires},now);
    tx.create(salon.collection('appointmentHolds').doc(holdId),{...a,expiresAt:Timestamp.fromMillis(expires)});
    audit(tx,salon,uid,a,'hold_created');
    return a;
  });
}

export async function changeAppointment(db,salon,uid,action,payload) {
  const p = parse(z.object({appointment_id:id,starts_at:instant.optional(),status:z.string().max(30).optional(),rating:z.number().int().min(1).max(5).optional(),comment:z.string().max(2000).default('')}),payload);
  return db.runTransaction(async tx => {
    const now = Date.now();
    const appRef = salon.collection('appointments').doc(p.appointment_id);
    const holdRef = salon.collection('appointmentHolds').doc(p.appointment_id);
    const [appSnap,holdSnap,memberSnap,catalogSnap] = await tx.getAll(appRef,holdRef,salon.collection('members').doc(uid),db.doc(`publicSalons/${salon.id}`));
    const member = row(memberSnap);
    let a = row(appSnap) || row(holdSnap);
    if (!a) { if (action === 'release_hold') return {ok:true}; fail('Reserva não encontrada.','not-found'); }
    ownAppointment(a,uid,member);
    const staff = member?.status === 'ACTIVE' && managers.includes(member.role);
    const catalog = catalogSnap.data()?.catalog;
    if (!catalog) fail('Salão indisponível.');
    if (action === 'confirm' && appSnap.exists && ['CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED'].includes(a.status)) return a;
    if (action === 'cancel' && a.status === 'CANCELLED') return a;
    if (action === 'release_hold' && appSnap.exists) return {ok:true};
    if (['confirm','release_hold'].includes(action) && a.status !== 'HOLD') fail('Esta reserva não pode ser confirmada.');
    if (action === 'confirm' && (a.hold_expires_at <= toISO(now))) fail('Sua reserva expirou. Escolha um horário novamente.');
    if (action === 'confirm' && a.deposit_cents > 0) fail('Conecte um provedor de pagamentos antes de confirmar serviços com sinal.');
    if (['cancel','reschedule'].includes(action)) {
      if (a.status !== 'CONFIRMED') fail('Este agendamento não permite esta alteração.');
      if (!staff && Date.parse(a.starts_at)-now < catalog.policies[action==='cancel'?'cancel_hours':'reschedule_hours']*3600000) fail('O prazo terminou. Fale com a recepção.');
    }
    const oldRef = dayRef(salon,a.professional_id,a.schedule_day);
    let newWindow, newRef = oldRef;
    if (action === 'reschedule') {
      if (!p.starts_at) fail('Escolha o novo horário.');
      const pro = catalog.professionals.find(x => x.id === a.professional_id);
      if (!pro) fail('Profissional indisponível.');
      newWindow = scheduleWindow(catalog,pro,a.unit_id,p.starts_at,(Date.parse(a.blocked_until)-Date.parse(a.starts_at))/60000,now);
      newRef = dayRef(salon,a.professional_id,newWindow.day);
    }
    const days = await tx.getAll(oldRef,...(newRef.path===oldRef.path?[]:[newRef]));
    const oldEntries = days[0].data()?.entries || [];
    const newEntries = (days[1] || days[0]).data()?.entries || [];
    let metricsRef, metricsSnap;
    if(action==='admin_status' && p.status==='COMPLETED' && a.status!=='COMPLETED') {
      metricsRef=salon.collection('metrics').doc(`daily_${a.schedule_day}`); metricsSnap=await tx.get(metricsRef);
    }
    if (action === 'confirm') {
      const entry = activeEntries(oldEntries,now).find(e => e.id === a.id);
      if (!entry || busy(entry,oldEntries,now,a.id)) fail('Reserva indisponível. Escolha outro horário.');
      a = {...a,status:'CONFIRMED',paymentStatus:'PAY_AT_SALON'};
      appendEntry(tx,oldRef,oldEntries,{...entry,expiresAt:null},now);
      tx.delete(holdRef);
      tx.set(db.doc(`users/${a.client_id}/salons/${salon.id}`),{salonId:salon.id,name:catalog.salon.name,slug:catalog.salon.slug,lastBooking:a.starts_at,updatedAt:Timestamp.now()},{merge:true});
      tx.set(salon.collection('clients').doc(a.client_id),{id:a.client_id,user_id:a.client_id,salonId:salon.id,name:a.client_name,phone:a.client_phone,updatedAt:Timestamp.now()},{merge:true});
    } else if (action === 'release_hold' || action === 'cancel') {
      appendEntry(tx,oldRef,oldEntries,null,now,a.id);
      if (action === 'release_hold') { tx.delete(holdRef); return {ok:true}; }
      a = {...a,status:'CANCELLED'};
    } else if (action === 'reschedule') {
      if (busy(newWindow,newEntries,now,a.id)) fail('Horário indisponível. Seu agendamento anterior foi mantido.','already-exists');
      const duration = Date.parse(a.ends_at)-Date.parse(a.starts_at);
      a = {...a,starts_at:toISO(newWindow.start),ends_at:toISO(newWindow.start+duration),blocked_until:toISO(newWindow.end),schedule_day:newWindow.day};
      if (oldRef.path !== newRef.path) appendEntry(tx,oldRef,oldEntries,null,now,a.id);
      appendEntry(tx,newRef,newEntries,{id:a.id,start:newWindow.start,end:newWindow.end,expiresAt:null},now,a.id);
    } else if (action === 'checkin') {
      if (a.status === 'CHECKED_IN') return a;
      if (a.status !== 'CONFIRMED' || DateTime.fromMillis(now,{zone:a.timezone}).toISODate() !== a.schedule_day) fail('O check-in está disponível no dia do atendimento.');
      a = {...a,status:'CHECKED_IN'};
    } else if (action === 'review') {
      ownAppointment(a,uid,null,false);
      if (a.status !== 'COMPLETED' || !p.rating) fail('Avalie um atendimento concluído.');
      a = {...a,review:{rating:p.rating,comment:p.comment}};
    } else if (action === 'admin_status') {
      authorize(member,[...managers,'PROFESSIONAL']);
      if(member.role==='PROFESSIONAL' && member.professionalId!==a.professional_id) fail('Sem permissão.','permission-denied');
      if(a.status===p.status) return a;
      const allowed = {CONFIRMED:['CHECKED_IN','NO_SHOW'],CHECKED_IN:['IN_PROGRESS'],IN_PROGRESS:['COMPLETED']};
      if (!allowed[a.status]?.includes(p.status) || (p.status==='NO_SHOW' && Date.parse(a.ends_at)>now)) fail('Transição de status inválida.');
      a = {...a,status:p.status};
      if(p.status==='NO_SHOW') appendEntry(tx,oldRef,oldEntries,null,now,a.id);
      if(metricsRef) { const m=metricsSnap.data()||{}; tx.set(metricsRef,{salonId:salon.id,date:a.schedule_day,completed:(m.completed||0)+1,revenueCents:(m.revenueCents||0)+a.price_cents,updatedAt:Timestamp.now()},{merge:true}); }
    } else fail('Ação inválida.');
    delete a.expiresAt;
    a.updated_at = toISO(now);
    tx.set(appRef,a);
    notify(tx,db,salon,uid,a,action==='cancel'?'booking_cancelled':action==='reschedule'?'booking_rescheduled':action==='confirm'?'booking_confirmed':action);
    return a;
  });
}

export async function slots(db,salon,payload) {
  const p = parse(z.object({service_id:id,unit_id:id,professional_id:z.union([id,z.literal('')]).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),addons:z.array(id).max(10).default([])}),payload);
  const doc = await db.doc(`publicSalons/${salon.id}`).get();
  if (!doc.data()?.published) fail('Salão indisponível.');
  const catalog = doc.data().catalog;
  const pros = catalog.professionals.filter(pro => (!p.professional_id || pro.id === p.professional_id) && catalog.service_professionals.some(x => x.service_id===p.service_id && x.professional_id===pro.id));
  if (pros.length > 100) fail('Selecione uma profissional.');
  const result = [], now = Date.now();
  const days = pros.length ? await db.getAll(...pros.map(pro => dayRef(salon,pro.id,p.date))) : [];
  for (const [index,pro] of pros.entries()) {
    const {service,unit,duration} = serviceDetails(catalog,{...p,professional_id:pro.id});
    const startDay = DateTime.fromISO(p.date,{zone:unit.timezone}).startOf('day');
    for(let m=0;m<1440;m+=catalog.settings.slot_minutes) {
      const start = startDay.plus({minutes:m});
      try {
        const window = scheduleWindow(catalog,pro,unit.id,start.toISO(),duration+service.cleanup_minutes,now);
        if (!busy(window,days[index].data()?.entries||[],now)) result.push({starts_at:toISO(window.start),professional_id:pro.id,professional_name:pro.name});
      } catch (e) { if(e.code!=='failed-precondition') throw e; }
    }
  }
  return result.sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).slice(0,500);
}

export async function block(db,salon,uid,payload) {
  const p=parse(z.object({professional_id:id,starts_at:instant,ends_at:instant,reason:z.string().trim().min(1).max(200),request_id:id}),payload);
  return db.runTransaction(async tx=>{
    const [memberDoc,publicDoc]=await tx.getAll(salon.collection('members').doc(uid),db.doc(`publicSalons/${salon.id}`));
    const member=memberDoc.data(); authorize(member,[...managers,'PROFESSIONAL']);
    if(member.role==='PROFESSIONAL'&&member.professionalId!==p.professional_id) fail('Sem permissão.','permission-denied');
    const c=publicDoc.data()?.catalog,pro=c?.professionals.find(x=>x.id===p.professional_id);
    if(!pro) fail('Profissional inválida.');
    const zone=c.units[0].timezone,start=DateTime.fromISO(p.starts_at,{zone}),end=DateTime.fromISO(p.ends_at,{zone});
    if(end<=start||start.toISODate()!==end.toISODate()) fail('Bloqueie um intervalo dentro do mesmo dia.');
    const ref=dayRef(salon,pro.id,start.toISODate()),snapshot=await tx.get(ref),entries=snapshot.data()?.entries||[];
    const entry={id:`block_${uid}_${p.request_id}`,start:start.toMillis(),end:end.toMillis(),expiresAt:null};
    if(entries.some(e=>e.id===entry.id)) return {ok:true};
    if(busy(entry,entries,Date.now())) fail('Já existe uma reserva neste intervalo.');
    appendEntry(tx,ref,entries,entry,Date.now());
    tx.set(salon.collection('blocks').doc(entry.id),{...p,id:entry.id,salonId:salon.id,createdBy:uid});
    audit(tx,salon,uid,{id:entry.id},'schedule_blocked'); return {ok:true};
  });
}
