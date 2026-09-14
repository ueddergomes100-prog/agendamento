import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {DateTime} from 'luxon';
import {financialDispatch,financialOnce,syncPayment,runPayout,payoutCycle} from '../src/asaas.mjs';
import {seal,unseal,tokenMatches,asaasClient} from '../src/asaas-client.mjs';
import {changeAppointment} from '../src/booking.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore emulator required');
const app=initializeApp({projectId:'demo-salon'},'asaas-tests'),db=getFirestore(app);db.settings({ignoreUndefinedProperties:true});
after(async()=>{await db.terminate();await deleteApp(app);});
const config={enabled:true,environment:'sandbox',apiKey:'root-test-key',encryptionKey:randomBytes(32).toString('base64'),webhookToken:randomBytes(32).toString('hex'),webhookUrl:'https://example.test/webhook',appUrl:'https://example.test',monthlyCents:7900};
const payer={name:'Cliente de teste',email:'test@example.test',cpfCnpj:'12345678901',mobilePhone:'11999999999'};
const bank={bank:{code:'001'},ownerName:'Titular teste',cpfCnpj:payer.cpfCnpj,agency:'1234',account:'9876',accountDigit:'0',bankAccountType:'CONTA_CORRENTE'};
async function fixture(){
  const salonId=randomUUID(),uid=randomUUID(),clientId=randomUUID(),appointmentId=randomUUID(),salon=db.doc(`salons/${salonId}`),day=DateTime.now().plus({days:7}).toISODate();
  const starts_at=`${day}T12:00:00.000Z`,ends_at=`${day}T13:00:00.000Z`,expires=Date.now()+300000;
  const a={id:appointmentId,salon_id:salonId,client_id:clientId,professional_id:'pro',service_id:'svc',unit_id:'unit',service_name:'Serviço',professional_name:'Profissional',client_name:payer.name,client_phone:payer.mobilePhone,starts_at,ends_at,blocked_until:ends_at,schedule_day:day,hold_expires_at:new Date(expires).toISOString(),status:'HOLD',price_cents:15000,deposit_cents:5000,addons:[],timezone:'America/Sao_Paulo',created_at:new Date().toISOString()};
  await salon.set({slug:'teste-'+salonId});await salon.collection('members').doc(uid).set({role:'OWNER',status:'ACTIVE'});
  await db.doc(`publicSalons/${salonId}`).set({catalog:{salon:{name:'Teste',slug:'teste-'+salonId},policies:{cancel_hours:24,reschedule_hours:12}}});
  await salon.collection('appointmentHolds').doc(appointmentId).set({...a,expiresAt:Timestamp.fromMillis(expires)});
  await salon.collection('scheduleDays').doc(`pro_${day}`).set({entries:[{id:appointmentId,start:Date.parse(starts_at),end:Date.parse(ends_at),expiresAt:expires}]});
  const account={id:randomUUID(),salonId,environment:'sandbox',cpfCnpj:payer.cpfCnpj,ownerName:'Titular teste',status:'APPROVED',encryptedKey:seal('salon-key-'+salonId,config.encryptionKey,`sandbox:${salonId}`),payout:{enabled:true,frequency:'DAILY',reserveCents:10000,minimumCents:1000,bankAccount:bank}};
  await db.doc(`asaasAccounts/sandbox_${salonId}`).set(account);
  const calls=[],payments=new Map();let counter=0;
  const api=async(path,method='GET',body)=>{calls.push({path,method,body});
    if(path==='/myAccount/status/')return{general:'APPROVED'};
    if(path==='/finance/balance')return{balance:500};
    if(path==='/customers')return{id:'cus_test'};
    if(path==='/payments'&&method==='POST'){const result={...body,id:'pay_'+randomUUID(),status:'PENDING',invoiceUrl:'https://sandbox.asaas.com/i/test'};payments.set(result.id,result);return result;}
    if(path==='/transfers'){counter++;return{id:'transfer_'+counter,status:'PENDING'};}
    if(path.endsWith('/refund')){const p=payments.get(path.split('/')[2]);p.status='REFUND_REQUESTED';return{};}
    if(path.startsWith('/payments/'))return payments.get(path.split('/')[2]);
    if(path==='/subscriptions'&&method==='POST')return{id:'sub_test'};
    if(path.startsWith('/subscriptions/')&&path.includes('/payments'))return{data:[]};
    throw Error('Unexpected route '+path);
  };
  const make=(_c,key)=>{if(key)assert.equal(key,'salon-key-'+salonId);return api;};
  const rpc=(user,action,p={})=>financialDispatch(db,user,action,{salon_id:salonId,...p},config,make);
  const checkout=()=>rpc(clientId,'asaas_checkout',{appointment_id:appointmentId,payer,billingType:'PIX',value:0.01});
  return{salonId,uid,clientId,appointmentId,salon,a,account,rpc,checkout,calls,payments,api,make};
}
test('credentials are encrypted per tenant and webhook tokens are compared safely',()=>{
  const encrypted=seal('secret',config.encryptionKey,'salon-A');assert.ok(!encrypted.includes('secret'));assert.equal(unseal(encrypted,config.encryptionKey,'salon-A'),'secret');assert.throws(()=>unseal(encrypted,config.encryptionKey,'salon-B'));assert.equal(tokenMatches(config.webhookToken,config.webhookToken),true);assert.equal(tokenMatches('x',config.webhookToken),false);
});
test('transport uses only approved hosts and does not expose echoed credentials on errors',async()=>{
  let got;const api=asaasClient(config,'private-key',async(url,options)=>{got={url,options};return{ok:false,status:400,json:async()=>({errors:[{description:'private-key'}]})};});
  await assert.rejects(api('/payments','POST',{value:5}),e=>e.definitive&&!e.message.includes('private-key'));assert.equal(got.url,'https://api-sandbox.asaas.com/v3/payments');assert.equal(got.options.redirect,'error');assert.equal(got.options.headers.access_token,'private-key');
});
test('configuration status is sanitized and restricted to financial staff',async()=>{
  const f=await fixture();await assert.rejects(f.rpc(f.clientId,'asaas_status'),e=>e.code==='permission-denied');const status=await f.rpc(f.uid,'asaas_status');assert.ok(!JSON.stringify(status).includes('encryptedKey'));assert.ok(!JSON.stringify(status).includes('salon-key'));assert.equal(status.monthlyCents,5990);
  const result=await financialDispatch(db,f.uid,'asaas_status',{salon_id:f.salonId},{environment:'sandbox',enabled:false});assert.equal(result.configured,false);
  assert.deepEqual(result.plans.map(p=>[p.id,p.monthlyCents,p.whatsapp,p.available]),[['BASIC',5990,false,true],['WHATSAPP',9990,true,false]]);
});
test('duplicate network operations execute only once even under concurrency',async()=>{
  let calls=0;const key=randomUUID();const runs=await Promise.allSettled([financialOnce(db,key,async()=>{calls++;return{id:'one'};}),financialOnce(db,key,async()=>{calls++;return{id:'two'};})]);assert.equal(calls,1);assert.ok(runs.some(r=>r.status==='fulfilled'));assert.ok(['one','two'].includes((await financialOnce(db,key,()=>{throw Error('must not run');})).id));
});
test('ambiguous requests cannot be repeated and potentially charge twice',async()=>{
  const key=randomUUID();await assert.rejects(financialOnce(db,key,async()=>{throw Error('timeout');}));await assert.rejects(financialOnce(db,key,()=>({id:'duplicate'})),e=>e.code==='failed-precondition');
});
test('checkout derives price from hold and cannot be paid or read by another tenant',async()=>{
  const f=await fixture();await assert.rejects(f.rpc(randomUUID(),'asaas_checkout',{appointment_id:f.appointmentId,payer,billingType:'PIX'}),e=>e.code==='permission-denied');const charge=await f.checkout();assert.equal(f.calls.find(c=>c.path==='/payments').body.value,50);assert.equal((await f.checkout()).id,charge.id);assert.equal(f.calls.filter(c=>c.path==='/payments').length,1);
  await assert.rejects(f.rpc(randomUUID(),'asaas_payment_sync',{payment_id:charge.id}),e=>e.code==='permission-denied');await assert.rejects(changeAppointment(db,f.salon,f.clientId,'release_hold',{appointment_id:f.appointmentId}));await assert.rejects(changeAppointment(db,f.salon,f.clientId,'confirm',{appointment_id:f.appointmentId}));
});
test('verified payment confirms once and stale event cannot regress a refund',async()=>{
  const f=await fixture(),charge=await f.checkout();f.payments.get(charge.id).status='CONFIRMED';
  await Promise.all([syncPayment(db,config,f.api,charge.id),syncPayment(db,config,f.api,charge.id)]);
  const a=(await f.salon.collection('appointments').doc(f.appointmentId).get()).data();assert.equal(a.status,'CONFIRMED');assert.equal(a.paidCents,5000);assert.equal((await f.salon.collection('outbox').get()).size,3);
  f.payments.get(charge.id).status='REFUNDED';await syncPayment(db,config,f.api,charge.id);await syncPayment(db,config,f.api,charge.id);assert.equal((await f.salon.collection('appointments').doc(f.appointmentId).get()).data().paymentStatus,'REFUNDED');
});
test('forged amount never confirms a booking',async()=>{const f=await fixture(),charge=await f.checkout();f.payments.get(charge.id).value=1;f.payments.get(charge.id).status='RECEIVED';await assert.rejects(syncPayment(db,config,f.api,charge.id));assert.equal((await f.salon.collection('appointments').doc(f.appointmentId).get()).exists,false);});
test('late payments require refund review and never steal a reserved slot',async()=>{
  const f=await fixture(),charge=await f.checkout();await f.salon.collection('appointmentHolds').doc(f.appointmentId).delete();f.payments.get(charge.id).status='RECEIVED';const result=await syncPayment(db,config,f.api,charge.id);assert.equal(result.outcome,'REFUND_REQUIRED');assert.equal((await f.salon.collection('appointments').doc(f.appointmentId).get()).exists,false);
});
test('only owner can refund and pending refund is not labeled refunded',async()=>{
  const f=await fixture(),charge=await f.checkout();f.payments.get(charge.id).status='RECEIVED';await assert.rejects(f.rpc(f.clientId,'asaas_refund',{payment_id:charge.id}),e=>e.code==='permission-denied');const result=await f.rpc(f.uid,'asaas_refund',{payment_id:charge.id});assert.equal(result.status,'REFUND_REQUESTED');
});
test('subscription price and features come from the selected server plan, ignoring payload and legacy price',async()=>{
  const f=await fixture();const result=await f.rpc(f.uid,'asaas_subscription_create',{payer,billingType:'PIX',planId:'BASIC',monthlyCents:1,whatsapp:true,planName:'Com WhatsApp'});
  const sent=f.calls.find(c=>c.path==='/subscriptions').body;assert.equal(sent.value,59.9);assert.equal(sent.cycle,'MONTHLY');assert.match(sent.description,/Sem WhatsApp/);
  assert.equal(result.monthlyCents,5990);assert.equal(result.planId,'BASIC');assert.equal(result.whatsapp,false);
  const saved=(await db.doc(`asaasSubscriptions/sandbox_${f.salonId}`).get()).data();assert.equal(saved.planId,'BASIC');assert.equal(saved.public.monthlyCents,5990);
  await f.rpc(f.uid,'asaas_subscription_create',{payer,billingType:'PIX',planId:'BASIC'});assert.equal(f.calls.filter(c=>c.path==='/subscriptions').length,1);
});
test('WhatsApp plan cannot be purchased before the integration is ready, even with forged availability',async()=>{
  const f=await fixture();await assert.rejects(f.rpc(f.uid,'asaas_subscription_create',{payer,billingType:'PIX',planId:'WHATSAPP',available:true,monthlyCents:9990}),e=>e.code==='failed-precondition');
  assert.equal(f.calls.length,0);assert.equal((await db.doc(`asaasSubscriptions/sandbox_${f.salonId}`).get()).exists,false);
});
test('invalid plans and non-owner subscription requests never reach the provider',async()=>{
  const f=await fixture();await assert.rejects(f.rpc(f.uid,'asaas_subscription_create',{payer,billingType:'PIX',planId:'FREE'}),e=>e.code==='invalid-argument');
  await assert.rejects(f.rpc(f.clientId,'asaas_subscription_create',{payer,billingType:'PIX',planId:'BASIC'}),e=>e.code==='permission-denied');assert.equal(f.calls.length,0);
});
test('disabled production billing remains blocked after plans are priced',async()=>{
  const f=await fixture();await assert.rejects(financialDispatch(db,f.uid,'asaas_subscription_create',{salon_id:f.salonId,payer,billingType:'PIX',planId:'BASIC'},{...config,enabled:false,environment:'production'},f.make));assert.equal(f.calls.length,0);
});
test('bank destination must match salon owner and payout settings are owner-only',async()=>{
  const f=await fixture(),settings={...f.account.payout,weekday:1,monthday:1};await assert.rejects(f.rpc(f.clientId,'asaas_payout_save',{settings}),e=>e.code==='permission-denied');await assert.rejects(f.rpc(f.uid,'asaas_payout_save',{settings:{...settings,bankAccount:{...bank,cpfCnpj:'99999999999'}}}));await f.rpc(f.uid,'asaas_payout_save',{settings});
});
test('scheduled payout uses available balance minus reserve, once per cycle',async()=>{
  const f=await fixture(),now=DateTime.fromISO('2026-09-14T10:00',{zone:'America/Sao_Paulo'});await Promise.all([runPayout(db,config,f.account,f.make,now),runPayout(db,config,f.account,f.make,now)]);await runPayout(db,config,f.account,f.make,now);const writes=f.calls.filter(c=>c.path==='/transfers');assert.equal(writes.length,1);assert.equal(writes[0].body.value,400);
});
test('uncertain payout blocks later cycles until reconciled',async()=>{
  const f=await fixture(),now=DateTime.fromISO('2026-09-14T10:00',{zone:'America/Sao_Paulo'});let attempts=0;const make=()=>async(path,method,body)=>{if(path==='/transfers'){attempts++;throw Error('network timeout');}return f.api(path,method,body);};await runPayout(db,config,f.account,make,now);await runPayout(db,config,f.account,make,now.plus({days:1}));assert.equal(attempts,1);assert.equal((await db.doc(`asaasPayouts/sandbox_${f.salonId}_2026-09-14`).get()).data().status,'UNCERTAIN');
});
test('weekly and monthly schedules respect date and Brasilia hour',()=>{
  const now=DateTime.fromISO('2026-09-14T08:00',{zone:'America/Sao_Paulo'});assert.equal(payoutCycle({enabled:true,frequency:'DAILY'},now),null);assert.equal(payoutCycle({enabled:true,frequency:'WEEKLY',weekday:1},now.plus({hours:1})),'2026-09-14');assert.equal(payoutCycle({enabled:true,frequency:'MONTHLY',monthday:15},now.plus({hours:2})),null);
});
