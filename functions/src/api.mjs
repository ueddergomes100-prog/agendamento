import { randomUUID,createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { id,text,optionalText,date,parse,fail,requireUser,authorize } from './validation.mjs';
import { hold,changeAppointment,slots,block } from './booking.mjs';
import { provision,editCatalog } from './catalog.mjs';

const lowerRole={OWNER:'owner',MANAGER:'manager',RECEPTIONIST:'reception',PROFESSIONAL:'professional',FINANCE:'finance'};
const rows=snap=>snap.docs.map(x=>({id:x.id,...x.data()}));
const defaultPrefs={push:false,whatsapp:false,marketing:false};
const defaultCustomer={favorites:[],preferences:defaultPrefs};

export async function dispatch(db,uid,action,p={},claims={}) {
  if(action==='catalog') {
    const slug=parse(z.string().min(3).max(60).regex(/^[a-z0-9-]+$/),p.slug);
    const slugSnap=await db.doc(`salonSlugs/${slug}`).get();
    if(!slugSnap.exists) fail('Salão não encontrado. Confira o link ou cadastre seu salão.','not-found');
    const salonId=slugSnap.data().salonId,snapshot=await db.doc(`publicSalons/${salonId}`).get(),data=snapshot.data();
    if(!data?.published) { const member=uid?(await db.doc(`salons/${salonId}/members/${uid}`).get()).data():null; authorize(member,['OWNER','MANAGER']); }
    return {...data.catalog,published:data.published,features:data.features};
  }
  if(action==='salons') return rows(await db.collection('publicSalons').where('published','==',true).orderBy('name').limit(50).get()).map(x=>({...x.catalog.salon,branding:x.catalog.branding}));
  if(action==='provision_salon') return provision(db,requireUser(uid),p);
  if(action==='save_profile') {
    requireUser(uid);
    const profile=parse(z.object({name:text(100),phone:z.string().trim().min(8).max(30),birthday:z.union([date,z.literal('')]).default(''),marketing:z.boolean().default(false)}),p);
    await db.doc(`users/${uid}`).set({id:uid,...profile,updatedAt:Timestamp.now()},{merge:true}); return {id:uid,...profile};
  }
  if(action==='my_salons') { requireUser(uid); return rows(await db.collection(`users/${uid}/salons`).limit(100).get()); }
  if(action==='delete_request') { requireUser(uid); await db.doc(`privacyRequests/${uid}`).set({userId:uid,status:'PENDING',requestedAt:Timestamp.now(),type:'DELETE_ACCOUNT'},{merge:true}); return {message:'Solicitação de exclusão registrada. O suporte analisará os registros vinculados à conta.'}; }
  if(action==='platform_summary') {
    requireUser(uid);if(claims.superAdmin!==true) fail('Acesso restrito à plataforma.','permission-denied');
    return {salons:rows(await db.collection('salons').orderBy('createdAt','desc').limit(50).get())};
  }
  const salonId=parse(id,p.salon_id),salon=db.doc(`salons/${salonId}`);
  if(action==='slots') return slots(db,salon,p);
  requireUser(uid);
  if(action==='hold') return hold(db,salon,uid,p);
  if(['confirm','release_hold','cancel','reschedule','checkin','review','admin_status'].includes(action)) return changeAppointment(db,salon,uid,action,p);
  if(action==='admin_block') return block(db,salon,uid,p);
  if(['admin_service','admin_professional','admin_branding','admin_rules','publish_salon'].includes(action)) return editCatalog(db,salon,uid,action,p);
  const member=(await salon.collection('members').doc(uid).get()).data();
  if(action==='me') return {profile:(await db.doc(`users/${uid}`).get()).data()||null,memberships:member?.status==='ACTIVE'?[{salon_id:salonId,role:lowerRole[member.role]}]:[]};
  if(action==='appointments') {
    let query=salon.collection('appointments').where('client_id','==',uid).orderBy('starts_at','asc');
    if(p.after) query=query.startAfter(parse(z.string().datetime(),p.after));
    return rows(await query.limit(100).get());
  }
  if(action==='admin_summary') {
    authorize(member,['OWNER','MANAGER','RECEPTIONIST','PROFESSIONAL','FINANCE']);
    const day=parse(date,p.date||new Date().toISOString().slice(0,10));
    // A 3-day UTC range covers the selected local day without depending on the viewer's timezone.
    const from=new Date(Date.parse(day)-86400000).toISOString(),to=new Date(Date.parse(day)+172800000).toISOString();
    let query=salon.collection('appointments').where('starts_at','>=',from).where('starts_at','<',to).orderBy('starts_at');
    if(member.role==='PROFESSIONAL') { if(!member.professionalId) fail('Perfil profissional não vinculado.'); query=query.where('professional_id','==',member.professionalId); }
    const canCRM=['OWNER','MANAGER','RECEPTIONIST'].includes(member.role),manager=['OWNER','MANAGER'].includes(member.role);
    const [apps,clients,blocks,audit,metrics]=await Promise.all([query.limit(200).get(),canCRM?salon.collection('clients').orderBy('name').limit(100).get():null,member.role==='PROFESSIONAL'?salon.collection('blocks').where('professional_id','==',member.professionalId).limit(100).get():salon.collection('blocks').orderBy('starts_at','desc').limit(100).get(),manager?salon.collection('auditLogs').orderBy('created_at','desc').limit(30).get():null,salon.collection('metrics').doc(`daily_${day}`).get()]);
    return {appointments:rows(apps).filter(a=>a.status!=='HOLD'),clients:clients?rows(clients):[],blocks:rows(blocks),audit:audit?rows(audit):[],metrics:metrics.data()||{completed:0,revenueCents:0},role:lowerRole[member.role],limited:true};
  }
  if(action==='admin_member') {
    const data=parse(z.object({user_id:id,role:z.enum(['MANAGER','RECEPTIONIST','PROFESSIONAL','FINANCE']),professional_id:id.optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')}),p);
    return db.runTransaction(async tx=>{
      const [owner,target,pro,existing]=await tx.getAll(salon.collection('members').doc(uid),db.doc(`users/${data.user_id}`),salon.collection('professionals').doc(data.professional_id||'_none'),salon.collection('members').doc(data.user_id));
      authorize(owner.data(),['OWNER']);
      if(!target.exists||data.user_id===uid||existing.data()?.role==='OWNER') fail('Usuário inválido para esta alteração.');
      if(data.role==='PROFESSIONAL'&&!pro.exists) fail('Vincule uma profissional deste salão.');
      tx.set(salon.collection('members').doc(data.user_id),{salonId,userId:data.user_id,role:data.role,status:data.status,professionalId:data.professional_id||null,updatedAt:Timestamp.now()});
      tx.set(db.doc(`users/${data.user_id}/salons/${salonId}`),{salonId,role:data.role,updatedAt:Timestamp.now()},{merge:true});
      tx.create(salon.collection('auditLogs').doc(randomUUID()),{salonId,actorId:uid,action:'member_changed',targetId:data.user_id,created_at:new Date().toISOString()});return {ok:true};
    });
  }
  const customerRef=db.doc(`users/${uid}/salons/${salonId}`);
  if(['favorites','favorite','preferences','notifications','read_notifications','waitlist','export','register_device'].includes(action)) {
    const publicSalon=(await db.doc(`publicSalons/${salonId}`).get()).data();
    if(!publicSalon?.published&&member?.status!=='ACTIVE') fail('Salão indisponível.');
    const customer=(await customerRef.get()).data()||defaultCustomer;
    if(action==='favorites') return customer.favorites||[];
    if(action==='favorite') {
      const f=parse(z.object({professional_id:id,enabled:z.boolean()}),p);
      if(!publicSalon.catalog.professionals.some(x=>x.id===f.professional_id)) fail('Profissional inválida.');
      await db.runTransaction(async tx=>{const snap=await tx.get(customerRef),favorites=snap.data()?.favorites||[];tx.set(customerRef,{salonId,name:publicSalon.name,slug:publicSalon.slug,favorites:f.enabled?[...new Set([...favorites,f.professional_id])]:favorites.filter(x=>x!==f.professional_id)},{merge:true});}); return {ok:true};
    }
    if(action==='preferences') { const preferences=parse(z.object({push:z.boolean(),whatsapp:z.boolean(),marketing:z.boolean()}),p); await customerRef.set({salonId,preferences,consentUpdatedAt:Timestamp.now()},{merge:true});return {ok:true}; }
    if(action==='notifications') return {items:rows(await db.collection(`users/${uid}/notifications`).where('salon_id','==',salonId).orderBy('created_at','desc').limit(50).get()),preferences:customer.preferences||defaultPrefs};
    if(action==='read_notifications') { const notices=await db.collection(`users/${uid}/notifications`).where('salon_id','==',salonId).orderBy('created_at','desc').limit(50).get();const batch=db.batch();for(const n of notices.docs)batch.update(n.ref,{read_at:new Date().toISOString()});await batch.commit();return {ok:true}; }
    if(action==='waitlist') { const w=parse(z.object({service_id:id,date}),p);if(!publicSalon.catalog.services.some(x=>x.id===w.service_id))fail('Serviço inválido.');const key=createHash('sha256').update(`${uid}:${w.service_id}:${w.date}`).digest('hex');await salon.collection('waitlist').doc(key).set({salonId,clientId:uid,...w,status:'WAITING',createdAt:Timestamp.now()});return {ok:true}; }
    if(action==='export') return {profile:(await db.doc(`users/${uid}`).get()).data(),appointments:rows(await salon.collection('appointments').where('client_id','==',uid).orderBy('starts_at').limit(100).get()),preferences:customer.preferences||defaultPrefs,favorites:customer.favorites||[],scope:'Este salão; até 100 agendamentos. Solicite exportação integral ao suporte.'};
    if(action==='register_device') { const d=parse(z.object({token:text(4096),platform:z.enum(['WEB','ANDROID','IOS'])}),p);const deviceId=createHash('sha256').update(d.token).digest('hex');await db.doc(`users/${uid}/devices/${deviceId}`).set({...d,active:true,lastUsedAt:Timestamp.now()},{merge:true});return {ok:true}; }
  }
  if(['campaigns','coupons','save_campaign','save_coupon'].includes(action)) {
    authorize(member,['OWNER','MANAGER']);
    if(action==='campaigns'||action==='coupons') return rows(await salon.collection(action).limit(50).get());
    if(action==='save_campaign') { const c=parse(z.object({id:id.optional(),name:text(80),message:text(1000),audience:text(100),status:z.literal('Rascunho')}),p);const key=c.id||randomUUID();await salon.collection('campaigns').doc(key).set({...c,id:key,salonId,updatedAt:Timestamp.now()});return {id:key}; }
    fail('Cupons dependem da integração de pagamento.');
  }
  fail('Este recurso ainda não está disponível.','unimplemented');
}

export async function rateLimit(db,uid,action) {
  if(!uid)return; // Public callables are still protected by App Check and instance limits.
  const minute=Math.floor(Date.now()/60000),key=createHash('sha256').update(`${uid}:${action}:${minute}`).digest('hex');
  await db.runTransaction(async tx=>{const ref=db.doc(`rateLimits/${key}`),snap=await tx.get(ref),count=snap.data()?.count||0,limit=['hold','provision_salon','admin_block'].includes(action)?10:120;if(count>=limit)fail('Muitas tentativas. Aguarde um minuto.','resource-exhausted');tx.set(ref,{count:count+1,expiresAt:Timestamp.fromMillis((minute+2)*60000)});});
}
