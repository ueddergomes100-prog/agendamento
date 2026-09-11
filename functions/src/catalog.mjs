import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { id,text,optionalText,money,clock,parse,fail,authorize,presets } from './validation.mjs';

const hours=z.object({opens:clock,closes:clock,weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),breaks:z.array(z.object({start:clock,end:clock})).max(5).default([])}).refine(x=>x.closes>x.opens&&x.breaks.every(b=>b.end>b.start&&b.start>=x.opens&&b.end<=x.closes),'Jornada inválida');
const initialHours={opens:'09:00',closes:'19:00',weekdays:[1,2,3,4,5,6],breaks:[{start:'12:00',end:'13:00'}]};
const categories=['Cabelo','Unhas','Sobrancelha','Cílios','Maquiagem','Estética','Massagem','Noivas','Tratamentos','Outros'].map((name,i)=>({id:`category-${i}`,name}));
const safeImage=z.union([z.literal(''),z.string().url().max(2000).refine(s=>s.startsWith('https://'))]).default('');
export async function provision(db,uid,payload) {
  const p=parse(z.object({name:text(100),slug:z.string().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),address:text(250),timezone:z.enum(['America/Sao_Paulo','America/Manaus','America/Recife','America/Fortaleza','America/Belem','America/Rio_Branco','America/Cuiaba']).default('America/Sao_Paulo'),preset:z.enum(presets).default('Rose'),request_id:id}),payload);
  const salonId=randomUUID(),unitId=randomUUID(),requestRef=db.doc(`users/${uid}/provisionRequests/${p.request_id}`);
  return db.runTransaction(async tx=>{
    const [request,slug,profile,owned]=await tx.getAll(requestRef,db.doc(`salonSlugs/${p.slug}`),db.doc(`users/${uid}`),db.doc(`users/${uid}/limits/salons`));
    if(request.exists) return request.data();
    if(!profile.exists) fail('Complete seu perfil.');
    if(slug.exists) fail('Este endereço já está em uso. Escolha outro.','already-exists');
    if((owned.data()?.count||0)>=10) fail('Limite de salões por conta atingido. Entre em contato com o suporte.','resource-exhausted');
    const now=Timestamp.now();
    const catalog={salon:{id:salonId,slug:p.slug,name:p.name,description:''},branding:{preset:p.preset,primary_color:'',font_style:'Editorial',dark_allowed:true,logo_url:'',cover_url:''},units:[{id:unitId,name:'Unidade principal',address:p.address,timezone:p.timezone,schedule:initialHours}],categories,services:[],professionals:[],service_professionals:[],addons:[],settings:{min_notice_minutes:60,max_future_days:60,slot_minutes:15},policies:{cancel_hours:24,reschedule_hours:12}};
    const features={loyalty:false,giftCards:false,aiAssistant:false,whatsapp:false,packages:false,subscriptions:false,marketplace:false,portfolio:false};
    const salon=db.doc(`salons/${salonId}`);
    tx.create(salon,{salonId,slug:p.slug,name:p.name,ownerId:uid,status:'DRAFT',planId:'START',createdAt:now});
    tx.create(salon.collection('members').doc(uid),{salonId,userId:uid,role:'OWNER',status:'ACTIVE',createdAt:now});
    tx.create(salon.collection('branding').doc('config'),catalog.branding);
    tx.create(salon.collection('settings').doc('config'),catalog.settings);
    tx.create(salon.collection('policies').doc('config'),catalog.policies);
    tx.create(salon.collection('features').doc('config'),features);
    tx.create(salon.collection('units').doc(unitId),{...catalog.units[0],salonId});
    for(const category of categories) tx.create(salon.collection('categories').doc(category.id),{...category,salonId});
    tx.create(db.doc(`salonSlugs/${p.slug}`),{salonId});
    tx.create(db.doc(`publicSalons/${salonId}`),{salonId,name:p.name,slug:p.slug,published:false,catalog,features,updatedAt:now});
    tx.set(db.doc(`users/${uid}/salons/${salonId}`),{salonId,slug:p.slug,name:p.name,role:'OWNER',favorite:false,createdAt:now});
    tx.set(db.doc(`users/${uid}/limits/salons`),{count:(owned.data()?.count||0)+1});
    tx.create(salon.collection('auditLogs').doc(randomUUID()),{salonId,actorId:uid,action:'salon_provisioned',created_at:new Date().toISOString()});
    const result={salonId,slug:p.slug}; tx.create(requestRef,result); return result;
  });
}

export async function editCatalog(db,salon,uid,action,payload) {
  return db.runTransaction(async tx=>{
    const [member,publicSnap]=await tx.getAll(salon.collection('members').doc(uid),db.doc(`publicSalons/${salon.id}`));
    authorize(member.data(),['OWNER','MANAGER']);
    if(!publicSnap.exists) fail('Salão não encontrado.');
    const publicData=publicSnap.data(),c=publicData.catalog;
    let result={ok:true},writes=[];
    if(action==='admin_service') {
      const p=parse(z.object({id:id.optional(),name:text(100),description:optionalText(),category_id:id,duration_minutes:z.number().int().min(5).max(600),cleanup_minutes:z.number().int().min(0).max(120),price_cents:money,deposit_cents:money,professional_ids:z.array(id).max(100),image_url:safeImage.optional()}),payload);
      if(p.deposit_cents>p.price_cents||!c.categories.some(x=>x.id===p.category_id)||p.professional_ids.some(id=>!c.professionals.some(x=>x.id===id))) fail('Categoria, preço ou equipe inválida.');
      if(p.id&&!c.services.some(x=>x.id===p.id)) fail('Serviço não encontrado.');
      if(!p.id&&c.services.length>=150) fail('Limite de 150 serviços atingido.');
      const serviceId=p.id||randomUUID(),previous=c.services.find(x=>x.id===serviceId)||{};
      const {professional_ids,...fields}=p,value={...previous,...fields,id:serviceId,salon_id:salon.id};
      c.services=c.services.filter(x=>x.id!==serviceId).concat(value);
      c.service_professionals=c.service_professionals.filter(x=>x.service_id!==serviceId).concat([...new Set(professional_ids)].map(professional_id=>({service_id:serviceId,professional_id})));
      writes.push([salon.collection('services').doc(serviceId),value]); result={id:serviceId};
    } else if(action==='admin_professional') {
      const p=parse(z.object({id:id.optional(),name:text(100),specialty:optionalText(150),bio:optionalText(),unit_id:id,opens:clock.optional(),closes:clock.optional(),weekdays:z.array(z.number().int().min(0).max(6)).optional(),breaks:z.array(z.object({start:clock,end:clock})).max(5).optional(),photo_url:safeImage.optional()}),payload);
      if(!c.units.some(x=>x.id===p.unit_id)) fail('Unidade inválida.');
      if(p.id&&!c.professionals.some(x=>x.id===p.id)) fail('Profissional não encontrada.');
      if(!p.id&&c.professionals.length>=100) fail('Limite de 100 profissionais atingido.');
      const proId=p.id||randomUUID(),previous=c.professionals.find(x=>x.id===proId)||{review_count:0,schedules:[]};
      const {opens,closes,weekdays,breaks,unit_id,...fields}=p;
      const value={...previous,...fields,id:proId,salonId:salon.id};
      if(opens||closes||weekdays) { const schedule=parse(hours,{opens,closes,weekdays,breaks:breaks||[]}); value.schedules=(value.schedules||[]).filter(x=>x.unit_id!==unit_id).concat({...schedule,unit_id}); }
      c.professionals=c.professionals.filter(x=>x.id!==proId).concat(value);
      writes.push([salon.collection('professionals').doc(proId),value]); result={id:proId};
    } else if(action==='admin_branding') {
      const p=parse(z.object({name:text(100),preset:z.enum(presets),primary_color:z.union([z.literal(''),z.string().regex(/^#[0-9a-fA-F]{6}$/)]),font_style:z.enum(['Editorial','Modern']),dark_allowed:z.boolean(),logo_url:safeImage.optional(),cover_url:safeImage.optional()}),payload);
      const {name,...branding}=p; c.salon.name=name;c.branding={...c.branding,...branding};publicData.name=name;
      writes.push([salon.collection('branding').doc('config'),c.branding]);
    } else if(action==='admin_rules') {
      const p=parse(z.object({min_notice_minutes:z.number().int().min(0).max(10080),max_future_days:z.number().int().min(1).max(365),cancel_hours:z.number().int().min(0).max(720),reschedule_hours:z.number().int().min(0).max(720)}),payload);
      c.settings={...c.settings,min_notice_minutes:p.min_notice_minutes,max_future_days:p.max_future_days};c.policies={cancel_hours:p.cancel_hours,reschedule_hours:p.reschedule_hours};
      writes.push([salon.collection('settings').doc('config'),c.settings],[salon.collection('policies').doc('config'),c.policies]);
    } else if(action==='publish_salon') {
      if(!c.professionals.length||!c.services.length||!c.service_professionals.length) fail('Cadastre a equipe e pelo menos um serviço antes de publicar.');
      publicData.published=true;
    } else fail('Ação inválida.');
    // Keep the bounded public catalog below Firestore's 1 MiB document limit.
    if(Buffer.byteLength(JSON.stringify(c))>700000) fail('Catálogo muito grande. Reduza as descrições.');
    for(const [ref,value] of writes) tx.set(ref,value);
    tx.set(db.doc(`publicSalons/${salon.id}`),{...publicData,catalog:c,updatedAt:Timestamp.now()});
    tx.set(salon,{name:c.salon.name,status:publicData.published?'ACTIVE':'DRAFT',updatedAt:Timestamp.now()},{merge:true});
    tx.create(salon.collection('auditLogs').doc(randomUUID()),{salonId:salon.id,actorId:uid,action,created_at:new Date().toISOString()});
    return result;
  });
}
