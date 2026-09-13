import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {DateTime} from 'luxon';
import {dispatch} from '../src/api.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore emulator required.');
const app=initializeApp({projectId:'demo-salon'},'business-tests'),db=getFirestore(app);db.settings({ignoreUndefinedProperties:true});
after(async()=>{await db.terminate();await deleteApp(app);});
const request=()=>crypto.randomUUID();
async function fixture(){const owner='owner-'+request(),customer='client-'+request();await dispatch(db,owner,'save_profile',{name:'Proprietária',phone:'11999990000'});await dispatch(db,customer,'save_profile',{name:'Cliente',phone:'11999990001'});const salon=await dispatch(db,owner,'provision_salon',{name:'Salão de teste',slug:'test-'+request(),address:'Endereço',request_id:request()});const rpc=(uid,action,p={})=>dispatch(db,uid,action,{salon_id:salon.salonId,...p});let catalog=await rpc(owner,'catalog',{slug:salon.slug});const unit=catalog.units[0].id;const schedule={opens:'08:00',closes:'20:00',weekdays:[0,1,2,3,4,5,6],breaks:[]};await rpc(owner,'admin_unit',{id:unit,name:'Principal',address:'Rua teste',timezone:'America/Manaus',schedule});const pro=(await rpc(owner,'admin_professional',{name:'Profissional',unit_id:unit,...schedule})).id;const service=(await rpc(owner,'admin_service',{name:'Cuidado',category_id:catalog.categories[0].id,duration_minutes:30,cleanup_minutes:0,price_cents:5000,deposit_cents:0,professional_ids:[pro]})).id;await rpc(owner,'publish_salon');const day=DateTime.now().setZone('America/Manaus').plus({days:5}).startOf('day'),at=h=>day.set({hour:h}).toUTC().toISO();return {owner,customer,salon,rpc,unit,pro,service,day,at};}
test('configuration persists across catalog reads and only managers can change it',async()=>{
 const{owner,customer,salon,rpc,unit}=await fixture();
 await assert.rejects(rpc(customer,'admin_info',{description:'Intercepted'}),e=>e.code==='permission-denied');
 await rpc(owner,'admin_info',{description:'Descrição real'});await rpc(owner,'admin_branding',{name:'Novo nome',preset:'Lavender',primary_color:'#554466',secondary_color:'#eeeedd',accent_color:'#123456',background_color:'#fffafa',hero_title:'Meu salão',hero_subtitle:'Seu cuidado',font_style:'Modern',dark_allowed:true,logo_url:'https://example.test/logo.png'});
 const result=await rpc(customer,'catalog',{slug:salon.slug});assert.equal(result.salon.description,'Descrição real');assert.equal(result.branding.accent_color,'#123456');assert.equal(result.units.find(u=>u.id===unit).timezone,'America/Manaus');
 assert.equal((await rpc(owner,'my_salons'))[0].name,'Novo nome');
 await assert.rejects(rpc(owner,'admin_unit',{id:unit,name:'Principal',address:'Rua',timezone:'America/Manaus',schedule:{opens:'09:00',closes:'18:00',weekdays:[1],breaks:[{start:'20:00',end:'21:00'}]}}));
});
test('reception creates guest bookings without synthetic authentication accounts',async()=>{
 const{owner,customer,rpc,unit,pro,service,at,salon}=await fixture();
 await assert.rejects(rpc(customer,'admin_client',{name:'Pessoa',phone:'11999990000'}),e=>e.code==='permission-denied');
 const guest=await rpc(owner,'admin_client',{name:'Cliente da recepção',phone:'11999990002',notes:'Preferência interna'});
 const payload={client_user_id:guest.id,service_id:service,unit_id:unit,professional_id:pro,starts_at:at(10),request_id:request()};
 await assert.rejects(rpc(customer,'hold',payload),e=>e.code==='permission-denied');
 const hold=await rpc(owner,'hold',payload);const booking=await rpc(owner,'confirm',{appointment_id:hold.id});assert.equal(booking.client_id,guest.id);assert.equal(booking.source,'RECEPTION');
 assert.equal((await db.doc(`users/${guest.id}`).get()).exists,false);assert.equal((await db.collection(`users/${guest.id}/notifications`).get()).size,0);
 assert.equal((await rpc(owner,'admin_clients')).items[0].notes,'Preferência interna');assert.equal((await rpc(owner,'admin_client_history',{client_id:guest.id})).items[0].id,booking.id);
 const other=await fixture();await assert.rejects(other.rpc(other.owner,'hold',{...payload,service_id:other.service,unit_id:other.unit,professional_id:other.pro,request_id:request()}));
 await rpc(owner,'cancel',{appointment_id:booking.id});assert.equal((await db.doc(`salons/${salon.salonId}/appointments/${booking.id}`).get()).data().status,'CANCELLED');
});
test('blocks use unit timezone and releasing a block restores available slots',async()=>{
 const{owner,customer,rpc,unit,pro,service,day,at}=await fixture();const base={unit_id:unit,professional_id:pro,service_id:service,date:day.toISODate()};
 await rpc(owner,'admin_block',{unit_id:unit,professional_id:pro,local_start:day.toISODate()+'T10:00',local_end:day.toISODate()+'T11:00',reason:'Intervalo',request_id:request()});
 let found=await rpc(customer,'slots',base);assert.ok(!found.some(x=>x.starts_at===at(10)));
 const block=(await rpc(owner,'admin_summary',{date:day.toISODate()})).blocks[0];assert.equal(block.starts_at,at(10));
 await assert.rejects(rpc(customer,'admin_unblock',{id:block.id}),e=>e.code==='permission-denied');await rpc(owner,'admin_unblock',{id:block.id});found=await rpc(customer,'slots',base);assert.ok(found.some(x=>x.starts_at===at(10)));
});
test('reschedule slot exclusions require appointment ownership',async()=>{
 const{owner,customer,rpc,unit,pro,service,day,at}=await fixture();const hold=await rpc(customer,'hold',{unit_id:unit,professional_id:pro,service_id:service,starts_at:at(10),request_id:request()});await rpc(customer,'confirm',{appointment_id:hold.id});
 const base={unit_id:unit,professional_id:pro,service_id:service,date:day.toISODate(),ignore_id:hold.id};
 await assert.rejects(rpc('stranger','slots',base),e=>e.code==='permission-denied');assert.ok((await rpc(customer,'slots',base)).some(s=>s.starts_at===at(10)));assert.ok((await rpc(owner,'slots',base)).some(s=>s.starts_at===at(10)));
});
test('reports include selected dates, catalog removal preserves history, and waiting list is restricted',async()=>{
 const{owner,customer,salon,rpc,unit,pro,service,day,at}=await fixture();const hold=await rpc(customer,'hold',{unit_id:unit,professional_id:pro,service_id:service,starts_at:at(10),request_id:request()});await rpc(customer,'confirm',{appointment_id:hold.id});
 for(const status of ['CHECKED_IN','IN_PROGRESS','COMPLETED'])await rpc(owner,'admin_status',{appointment_id:hold.id,status});
 const report=await rpc(owner,'admin_reports',{from:day.toISODate(),to:day.toISODate()});assert.equal(report.items.length,1);assert.equal(report.items[0].price_cents,5000);assert.equal(report.limited,false);
 await assert.rejects(rpc(customer,'admin_reports',{from:day.toISODate(),to:day.toISODate()}),e=>e.code==='permission-denied');
 await rpc(customer,'waitlist',{service_id:service,date:day.toISODate()});const waiting=await rpc(owner,'admin_waitlist');assert.equal(waiting[0].clientName,'Cliente');await rpc(owner,'admin_waitlist_status',{id:waiting[0].id,status:'CONTACTED'});assert.equal((await rpc(owner,'admin_waitlist'))[0].status,'CONTACTED');
 await rpc(owner,'admin_remove',{kind:'services',id:service});assert.equal((await rpc(owner,'catalog',{slug:salon.slug})).services.length,0);assert.equal((await rpc(customer,'appointments'))[0].service_name,'Cuidado');
 await rpc(owner,'unpublish_salon');assert.equal((await rpc(owner,'catalog',{slug:salon.slug})).published,false);await assert.rejects(rpc(customer,'catalog',{slug:salon.slug}),e=>e.code==='permission-denied');await assert.rejects(rpc(null,'catalog',{slug:salon.slug}));
});
