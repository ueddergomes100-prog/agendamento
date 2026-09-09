import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { scryptSync } from 'node:crypto';

export const ids = {
  salon: '10000000-0000-4000-8000-000000000001', other: '10000000-0000-4000-8000-000000000002',
  unit: '20000000-0000-4000-8000-000000000001', otherUnit: '20000000-0000-4000-8000-000000000002',
  owner: '30000000-0000-4000-8000-000000000001', client: '30000000-0000-4000-8000-000000000002',
  client2: '30000000-0000-4000-8000-000000000003', otherOwner: '30000000-0000-4000-8000-000000000004',
  proUser: '30000000-0000-4000-8000-000000000005',
  hair: '40000000-0000-4000-8000-000000000001', nails: '40000000-0000-4000-8000-000000000002',
  brows: '40000000-0000-4000-8000-000000000003',
  pro: '50000000-0000-4000-8000-000000000001', pro2: '50000000-0000-4000-8000-000000000002', pro3: '50000000-0000-4000-8000-000000000003',
  service: '60000000-0000-4000-8000-000000000001', service2: '60000000-0000-4000-8000-000000000002', service3: '60000000-0000-4000-8000-000000000003', service4: '60000000-0000-4000-8000-000000000004',
};

export async function createDatabase(path) {
  const db = new PGlite(path);
  await db.waitReady;
  await db.exec(`create schema if not exists local;
    create table if not exists local.migrations(name text primary key);
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key, email text unique not null, password_hash text not null, salt text not null);
    create table if not exists local.sessions(token_hash text primary key,user_id uuid not null references auth.users,expires_at timestamptz not null);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(x=>x.endsWith('.sql')).sort()) {
    if ((await db.query('select 1 from local.migrations where name=$1',[name])).rows.length) continue;
    await db.transaction(async tx=>{ await tx.exec(await readFile(new URL(name,directory),'utf8')); await tx.query('insert into local.migrations values($1)',[name]); });
  }
  return db;
}

export async function invoke(db,userId,action,payload={}) {
  return db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId||'']);
    await tx.exec(`set local role ${userId?'authenticated':'anon'}`);
    return (await tx.query('select public.api($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;
  });
}

export async function seed(db) {
 if ((await db.query('select 1 from public.salons limit 1')).rows.length) return;
 await db.transaction(async tx=>{
  const users=[[ids.owner,'gestao@maisonbella.local','Beatriz'],[ids.client,'ana@maisonbella.local','Ana'],[ids.client2,'clara@maisonbella.local','Clara'],[ids.otherOwner,'gestao@lavender.local','Helena'],[ids.proUser,'mariana@maisonbella.local','Mariana']];
  for(const [id,email,name] of users){
    const salt=`local-development-${id}`;
    await tx.query('insert into auth.users values($1,$2,$3,$4)',[id,email,scryptSync('Bella2026!',salt,64).toString('hex'),salt]);
    await tx.query('insert into public.profiles(id,name,phone) values($1,$2,$3)',[id,name,'11999990000']);
  }
  await tx.exec(`insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000001','Demonstração local');`);
  for(const [id,slug,name,unit,preset] of [[ids.salon,'maison-bella','Maison Bella',ids.unit,'Rose'],[ids.other,'atelier-lavender','Atelier Lavender',ids.otherUnit,'Lavender']]){
   await tx.query('insert into public.salons(id,organization_id,slug,name,description) values($1,$2,$3,$4,$5)',[id,'00000000-0000-4000-8000-000000000001',slug,name,'Um espaço para desacelerar e redescobrir sua beleza.']);
   await tx.query('insert into public.salon_units(id,salon_id,name,address) values($1,$2,$3,$4)',[unit,id,'Jardins','Rua Oscar Freire, 540 · Jardins, São Paulo']);
   await tx.query('insert into public.salon_branding(salon_id,preset,cover_url) values($1,$2,$3)',[id,preset,'https://images.unsplash.com/photo-1781450090585-1a511b7066d9?auto=format&fit=crop&w=1800&q=85']);
   await tx.query('insert into public.salon_settings(salon_id) values($1)',[id]);
   await tx.query('insert into public.salon_policies(salon_id) values($1)',[id]);
   await tx.query("insert into public.salon_hours(salon_id,unit_id,weekday,opens,closes) select $1,$2,d,'09:00','19:00' from generate_series(1,6)d",[id,unit]);
  }
  for(const [s,u,r] of [[ids.salon,ids.owner,'owner'],[ids.salon,ids.proUser,'professional'],[ids.other,ids.otherOwner,'owner']]) await tx.query('insert into public.members(salon_id,user_id,role) values($1,$2,$3)',[s,u,r]);
  for(const [id,name] of [[ids.hair,'Cabelo'],[ids.nails,'Unhas'],[ids.brows,'Sobrancelhas']]) await tx.query('insert into public.service_categories(id,salon_id,name) values($1,$2,$3)',[id,ids.salon,name]);
  for(const [id,name,specialty,bio,user] of [[ids.pro,'Mariana Costa','Hair stylist','Cortes que respeitam sua personalidade e tratamentos para cabelos cheios de vida.',ids.proUser],[ids.pro2,'Júlia Almeida','Nail designer','Um olhar atento aos detalhes. Especialista em unhas naturais, nail art e acabamentos delicados.',null],[ids.pro3,'Camila Santos','Beauty expert','Cuidado e precisão para realçar o que torna sua beleza única.',null]]){
   await tx.query('insert into public.professionals(id,salon_id,name,specialty,bio,user_id) values($1,$2,$3,$4,$5,$6)',[id,ids.salon,name,specialty,bio,user]);
   await tx.query("insert into public.professional_schedules(salon_id,professional_id,unit_id,weekday,opens,closes) select $1,$2,$3,d,'09:00','19:00' from generate_series(1,6)d",[ids.salon,id,ids.unit]);
   await tx.query("insert into public.professional_breaks(salon_id,professional_id,weekday,starts,ends) select $1,$2,d,'12:00','13:00' from generate_series(1,6)d",[ids.salon,id]);
  }
  const hair='https://images.unsplash.com/photo-1638064432604-8da1fc75de09?auto=format&fit=crop&w=900&q=85';
  const nail='https://images.unsplash.com/photo-1610992015762-45dca7fa3a85?auto=format&fit=crop&w=900&q=85';
  for(const [id,cat,name,desc,dur,price,img,pro] of [[ids.service,ids.hair,'Escova & hidratação','Brilho, movimento e um cuidado profundo para renovar seus fios.',75,16000,hair,ids.pro],[ids.service2,ids.nails,'Manicure & pedicure','Seu ritual de cuidado, com acabamento impecável e a sua cor favorita.',90,9500,nail,ids.pro2],[ids.service3,ids.hair,'Corte personalizado','Um novo olhar para você. Consultoria de estilo, corte e finalização.',60,14000,hair,ids.pro],[ids.service4,ids.brows,'Design de sobrancelhas','Harmonia e delicadeza para valorizar a expressão do seu rosto.',30,6500,null,ids.pro3]]){
   await tx.query('insert into public.services(id,salon_id,category_id,name,description,duration_minutes,price_cents,image_url) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,ids.salon,cat,name,desc,dur,price,img]);
   await tx.query('insert into public.service_professionals values($1,$2,$3)',[ids.salon,id,pro]);
  }
  await tx.query('insert into public.service_addons(salon_id,service_id,name,duration_minutes,price_cents) values($1,$2,$3,15,4000)',[ids.salon,ids.service,'Massagem capilar']);
  await tx.query('insert into public.service_addons(salon_id,service_id,name,duration_minutes,price_cents) values($1,$2,$3,20,2000)',[ids.salon,ids.service2,'Nail art delicada']);
  for(const id of [ids.client,ids.client2]) await tx.query('insert into public.clients(salon_id,user_id) values($1,$2)',[ids.salon,id]);
 });
}
