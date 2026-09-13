import {randomUUID} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {DateTime} from 'luxon';
import {z} from 'zod';
import {id,text,optionalText,date,parse,fail,authorize,activeEntries} from './validation.mjs';
const rows=s=>s.docs.map(d=>({id:d.id,...d.data()}));
const reception=['OWNER','MANAGER','RECEPTIONIST'];
export const businessActions=['admin_client','admin_clients','admin_client_history','admin_members','admin_reports','admin_waitlist','admin_waitlist_status','admin_unblock'];
export async function business(db,salon,uid,action,p){
 const member=(await salon.collection('members').doc(uid).get()).data();
 if(action==='admin_members'){
  authorize(member,['OWNER']);const members=rows(await salon.collection('members').limit(100).get());
  const profiles=members.length?await db.getAll(...members.map(m=>db.doc(`users/${m.userId}`))):[];
  return members.map((m,i)=>({...m,name:profiles[i].data()?.name||'Conta da equipe'}));
 }
 if(action==='admin_reports'){
  authorize(member,['OWNER','MANAGER','FINANCE']);const v=parse(z.object({from:date,to:date}),p);
  const catalog=(await db.doc(`publicSalons/${salon.id}`).get()).data().catalog;
  const zone=catalog.units[0].timezone,from=DateTime.fromISO(v.from,{zone}),to=DateTime.fromISO(v.to,{zone}).endOf('day');
  if(to<from||to.diff(from,'days').days>93)fail('Selecione um período de até 93 dias.');
  const found=await salon.collection('appointments').where('starts_at','>=',from.toUTC().toISO()).where('starts_at','<=',to.toUTC().toISO()).orderBy('starts_at').limit(1001).get();
  // The UI discloses this bound and asks for a smaller range rather than truncating silently.
  const items=rows(found).slice(0,1000);return {items,limited:found.size>1000,timezone:zone};
 }
 if(action==='admin_unblock')return db.runTransaction(async tx=>{
  const blockId=parse(id,p.id);const [m,b,c]=await tx.getAll(salon.collection('members').doc(uid),salon.collection('blocks').doc(blockId),db.doc(`publicSalons/${salon.id}`));
  authorize(m.data(),[...reception,'PROFESSIONAL']);if(!b.exists)return {ok:true};const value=b.data();
  if(m.data().role==='PROFESSIONAL'&&m.data().professionalId!==value.professional_id)fail('Sem permissão.','permission-denied');
  const day=value.schedule_day||DateTime.fromISO(value.starts_at,{zone:c.data().catalog.units[0].timezone}).toISODate();
  const ref=salon.collection('scheduleDays').doc(`${value.professional_id}_${day}`),entries=(await tx.get(ref)).data()?.entries||[];
  tx.set(ref,{entries:activeEntries(entries,Date.now()).filter(e=>e.id!==blockId),updatedAt:Timestamp.now()});tx.delete(b.ref);
  tx.create(salon.collection('auditLogs').doc(randomUUID()),{salonId:salon.id,actorId:uid,action:'schedule_unblocked',created_at:new Date().toISOString()});return {ok:true};
 });
 authorize(member,reception);
 if(action==='admin_clients'){
  let q=salon.collection('clients').orderBy('name').orderBy('__name__');
  if(p.after){const cursor=parse(z.object({name:text(100),id}),p.after);q=q.startAfter(cursor.name,cursor.id);}
  const found=await q.limit(51).get(),items=rows(found).slice(0,50),last=items.at(-1);
  return {items,next:found.size>50?{name:last.name,id:last.id}:null};
 }
 if(action==='admin_client_history'){
  const clientId=parse(id,p.client_id);let q=salon.collection('appointments').where('client_id','==',clientId).orderBy('starts_at');
  if(p.after)q=q.startAfter(parse(z.string().datetime(),p.after));const found=await q.limit(51).get(),items=rows(found).slice(0,50);
  return {items,next:found.size>50?items.at(-1).starts_at:null};
 }
 if(action==='admin_client'){
  const v=parse(z.object({id:id.optional(),name:text(100),phone:text(30),notes:optionalText(2000)}),p);
  if(v.phone.length<8)fail('Informe um telefone com DDD.');
  return db.runTransaction(async tx=>{const key=v.id||'guest-'+randomUUID();const ref=salon.collection('clients').doc(key);const [m,old]=await tx.getAll(salon.collection('members').doc(uid),ref);authorize(m.data(),reception);if(v.id&&!old.exists)fail('Cliente não encontrada.');
   const value={...old.data(),...v,id:key,user_id:old.data()?.user_id||key,salonId:salon.id,updatedAt:Timestamp.now()};tx.set(ref,value);return {id:key};});
 }
 if(action==='admin_waitlist'){const items=rows(await salon.collection('waitlist').orderBy('createdAt','desc').limit(100).get());const profiles=items.length?await db.getAll(...items.map(i=>db.doc(`users/${i.clientId}`))):[];return items.map((item,i)=>({...item,clientName:profiles[i].data()?.name||'Cliente',phone:profiles[i].data()?.phone||''}));}
 if(action==='admin_waitlist_status'){
  const v=parse(z.object({id,status:z.enum(['WAITING','CONTACTED','CLOSED'])}),p);
  return db.runTransaction(async tx=>{const [m,item]=await tx.getAll(salon.collection('members').doc(uid),salon.collection('waitlist').doc(v.id));authorize(m.data(),reception);if(!item.exists)fail('Solicitação não encontrada.');tx.update(item.ref,{status:v.status,updatedAt:Timestamp.now()});return {ok:true};});
 }
 fail('Ação indisponível.');
}
