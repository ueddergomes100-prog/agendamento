import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {PresentationApi} from '../shared/presentation.ts';
import {dateKey,calendarICS,themeFor} from '../shared/theme.ts';
import {readLocal,writeLocal,preferenceKey} from '../shared/local-preferences.ts';

let api,catalog;
beforeEach(async()=>{
  const memory=new Map();
  globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};
  api=new PresentationApi();await api.init();
  catalog=await api.rpc('catalog',{slug:'maison-bella'});
});
async function selection(offset=5){
  let date=dateKey(offset);
  if(new Date(date+'T12:00:00-03:00').getDay()===0)date=dateKey(offset+1);
  const service=catalog.services[0];
  const payload={salon_id:catalog.salon.id,unit_id:catalog.units[0].id,service_id:service.id,date};
  const slots=await api.rpc('slots',payload);assert.ok(slots.length);
  return {...payload,...slots[0]};
}
test('reserva, confirmação, persistência, reagendamento e cancelamento',async()=>{
  const chosen=await selection();const hold=await api.rpc('hold',chosen);
  const confirmed=await api.rpc('confirm',{salon_id:catalog.salon.id,appointment_id:hold.id});
  assert.equal(confirmed.status,'CONFIRMED');
  const restored=new PresentationApi();await restored.init();
  assert.ok((await restored.rpc('appointments',{salon_id:catalog.salon.id})).some(a=>a.id===hold.id));
  const next=await selection(9);
  const changed=await api.rpc('reschedule',{salon_id:catalog.salon.id,appointment_id:hold.id,starts_at:next.starts_at});
  assert.equal(changed.starts_at,next.starts_at);
  const cancelled=await api.rpc('cancel',{salon_id:catalog.salon.id,appointment_id:hold.id});
  assert.equal(cancelled.status,'CANCELLED');
});
test('cliques concorrentes não ocupam o mesmo horário duas vezes',async()=>{
  const chosen=await selection();
  const results=await Promise.allSettled([api.rpc('hold',chosen),api.rpc('hold',chosen)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('fechar e liberar uma reserva impede confirmação posterior',async()=>{
  const hold=await api.rpc('hold',await selection());
  await api.rpc('release_hold',{salon_id:catalog.salon.id,appointment_id:hold.id});
  await assert.rejects(api.rpc('confirm',{salon_id:catalog.salon.id,appointment_id:hold.id}),/não pode mais/);
});
test('prazo de cancelamento e reagendamento é respeitado na apresentação',async()=>{
  const hold=await api.rpc('hold',await selection());
  await api.rpc('confirm',{salon_id:catalog.salon.id,appointment_id:hold.id});
  api.state.catalogs[0].policies={cancel_hours:1000,reschedule_hours:1000};
  await assert.rejects(api.rpc('cancel',{salon_id:catalog.salon.id,appointment_id:hold.id}),/prazo/);
  await assert.rejects(api.rpc('reschedule',{salon_id:catalog.salon.id,appointment_id:hold.id,starts_at:hold.starts_at}),/prazo/);
  assert.equal(api.state.appointments.find(a=>a.id===hold.id).status,'CONFIRMED');
});
test('extras de outro serviço e unidade desconhecida são recusados',async()=>{
  const chosen=await selection();
  await assert.rejects(api.rpc('hold',{...chosen,unit_id:'missing'}),/unidade válida/);
  await assert.rejects(api.rpc('hold',{...chosen,addons:['missing-addon']}),/extras disponíveis/);
});
test('reagendamento indisponível preserva a reserva anterior',async()=>{
  const chosen=await selection();const hold=await api.rpc('hold',chosen);
  await api.rpc('confirm',{salon_id:catalog.salon.id,appointment_id:hold.id});
  const second=await selection(9);await api.rpc('hold',second);
  await assert.rejects(api.rpc('reschedule',{salon_id:catalog.salon.id,appointment_id:hold.id,starts_at:second.starts_at}),/anterior foi mantido/);
  assert.equal(api.state.appointments.find(a=>a.id===hold.id).starts_at,hold.starts_at);
});
test('rotinas e inspirações persistem separadamente por cliente e salão',()=>{
  const key=preferenceKey('bella','ana','routine');writeLocal(key,{frequency:21});
  assert.deepEqual(readLocal(key,{}),{frequency:21});
  assert.deepEqual(readLocal(preferenceKey('lavender','ana','routine'),{}),{});
  assert.deepEqual(readLocal(preferenceKey('bella','outra','routine'),{}),{});
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.deepEqual(readLocal(key,{}),{});assert.doesNotThrow(()=>writeLocal(key,{}));
});
test('calendário contém horário e endereço; Noir usa estados legíveis',async()=>{
  const hold=await api.rpc('hold',await selection());const ics=calendarICS(hold);
  assert.match(ics,/BEGIN:VEVENT/);assert.match(ics,/DTSTART:\d{8}T\d{6}Z/);assert.match(ics,/LOCATION:/);
  assert.notEqual(themeFor('Noir').success,themeFor('Rose').success);
});
test('favoritos e notificações não acompanham a cliente para outro salão',async()=>{
  assert.ok((await api.rpc('favorites',{salon_id:catalog.salon.id})).length);
  assert.deepEqual(await api.rpc('favorites',{salon_id:'demo-lavender'}),[]);
  assert.deepEqual((await api.rpc('notifications',{salon_id:'demo-lavender'})).items,[]);
  await api.register('nova@exemplo.com','password','Nova Cliente','11999990000');
  assert.deepEqual(await api.rpc('favorites',{salon_id:catalog.salon.id}),[]);
  assert.deepEqual((await api.rpc('notifications',{salon_id:catalog.salon.id})).items,[]);
});
