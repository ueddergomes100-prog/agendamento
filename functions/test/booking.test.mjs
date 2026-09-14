import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DateTime } from 'luxon';
import { dispatch } from '../src/api.mjs';
import {testPush} from '../src/devices.mjs';

if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Run these tests only with the Firestore emulator.');
const app=initializeApp({projectId:'demo-salon'},'booking-tests'),db=getFirestore(app);
db.settings({ignoreUndefinedProperties:true});
const uid='owner-test',client='client-test',attacker='other-client';
let salon,otherSalon,pro,service,unit,catalog;
const rpc=(who,action,p={})=>dispatch(db,who,action,{salon_id:salon?.salonId,...p});
const request=()=>crypto.randomUUID();
let day=DateTime.now().setZone('America/Sao_Paulo').plus({days:4}).startOf('day');
if(day.weekday===7)day=day.plus({days:1});
const at=(hour,minute=0)=>day.set({hour,minute}).toUTC().toISO();
const holdPayload=(hour,minute=0)=>({service_id:service,professional_id:pro,unit_id:unit,starts_at:at(hour,minute),request_id:request()});
before(async()=>{
  await rpc(uid,'save_profile',{name:uid,phone:'11999990000',account_type:'SALON'});
  for(const user of [client,attacker])await rpc(user,'save_profile',{name:user,phone:'11999990000',account_type:'CLIENT'});
  salon=await rpc(uid,'provision_salon',{name:'Integration Salon',slug:`integration-${Date.now()}`,address:'São Paulo',request_id:request()});
  otherSalon=await rpc(attacker,'provision_salon',{name:'Other Salon',slug:`other-${Date.now()}`,address:'São Paulo',request_id:request()});
  catalog=await rpc(uid,'catalog',{slug:salon.slug});unit=catalog.units[0].id;
  pro=(await rpc(uid,'admin_professional',{name:'Mariana',specialty:'Cabelo',bio:'',unit_id:unit,opens:'09:00',closes:'19:00',weekdays:[1,2,3,4,5,6]})).id;
  service=(await rpc(uid,'admin_service',{name:'Corte',description:'',category_id:catalog.categories[0].id,duration_minutes:45,cleanup_minutes:15,price_cents:10000,deposit_cents:0,professional_ids:[pro]})).id;
  await rpc(uid,'publish_salon');
});
after(async()=>{await db.terminate();await deleteApp(app);});

test('provisioning is idempotent and reserves globally unique slugs',async()=>{
  const p={name:'Idempotent',slug:`idempotent-${Date.now()}`,address:'São Paulo',request_id:request()};
  const first=await rpc(uid,'provision_salon',p),second=await rpc(uid,'provision_salon',p);
  assert.deepEqual(second,first);
  await assert.rejects(rpc(attacker,'provision_salon',{...p,request_id:request()}),e=>e.code==='already-exists');
  await assert.rejects(rpc(client,'catalog',{slug:first.slug}),e=>e.code==='permission-denied');
  await assert.rejects(rpc(client,'provision_salon',{name:'Cliente não pode',slug:`cliente-${Date.now()}`,address:'São Paulo',request_id:request()}),e=>e.code==='permission-denied');
});
test('tenant context is validated on the server, regardless of client payload',async()=>{
  await assert.rejects(rpc(attacker,'admin_rules',{min_notice_minutes:0,max_future_days:365,cancel_hours:0,reschedule_hours:0}),e=>e.code==='permission-denied');
  await assert.rejects(rpc(uid,'admin_service',{name:'Injected',description:'',category_id:catalog.categories[0].id,duration_minutes:30,cleanup_minutes:0,price_cents:0,deposit_cents:0,professional_ids:['foreign-pro']}));
  await assert.rejects(rpc(client,'platform_summary'),e=>e.code==='permission-denied');
});
test('two overlapping reservations have exactly one winner, including cleanup',async()=>{
  const results=await Promise.allSettled([rpc(client,'hold',holdPayload(9)),rpc(attacker,'hold',holdPayload(9,45))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const winner=results.find(r=>r.status==='fulfilled').value;
  const who=winner.client_id;
  await assert.rejects(rpc(who===client?attacker:client,'confirm',{appointment_id:winner.id}),e=>e.code==='permission-denied');
  const confirmed=await rpc(who,'confirm',{appointment_id:winner.id});
  assert.equal(confirmed.status,'CONFIRMED');
  assert.deepEqual(await rpc(who,'confirm',{appointment_id:winner.id}),confirmed);
  await assert.rejects(rpc(who,'confirm',{salon_id:otherSalon.salonId,appointment_id:winner.id}),e=>e.code==='not-found');
});
test('expired holds are unusable even before asynchronous TTL cleanup',async()=>{
  const a=await rpc(client,'hold',holdPayload(11));
  await db.doc(`salons/${salon.salonId}/appointmentHolds/${a.id}`).update({hold_expires_at:new Date(0).toISOString()});
  const ref=db.doc(`salons/${salon.salonId}/scheduleDays/${pro}_${day.toISODate()}`),entries=(await ref.get()).data().entries;
  await ref.update({entries:entries.map(e=>e.id===a.id?{...e,expiresAt:1}:e)});
  await assert.rejects(rpc(client,'confirm',{appointment_id:a.id}),e=>e.code==='failed-precondition');
  const replacement=await rpc(attacker,'hold',holdPayload(11));
  assert.notEqual(replacement.id,a.id);
  await assert.rejects(rpc(client,'confirm',{appointment_id:a.id}));
  await rpc(attacker,'release_hold',{appointment_id:replacement.id});
});
test('failed reschedule preserves the old booking and successful reschedule releases it atomically',async()=>{
  const a=await rpc(client,'hold',holdPayload(14)),b=await rpc(attacker,'hold',holdPayload(16));
  await rpc(client,'confirm',{appointment_id:a.id});await rpc(attacker,'confirm',{appointment_id:b.id});
  await assert.rejects(rpc(client,'reschedule',{appointment_id:a.id,starts_at:b.starts_at}),e=>e.code==='already-exists');
  assert.equal((await db.doc(`salons/${salon.salonId}/appointments/${a.id}`).get()).data().starts_at,a.starts_at);
  const changed=await rpc(client,'reschedule',{appointment_id:a.id,starts_at:at(17)});
  assert.equal(changed.starts_at,new Date(at(17)).toISOString());
  const freed=await rpc(attacker,'hold',holdPayload(14));assert.ok(freed.id);
  await rpc(attacker,'release_hold',{appointment_id:freed.id});
  await rpc(client,'cancel',{appointment_id:a.id});
  assert.equal((await rpc(client,'cancel',{appointment_id:a.id})).status,'CANCELLED');
});
test('business blocks cannot overwrite appointments and customers cannot book for another person',async()=>{
  await assert.rejects(rpc(client,'hold',{...holdPayload(15),client_user_id:attacker}),e=>e.code==='permission-denied');
  await rpc(uid,'admin_block',{professional_id:pro,starts_at:at(15),ends_at:at(16),reason:'Folga',request_id:request()});
  await assert.rejects(rpc(client,'hold',holdPayload(15)),e=>e.code==='already-exists');
  await assert.rejects(rpc(uid,'admin_block',{professional_id:pro,starts_at:at(16),ends_at:at(17),reason:'Conflito',request_id:request()}));
});
test('payment requirements and business hours cannot be bypassed by the client',async()=>{
  await assert.rejects(rpc(client,'hold',holdPayload(12)),e=>e.code==='failed-precondition');
  await assert.rejects(rpc(client,'hold',holdPayload(8)),e=>e.code==='failed-precondition');
  const paid=(await rpc(uid,'admin_service',{name:'Coloração',description:'',category_id:catalog.categories[0].id,duration_minutes:30,cleanup_minutes:0,price_cents:20000,deposit_cents:5000,professional_ids:[pro]})).id;
  const a=await rpc(client,'hold',{...holdPayload(18),service_id:paid,price_cents:0,deposit_cents:0});
  assert.equal(a.deposit_cents,5000);assert.equal(a.price_cents,20000);
  await assert.rejects(rpc(client,'confirm',{appointment_id:a.id}),e=>e.code==='failed-precondition');
  await rpc(client,'release_hold',{appointment_id:a.id});
});
test('revoking a staff membership immediately removes business privileges',async()=>{
  await rpc(uid,'admin_member',{user_id:attacker,role:'PROFESSIONAL',professional_id:pro});
  const summary=await rpc(attacker,'admin_summary',{date:day.toISODate()});
  assert.equal(summary.role,'professional');assert.deepEqual(summary.clients,[]);
  await assert.rejects(rpc(attacker,'admin_branding',{}),e=>e.code==='permission-denied');
  await rpc(uid,'admin_member',{user_id:attacker,role:'PROFESSIONAL',professional_id:pro,status:'INACTIVE'});
  await assert.rejects(rpc(attacker,'admin_summary'),e=>e.code==='permission-denied');
});

test('push registration requires consent and transfers ownership on shared devices',async()=>{
 const p={token:'emulator-only-token',platform:'WEB',consent:true};
 await assert.rejects(rpc(client,'register_device',{...p,consent:false}));
 const {device_id}=await rpc(client,'register_device',p);
 assert.equal((await db.doc(`users/${client}/devices/${device_id}`).get()).data().active,true);
 await rpc(attacker,'register_device',p);
 assert.equal((await db.doc(`users/${client}/devices/${device_id}`).get()).exists,false);
 assert.equal((await db.doc(`pushDevices/${device_id}`).get()).data().userId,attacker);
 await rpc(client,'unregister_device',{device_id});
 assert.equal((await db.doc(`pushDevices/${device_id}`).get()).data().userId,attacker);
 await rpc(attacker,'unregister_device',{device_id});
 assert.equal((await db.doc(`pushDevices/${device_id}`).get()).exists,false);
});

test('push test cannot target another user and invalid tokens are deactivated',async()=>{
 const {device_id}=await rpc(client,'register_device',{token:'emulator-test-target',platform:'WEB',consent:true});
 await assert.rejects(rpc(client,'test_push',{device_id}),e=>e.code==='failed-precondition');
 const sent=[];const sender=async m=>sent.push(m);
 await assert.rejects(testPush(db,attacker,{device_id},salon.slug,sender),e=>e.code==='failed-precondition');
 assert.equal(sent.length,0);
 await testPush(db,client,{device_id,token:'injected-recipient'},salon.slug,sender);
 assert.equal(sent[0].token,'emulator-test-target');assert.match(sent[0].webpush.fcmOptions.link,/view=profile/);
 await assert.rejects(testPush(db,client,{device_id},salon.slug,async()=>{throw Object.assign(new Error('Expired'),{code:'messaging/registration-token-not-registered'});}),e=>e.code==='failed-precondition');
 assert.equal((await db.doc(`users/${client}/devices/${device_id}`).get()).data().active,false);
});
