import {createHash,randomUUID} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {DateTime} from 'luxon';
import {z} from 'zod';
import {id,text,parse,fail,requireUser,authorize,ownAppointment,activeEntries,overlaps} from './validation.mjs';
import {asaasClient,requireAsaas,seal,unseal,cents,checkoutUrl} from './asaas-client.mjs';
import {dayRef} from './booking.mjs';
import {requireSalonSubscription} from './subscription-access.mjs';

const iso=()=>new Date().toISOString();
const digits=z.string().transform(v=>v.replace(/\D/g,''));
const documentId=digits.pipe(z.string().regex(/^(\d{11}|\d{14})$/));
const payerSchema=z.object({name:text(100),email:z.string().email(),cpfCnpj:documentId,mobilePhone:digits.pipe(z.string().min(10).max(13))});
const accountSchema=payerSchema.extend({incomeValue:z.number().positive().max(1e9),address:text(150),addressNumber:text(20),province:text(100),postalCode:digits.pipe(z.string().length(8)),companyType:z.enum(['MEI','LIMITED','INDIVIDUAL','ASSOCIATION']).optional(),birthDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()});
const bankSchema=z.object({bank:z.object({code:z.string().regex(/^\d{3}$/)}),ownerName:text(100),cpfCnpj:documentId,agency:z.string().regex(/^\d{1,10}$/),account:z.string().regex(/^\d{1,20}$/),accountDigit:z.string().regex(/^[\dXx]{1,2}$/),bankAccountType:z.enum(['CONTA_CORRENTE','CONTA_POUPANCA'])});
export const financialActions=['asaas_options','asaas_status','asaas_account_create','asaas_account_sync','asaas_checkout','asaas_payment_sync','asaas_subscription_create','asaas_subscription_cancel','asaas_payout_save','asaas_refund','asaas_subscription_sync'];
const paid=s=>['RECEIVED','CONFIRMED'].includes(s);
const hash=s=>createHash('sha256').update(s).digest('hex');
const accountRef=(db,c,salonId)=>db.doc(`asaasAccounts/${c.environment}_${salonId}`);
const paymentRef=(db,c,paymentId)=>db.doc(`asaasPayments/${c.environment}_${paymentId}`);

// Provider writes are never retried automatically after an ambiguous response.
// A transaction claims each logical operation before crossing the network boundary.
export async function financialOnce(db,key,fn){
  const ref=db.doc(`asaasOperations/${hash(key)}`);
  const prior=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(snap.exists){const d=snap.data();if(d.status==='DONE')return d.result;if(d.status!=='REJECTED')fail('Operação em processamento ou aguardando conciliação. Não repita a cobrança.');}
    tx.set(ref,{key,status:'PROCESSING',createdAt:iso()});return null;
  });
  if(prior!==null)return prior;
  try{const result=await fn();await ref.set({status:'DONE',result,updatedAt:iso()},{merge:true});return result;}
  catch(error){await ref.set({status:error.definitive?'REJECTED':'UNCERTAIN',updatedAt:iso()},{merge:true});throw error;}
}
export async function accountClient(db,c,salonId,makeClient=asaasClient){
  const a=(await accountRef(db,c,salonId).get()).data();
  if(!a?.encryptedKey)fail('Conecte e aprove a conta Asaas do salão.');
  return {account:a,api:makeClient(c,unseal(a.encryptedKey,c.encryptionKey,`${c.environment}:${salonId}`))};
}
const publicPayment=p=>({id:p.id,status:p.status,value:p.value,invoiceUrl:checkoutUrl(p.invoiceUrl),dueDate:p.dueDate});
function webhook(c,salonId,email){
  if(!c.webhookUrl?.startsWith('https://'))fail('Webhook da plataforma não configurado.');
  return {name:'Agendamento',url:`${c.webhookUrl}?salon=${salonId}`,email,enabled:true,interrupted:false,apiVersion:3,authToken:c.webhookToken,sendType:'SEQUENTIALLY',events:['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL','TRANSFER_DONE','TRANSFER_FAILED','TRANSFER_CANCELLED','ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED','ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED']};
}
export async function financialDispatch(db,uid,action,p,c,makeClient=asaasClient){
  requireUser(uid);const salonId=parse(id,p.salon_id),salon=db.doc(`salons/${salonId}`);
  const member=(await salon.collection('members').doc(uid).get()).data();
  const customerAction=['asaas_options','asaas_my_payments','asaas_checkout','asaas_payment_sync'].includes(action);
  if(!customerAction)authorize(member,action==='asaas_status'?['OWNER','MANAGER','FINANCE']:['OWNER']);
  if(action==='asaas_options'){const a=(await accountRef(db,c,salonId).get()).data();return {online:!!(c.enabled&&c.apiKey&&a?.status==='APPROVED'),environment:c.environment};}
  if(action==='asaas_my_payments'){const list=await salon.collection('payments').where('clientId','==',uid).limit(100).get();return list.docs.map(d=>d.data()).filter(d=>d.environment===c.environment).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  if(action==='asaas_status'){
    const [account,billing,ps,ts]=await Promise.all([accountRef(db,c,salonId).get(),db.doc(`asaasSubscriptions/${c.environment}_${salonId}`).get(),salon.collection('payments').orderBy('updatedAt','desc').limit(30).get(),db.collection('asaasPayouts').where('salonId','==',salonId).limit(30).get()]);
    const a=account.data();return {configured:!!(c.enabled&&c.apiKey),environment:c.environment,monthlyCents:c.monthlyCents||null,account:a?{id:a.id,status:a.status,payout:a.payout||null,ownerName:a.ownerName}:null,subscription:billing.data()?.public||null,payments:ps.docs.map(d=>d.data()).filter(d=>d.environment===c.environment),transfers:ts.docs.map(d=>{const t=d.data();return{id:d.id,status:t.status,valueCents:t.valueCents,date:t.date,environment:t.environment};}).filter(t=>t.environment===c.environment)};
  }
  requireAsaas(c);
  if(action==='asaas_account_create'){
    const data=parse(accountSchema,p.account);const ref=accountRef(db,c,salonId);
    if((await ref.get()).exists)fail('O salão já possui uma conta vinculada.');
    if(c.environment==='production'&&c.subaccountsApproved!==true)fail('A operação com subcontas precisa ser habilitada pela plataforma após validação com o Asaas.');
    return financialOnce(db,`${c.environment}:account:${salonId}`,async()=>{
      const result=await makeClient(c)('/accounts','POST',{...data,webhooks:[webhook(c,salonId,data.email)]});
      if(!result.id||!result.apiKey)throw Error('Account response incomplete');
      await ref.set({id:result.id,salonId,environment:c.environment,walletId:result.walletId||null,encryptedKey:seal(result.apiKey,c.encryptionKey,`${c.environment}:${salonId}`),ownerName:data.name,cpfCnpj:data.cpfCnpj,status:'PENDING',createdAt:iso(),payout:{enabled:false}});
      return {id:result.id,status:'PENDING'};
    });
  }
  if(action==='asaas_subscription_create'){
    if(!Number.isInteger(c.monthlyCents)||c.monthlyCents<=0)fail('O valor da mensalidade ainda não foi definido pela plataforma.');
    const payer=parse(payerSchema,p.payer),billingType=parse(z.enum(['PIX','CREDIT_CARD']),p.billingType);
    const ref=db.doc(`asaasSubscriptions/${c.environment}_${salonId}`),root=makeClient(c);
    const previous=(await ref.get()).data();if(previous&&previous.public.status!=='CANCELLED')return previous.public;
    return financialOnce(db,`${c.environment}:subscription:${salonId}:${previous?.subscriptionId||'first'}`,async()=>{
      const customer=await root('/customers','POST',{...payer,notificationDisabled:true,externalReference:`salon:${salonId}`});
      const subscription=await root('/subscriptions','POST',{customer:customer.id,billingType,value:c.monthlyCents/100,nextDueDate:DateTime.now().setZone('America/Sao_Paulo').toISODate(),cycle:'MONTHLY',description:'Mensalidade do sistema de agendamento',externalReference:`subscription:${salonId}`,callback:{successUrl:`${c.appUrl}/?salon=${(await salon.get()).data().slug}&view=admin`,autoRedirect:true}});
      const list=await root(`/subscriptions/${subscription.id}/payments?limit=1`),first=list.data?.[0];
      const result={id:subscription.id,status:'AWAITING_PAYMENT',monthlyCents:c.monthlyCents,billingType,invoiceUrl:checkoutUrl(first?.invoiceUrl),paidThrough:null};
      await ref.set({salonId,environment:c.environment,customerId:customer.id,subscriptionId:subscription.id,public:result,createdAt:iso()});
      return result;
    });
  }
  if(['asaas_subscription_cancel','asaas_subscription_sync'].includes(action)){
    const ref=db.doc(`asaasSubscriptions/${c.environment}_${salonId}`),sub=(await ref.get()).data();if(!sub)fail('Mensalidade ainda não contratada.');
    const root=makeClient(c);
    if(action==='asaas_subscription_cancel'){
      await financialOnce(db,`${c.environment}:cancel-subscription:${sub.subscriptionId}`,async()=>{await root(`/subscriptions/${sub.subscriptionId}`,'DELETE');return{ok:true};});
      await ref.update({'public.status':'CANCELLED'});return{ok:true};
    }
    return syncSubscription(db,c,sub,root);
  }
  const {account,api}=await accountClient(db,c,salonId,makeClient);
  if(action==='asaas_account_sync'){
    const status=await api('/myAccount/status/');
    await accountRef(db,c,salonId).update({status:status.general,checkedAt:iso()});
    const balance=await api('/finance/balance');return{status:status.general,balanceCents:cents(balance.balance)};
  }
  if(action==='asaas_payout_save'){
    if(account.payoutLock)fail('Existe um repasse em processamento ou aguardando conciliação. Confira antes de alterar o destino.');
    const settings=parse(z.object({enabled:z.boolean(),frequency:z.enum(['DAILY','WEEKLY','MONTHLY']),weekday:z.number().int().min(1).max(7).default(1),monthday:z.number().int().min(1).max(28).default(1),reserveCents:z.number().int().min(0).max(100000000),minimumCents:z.number().int().min(100).max(100000000),bankAccount:bankSchema}),p.settings);
    if(settings.bankAccount.cpfCnpj!==account.cpfCnpj)fail('A conta de destino deve pertencer ao mesmo titular da conta Asaas do salão.');
    if(settings.enabled&&account.status!=='APPROVED')fail('Aprove a conta Asaas antes de ativar os repasses.');
    await db.runTransaction(async tx=>{const ref=accountRef(db,c,salonId),current=(await tx.get(ref)).data();if(current.payoutLock)fail('Aguarde a conciliação do repasse em andamento.');tx.update(ref,{payout:{...settings,updatedBy:uid,updatedAt:iso()}});});return{ok:true};
  }
  if(action==='asaas_checkout'){
    await requireSalonSubscription(db,salonId);
    const appointmentId=parse(id,p.appointment_id),payer=parse(payerSchema,p.payer),billingType=parse(z.enum(['PIX','CREDIT_CARD']),p.billingType);
    const appRef=salon.collection('appointmentHolds').doc(appointmentId),app=(await appRef.get()).data();
    if(!app)fail('Reserva não encontrada.');ownAppointment(app,uid,member);
    const existing=(await db.doc(`asaasBookingLinks/${c.environment}_${salonId}_${appointmentId}`).get()).data();
    if(existing)return existing.public;
    if(app.hold_expires_at<=iso())fail('Reserva expirada. Escolha outro horário.');
    const status=await api('/myAccount/status/');if(status.general!=='APPROVED')fail('O salão ainda está ativando os pagamentos.');
    const amount=app.deposit_cents>0?app.deposit_cents:app.price_cents;if(amount<1)fail('Este serviço não exige pagamento online.');
    return financialOnce(db,`${c.environment}:checkout:${salonId}:${appointmentId}`,async()=>{
      // Extend a still-owned hold before creating the charge; never revive an expired slot.
      await db.runTransaction(async tx=>{const [h,d]=await tx.getAll(appRef,dayRef(salon,app.professional_id,app.schedule_day));const a=h.data(),entries=activeEntries(d.data()?.entries||[],Date.now());if(!a||a.hold_expires_at<=iso()||!entries.some(e=>e.id===a.id))fail('Reserva expirada.');const expiry=Math.min(Date.now()+15*60000,Date.parse(a.starts_at));tx.update(appRef,{paymentPending:true,hold_expires_at:new Date(expiry).toISOString(),expiresAt:Timestamp.fromMillis(expiry)});tx.set(d.ref,{entries:entries.map(e=>e.id===a.id?{...e,expiresAt:expiry}:e),updatedAt:Timestamp.now()});});
      const customer=await api('/customers','POST',{...payer,notificationDisabled:true,externalReference:`client:${app.client_id}`});
      const payment=await api('/payments','POST',{customer:customer.id,billingType,value:amount/100,dueDate:DateTime.now().setZone('America/Sao_Paulo').toISODate(),description:`${app.deposit_cents?'Sinal • ':''}${app.service_name}`,externalReference:`booking:${salonId}:${appointmentId}`,callback:{successUrl:`${c.appUrl}/?salon=${(await salon.get()).data().slug}&view=agenda`,autoRedirect:true}});
      const result=publicPayment(payment);
      await paymentRef(db,c,payment.id).set({salonId,appointmentId,clientId:app.client_id,valueCents:amount,environment:c.environment,kind:'BOOKING',createdAt:iso(),status:payment.status});
      await db.doc(`asaasBookingLinks/${c.environment}_${salonId}_${appointmentId}`).set({paymentId:payment.id,public:result,appointment:app});
      await salon.collection('payments').doc(payment.id).set({...result,appointmentId,clientId:app.client_id,valueCents:amount,environment:c.environment,updatedAt:iso()});
      return result;
    });
  }
  if(['asaas_payment_sync','asaas_refund'].includes(action)){
    const paymentId=parse(id,p.payment_id),mapping=(await paymentRef(db,c,paymentId).get()).data();
    if(!mapping||mapping.salonId!==salonId)fail('Pagamento não encontrado.','permission-denied');
    if(action==='asaas_payment_sync'&&mapping.clientId!==uid)authorize(member,['OWNER','MANAGER','FINANCE','RECEPTIONIST']);
    if(action==='asaas_refund'){
      const current=await api(`/payments/${paymentId}`);if(!paid(current.status))fail('Esta cobrança não permite estorno agora.');
      await financialOnce(db,`${c.environment}:refund:${paymentId}`,async()=>{await api(`/payments/${paymentId}/refund`,'POST',{});return{ok:true};});
    }
    return syncPayment(db,c,api,paymentId);
  }
  fail('Operação financeira desconhecida.');
}

export async function syncSubscription(db,c,sub,api){
  const [subscription,list]=await Promise.all([api(`/subscriptions/${sub.subscriptionId}`),api(`/subscriptions/${sub.subscriptionId}/payments?limit=100`)]);
  const receipts=(list.data||[]).filter(p=>paid(p.status));
  const paidThrough=receipts.map(p=>DateTime.fromISO(p.dueDate).plus({months:1}).toISODate()).sort().at(-1)||null;
  const today=DateTime.now().setZone('America/Sao_Paulo').toISODate();
  const status=subscription.deleted||subscription.status==='INACTIVE'?'CANCELLED':paidThrough&&paidThrough>today?'ACTIVE':'AWAITING_PAYMENT';
  const next=(list.data||[]).filter(p=>!paid(p.status)&&!p.deleted).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0];
  const result={...sub.public,status,paidThrough,invoiceUrl:checkoutUrl(next?.invoiceUrl)};
  await db.doc(`asaasSubscriptions/${c.environment}_${sub.salonId}`).update({public:result,updatedAt:iso()});return result;
}

export async function syncPayment(db,c,api,paymentId){
  const ref=paymentRef(db,c,paymentId),mapping=(await ref.get()).data();if(!mapping)return{ignored:true};
  const remote=await api(`/payments/${paymentId}`);
  if(remote.id!==paymentId||remote.externalReference!==`booking:${mapping.salonId}:${mapping.appointmentId}`||cents(remote.value)!==mapping.valueCents)fail('Divergência na confirmação do pagamento.');
  const salon=db.doc(`salons/${mapping.salonId}`),link=(await db.doc(`asaasBookingLinks/${c.environment}_${mapping.salonId}_${mapping.appointmentId}`).get()).data();
  if(!link)fail('Pagamento aguardando associação à reserva.');
  return db.runTransaction(async tx=>{
    const aRef=salon.collection('appointments').doc(mapping.appointmentId),hRef=salon.collection('appointmentHolds').doc(mapping.appointmentId),day=dayRef(salon,link.appointment.professional_id,link.appointment.schedule_day);
    const [aSnap,hSnap,dSnap,pSnap]=await tx.getAll(aRef,hRef,day,ref);let a=aSnap.data()||hSnap.data()||link.appointment;
    const entries=activeEntries(dSnap.data()?.entries||[],Date.now());let outcome=pSnap.data()?.outcome||null;
    if(paid(remote.status)&&!aSnap.exists){
      const busy=entries.some(e=>e.id!==a.id&&overlaps(e,{start:Date.parse(a.starts_at),end:Date.parse(a.blocked_until)}));
      if(!hSnap.exists||a.hold_expires_at<=iso()||busy||Date.parse(a.starts_at)<=Date.now())outcome='REFUND_REQUIRED';
      else{
        a={...a,status:'CONFIRMED',paymentStatus:'PAID',paymentId,paidCents:mapping.valueCents,updated_at:iso()};delete a.expiresAt;
        tx.set(aRef,a);tx.delete(hRef);tx.set(day,{entries:entries.filter(e=>e.id!==a.id).concat({id:a.id,start:Date.parse(a.starts_at),end:Date.parse(a.blocked_until),expiresAt:null}),updatedAt:Timestamp.now()});
        tx.set(salon.collection('clients').doc(a.client_id),{id:a.client_id,user_id:a.client_id,name:a.client_name,phone:a.client_phone,salonId:salon.id,updatedAt:Timestamp.now()},{merge:true});
        if(!a.client_id.startsWith('guest-')){
          tx.set(db.doc(`users/${a.client_id}/salons/${salon.id}`),{salonId:salon.id,lastBooking:a.starts_at,updatedAt:Timestamp.now()},{merge:true});
          tx.set(salon.collection('outbox').doc(`paid_${paymentId}`),{salonId:salon.id,clientId:a.client_id,appointmentId:a.id,action:'booking_confirmed',status:'PENDING',scheduledAt:Timestamp.now(),createdAt:Timestamp.now()});
          for(const hours of [24,2]){const at=Date.parse(a.starts_at)-hours*3600000;if(at>Date.now())tx.set(salon.collection('outbox').doc(`paid_${paymentId}_${hours}`),{salonId:salon.id,clientId:a.client_id,appointmentId:a.id,expectedStart:a.starts_at,action:'booking_reminder',status:'PENDING',scheduledAt:Timestamp.fromMillis(at),createdAt:Timestamp.now()});}
        }outcome='BOOKED';
      }
    }
    if(aSnap.exists&&paid(remote.status)&&a.status==='CANCELLED')outcome='REFUND_REQUIRED';
    if(aSnap.exists&&['REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL'].includes(remote.status))tx.update(aRef,{paymentStatus:remote.status,updated_at:iso()});
    const result={...publicPayment(remote),outcome,appointmentId:mapping.appointmentId,clientId:mapping.clientId,valueCents:mapping.valueCents,environment:c.environment,updatedAt:iso()};
    tx.set(salon.collection('payments').doc(paymentId),result);tx.update(ref,{status:remote.status,outcome,updatedAt:iso()});return {...result,...(outcome==='BOOKED'?{appointment:a}:{})};
  });
}

export function payoutCycle(settings,now=DateTime.now().setZone('America/Sao_Paulo')){
  if(!settings?.enabled||now.hour<9)return null;
  if(settings.frequency==='WEEKLY'&&now.weekday!==settings.weekday)return null;
  if(settings.frequency==='MONTHLY'&&now.day!==settings.monthday)return null;
  return now.toISODate();
}
export async function runPayout(db,c,account,makeClient=asaasClient,now=DateTime.now().setZone('America/Sao_Paulo')){
  const cycle=payoutCycle(account.payout,now);if(!cycle||account.environment!==c.environment)return;
  const ref=db.doc(`asaasPayouts/${c.environment}_${account.salonId}_${cycle}`);
  if((await ref.get()).exists)return;
  const accountDoc=accountRef(db,c,account.salonId);
  const locked=await db.runTransaction(async tx=>{const [snap,existing]=await tx.getAll(accountDoc,ref),current=snap.data();if(existing.exists||!payoutCycle(current?.payout,now)||current.payoutLock)return null;tx.update(accountDoc,{payoutLock:cycle});return current;});
  if(!locked)return;
  account=locked;
  let sent=false;
  try{
    const {api}=await accountClient(db,c,account.salonId,makeClient),status=await api('/myAccount/status/');
    if(status.general!=='APPROVED')fail('Conta Asaas não aprovada.');
    const balance=await api('/finance/balance'),valueCents=cents(balance.balance)-account.payout.reserveCents;
    if(valueCents<account.payout.minimumCents){await accountDoc.update({payoutLock:null});return;}
    await ref.set({salonId:account.salonId,environment:c.environment,date:cycle,status:'PROCESSING',valueCents,createdAt:iso()});
    sent=true;
    const result=await api('/transfers','POST',{value:valueCents/100,bankAccount:account.payout.bankAccount,operationType:'PIX',externalReference:`payout:${account.salonId}:${cycle}`,description:'Repasse programado do salão'});
    if(!result.id)throw Error('Incomplete transfer response');
    await ref.update({providerId:result.id,status:result.status||'PENDING',updatedAt:iso()});
    await accountDoc.update({payoutLock:null});
  }catch(error){
    await ref.set({salonId:account.salonId,environment:c.environment,date:cycle,status:sent&&!error.definitive?'UNCERTAIN':'FAILED',updatedAt:iso()},{merge:true});
    // An unknown transfer keeps the account locked until an operator reconciles it.
    if(!sent||error.definitive)await accountDoc.update({payoutLock:null});
  }
}

export async function processAsaasEvent(db,c,event,scope,makeClient=asaasClient){
  if(scope==='platform'){
    const subId=event.payment?.subscription||event.subscription?.id;if(!subId)return;
    const rows=await db.collection('asaasSubscriptions').where('subscriptionId','==',subId).limit(2).get();
    for(const row of rows.docs)if(row.data().environment===c.environment)await syncSubscription(db,c,row.data(),makeClient(c));return;
  }
  parse(id,scope);const {account,api}=await accountClient(db,c,scope,makeClient);
  if(event.payment?.id){const mapping=(await paymentRef(db,c,event.payment.id).get()).data();if(!mapping)fail('Cobrança ainda não associada.','unavailable');if(mapping.salonId!==scope)fail('Conta divergente.','permission-denied');await syncPayment(db,c,api,event.payment.id);}
  if(event.event?.startsWith('ACCOUNT_STATUS_')){const status=await api('/myAccount/status/');await accountRef(db,c,scope).update({status:status.general,checkedAt:iso()});}
  if(event.transfer?.id){const transfer=await api(`/transfers/${parse(id,event.transfer.id)}`),rows=await db.collection('asaasPayouts').where('providerId','==',transfer.id).limit(2).get();for(const row of rows.docs)if(row.data().salonId===scope&&row.data().environment===c.environment)await row.ref.update({status:transfer.status,updatedAt:iso()});}
}
