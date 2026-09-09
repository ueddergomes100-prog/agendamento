-- Domain shared by Supabase production and the local PostgreSQL development runtime.
create table public.organizations(id uuid primary key default gen_random_uuid(), name text not null);
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, name text not null check(length(name) between 2 and 100), phone text not null default '', birthday date, marketing boolean not null default false, created_at timestamptz not null default now());
create table public.salons(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations, slug text unique not null, name text not null, description text not null default '', active boolean not null default true);
create table public.salon_units(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, name text not null, address text not null, timezone text not null default 'America/Sao_Paulo', unique(salon_id,id));
create table public.salon_branding(salon_id uuid primary key references public.salons, preset text not null default 'Rose', primary_color text, logo_url text, cover_url text, font_style text not null default 'Editorial', dark_allowed boolean not null default true);
create table public.salon_settings(salon_id uuid primary key references public.salons, min_notice_minutes int not null default 60 check(min_notice_minutes>=0), max_future_days int not null default 60 check(max_future_days between 1 and 365), slot_minutes int not null default 30 check(slot_minutes in(15,30,60)));
create table public.salon_policies(salon_id uuid primary key references public.salons, cancel_hours int not null default 24 check(cancel_hours>=0), reschedule_hours int not null default 12 check(reschedule_hours>=0));
create table public.salon_hours(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, unit_id uuid not null, weekday int not null check(weekday between 0 and 6), opens time not null, closes time not null check(closes>opens), foreign key(salon_id,unit_id) references public.salon_units(salon_id,id), unique(unit_id,weekday));
create table public.members(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, user_id uuid not null references auth.users, role text not null check(role in('owner','manager','reception','professional','finance')), unique(salon_id,user_id));
create table public.professionals(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, user_id uuid references auth.users, name text not null, specialty text not null default '', bio text not null default '', photo_url text, active boolean not null default true, unique(salon_id,id));
create table public.professional_schedules(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, professional_id uuid not null, unit_id uuid not null, weekday int not null check(weekday between 0 and 6), opens time not null, closes time not null check(closes>opens), foreign key(salon_id,professional_id) references public.professionals(salon_id,id), foreign key(salon_id,unit_id) references public.salon_units(salon_id,id), unique(professional_id,unit_id,weekday));
create table public.professional_breaks(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, professional_id uuid not null, weekday int not null check(weekday between 0 and 6), starts time not null, ends time not null check(ends>starts), foreign key(salon_id,professional_id) references public.professionals(salon_id,id));
create table public.professional_time_off(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, professional_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at), reason text not null default 'Indisponível', foreign key(salon_id,professional_id) references public.professionals(salon_id,id));
create table public.service_categories(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, name text not null, unique(salon_id,id));
create table public.services(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, category_id uuid not null, name text not null check(length(name) between 2 and 120), description text not null default '', image_url text, duration_minutes int not null check(duration_minutes between 5 and 600), preparation_minutes int not null default 0 check(preparation_minutes between 0 and 120), cleanup_minutes int not null default 10 check(cleanup_minutes between 0 and 120), price_cents int not null check(price_cents>=0), deposit_cents int not null default 0 check(deposit_cents>=0 and deposit_cents<=price_cents), min_notice_minutes int check(min_notice_minutes>=0), active boolean not null default true, unique(salon_id,id), foreign key(salon_id,category_id) references public.service_categories(salon_id,id));
create table public.service_professionals(salon_id uuid not null references public.salons, service_id uuid not null, professional_id uuid not null, primary key(service_id,professional_id), foreign key(salon_id,service_id) references public.services(salon_id,id), foreign key(salon_id,professional_id) references public.professionals(salon_id,id));
create table public.service_addons(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, service_id uuid not null, name text not null, duration_minutes int not null check(duration_minutes between 0 and 120), price_cents int not null check(price_cents>=0), foreign key(salon_id,service_id) references public.services(salon_id,id), unique(salon_id,id));
create table public.resources(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, unit_id uuid not null, name text not null, foreign key(salon_id,unit_id) references public.salon_units(salon_id,id), unique(salon_id,id));
create table public.service_resources(salon_id uuid not null references public.salons, service_id uuid not null, resource_id uuid not null, primary key(service_id,resource_id), foreign key(salon_id,service_id) references public.services(salon_id,id), foreign key(salon_id,resource_id) references public.resources(salon_id,id));
create table public.clients(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, user_id uuid not null references auth.users, created_at timestamptz not null default now(), unique(salon_id,user_id), unique(salon_id,id));
create table public.appointments(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, unit_id uuid not null, client_id uuid not null, professional_id uuid not null, service_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at), occupied_from timestamptz not null, occupied_until timestamptz not null, status text not null check(status in('HOLD','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW','REFUNDED')), hold_expires_at timestamptz, price_cents int not null check(price_cents>=0), deposit_cents int not null default 0, addons jsonb not null default '[]', created_by uuid not null references auth.users, created_at timestamptz not null default now(), unique(salon_id,id), foreign key(salon_id,unit_id) references public.salon_units(salon_id,id), foreign key(salon_id,client_id) references public.clients(salon_id,id), foreign key(salon_id,professional_id) references public.professionals(salon_id,id), foreign key(salon_id,service_id) references public.services(salon_id,id));
create index appointments_availability on public.appointments(professional_id,occupied_from,occupied_until) where status not in('CANCELLED','REFUNDED','NO_SHOW');
create table public.resource_bookings(salon_id uuid not null references public.salons, appointment_id uuid not null, resource_id uuid not null, primary key(appointment_id,resource_id), foreign key(salon_id,appointment_id) references public.appointments(salon_id,id) on delete cascade, foreign key(salon_id,resource_id) references public.resources(salon_id,id));
create table public.appointment_status_history(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, appointment_id uuid not null, status text not null, actor uuid references auth.users, created_at timestamptz not null default now(), foreign key(salon_id,appointment_id) references public.appointments(salon_id,id));
create table public.waitlist(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, user_id uuid not null references auth.users, service_id uuid not null, desired_date date not null, created_at timestamptz not null default now(), foreign key(salon_id,service_id) references public.services(salon_id,id), unique(salon_id,user_id,service_id,desired_date));
create table public.reviews(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, appointment_id uuid unique not null, user_id uuid not null references auth.users, rating int not null check(rating between 1 and 5), comment text not null default '' check(length(comment)<=2000), created_at timestamptz not null default now(), foreign key(salon_id,appointment_id) references public.appointments(salon_id,id));
create table public.favorites(salon_id uuid not null references public.salons, user_id uuid not null references auth.users, professional_id uuid not null, primary key(user_id,professional_id), foreign key(salon_id,professional_id) references public.professionals(salon_id,id));
create table public.notification_preferences(salon_id uuid not null references public.salons, user_id uuid not null references auth.users, push boolean not null default false, whatsapp boolean not null default false, marketing boolean not null default false, primary key(salon_id,user_id));
create table public.notifications(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, user_id uuid not null references auth.users, title text not null, body text not null, appointment_id uuid, read_at timestamptz, created_at timestamptz not null default now(), foreign key(salon_id,appointment_id) references public.appointments(salon_id,id));
create table public.device_tokens(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, user_id uuid not null references auth.users, token text not null unique, created_at timestamptz not null default now());
create table public.outbox(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, event text not null, payload jsonb not null, idempotency_key text unique not null, state text not null default 'pending' check(state in('pending','processing','sent','dead')), attempts int not null default 0, available_at timestamptz not null default now(), locked_until timestamptz, last_error text, created_at timestamptz not null default now());
create table public.payments(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, appointment_id uuid not null, provider text not null, provider_intent_id text unique not null, amount_cents int not null check(amount_cents>0), currency text not null default 'brl', status text not null check(status in('pending','approved','failed','refunded')), created_at timestamptz not null default now(), foreign key(salon_id,appointment_id) references public.appointments(salon_id,id));
create table public.refunds(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, payment_id uuid not null references public.payments, provider_refund_id text unique, amount_cents int not null check(amount_cents>0), status text not null default 'pending');
create table public.webhook_events(provider text not null, event_id text not null, received_at timestamptz not null default now(), primary key(provider,event_id));
create table public.audit_logs(id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.salons, actor uuid references auth.users, action text not null, entity_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now());
create table public.account_requests(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users, kind text not null check(kind in('deletion','export')), state text not null default 'pending', created_at timestamptz not null default now());

create function public.is_staff(s uuid, allowed text[] default array['owner','manager','reception','professional','finance']) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.members where salon_id=s and user_id=auth.uid() and role=any(allowed)) $$;
create function public.owns_appointment(a uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.appointments x join public.clients c on c.id=x.client_id where x.id=a and c.user_id=auth.uid()) $$;

-- Every relation starts closed. Expose intentionally public catalog and narrowly scoped private reads.
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='public' loop
   execute format('alter table public.%I enable row level security',t);
 end loop;
 foreach t in array array['salons','salon_units','salon_branding','salon_settings','salon_policies','service_categories','services','professionals','service_professionals','service_addons'] loop
   execute format('create policy catalog_read on public.%I for select to anon, authenticated using (true)',t);
 end loop;
end $$;
create policy profile_self on public.profiles for select to authenticated using(id=auth.uid());
create policy membership_self on public.members for select to authenticated using(user_id=auth.uid());
create policy client_self on public.clients for select to authenticated using(user_id=auth.uid() or public.is_staff(salon_id,array['owner','manager','reception']));
create policy appointment_access on public.appointments for select to authenticated using(public.owns_appointment(id) or public.is_staff(salon_id,array['owner','manager','reception']) or exists(select 1 from public.professionals p where p.id=professional_id and p.user_id=auth.uid()));
create policy payment_access on public.payments for select to authenticated using(public.owns_appointment(appointment_id) or public.is_staff(salon_id,array['owner','finance']));
create policy notification_self on public.notifications for select to authenticated using(user_id=auth.uid());
create policy preferences_self on public.notification_preferences for select to authenticated using(user_id=auth.uid());
create policy favorites_self on public.favorites for select to authenticated using(user_id=auth.uid());
create policy waitlist_self on public.waitlist for select to authenticated using(user_id=auth.uid() or public.is_staff(salon_id,array['owner','manager','reception']));
create policy review_self on public.reviews for select to authenticated using(user_id=auth.uid() or public.is_staff(salon_id,array['owner','manager']));
create policy audit_staff on public.audit_logs for select to authenticated using(public.is_staff(salon_id,array['owner','manager']));
grant usage on schema public to anon,authenticated;
grant select on all tables in schema public to anon,authenticated;
revoke insert,update,delete on all tables in schema public from anon,authenticated;

create function public.slot_available(s uuid, u uuid, p uuid, svc uuid, at_time timestamptz, extras uuid[] default '{}', ignore_id uuid default null) returns boolean language plpgsql stable security definer set search_path='' as $$
declare sv public.services; cfg public.salon_settings; zone text; local_start timestamp; local_end timestamp; occupied_start timestamptz; occupied_end timestamptz; extra_min int; daynum int;
begin
 select * into sv from public.services where id=svc and salon_id=s and active;
 if not found then return false; end if;
 select timezone into zone from public.salon_units where id=u and salon_id=s;
 if zone is null then return false; end if;
 select * into cfg from public.salon_settings where salon_id=s;
 if at_time<now()+make_interval(mins=>coalesce(sv.min_notice_minutes,cfg.min_notice_minutes)) or at_time>now()+make_interval(days=>cfg.max_future_days) then return false; end if;
 if not exists(select 1 from public.service_professionals sp join public.professionals pr on pr.id=sp.professional_id where sp.salon_id=s and sp.service_id=svc and sp.professional_id=p and pr.active) then return false; end if;
 if cardinality(extras)<>(select count(*) from public.service_addons where id=any(extras) and salon_id=s and service_id=svc) then return false; end if;
 select coalesce(sum(duration_minutes),0) into extra_min from public.service_addons where id=any(extras) and service_id=svc;
 occupied_start:=at_time-make_interval(mins=>sv.preparation_minutes);
 occupied_end:=at_time+make_interval(mins=>sv.duration_minutes+extra_min+sv.cleanup_minutes);
 local_start:=occupied_start at time zone zone; local_end:=occupied_end at time zone zone; daynum:=extract(dow from local_start);
 if local_start::date<>local_end::date then return false; end if;
 if extract(second from at_time)<>0 or (extract(minute from at_time at time zone zone)::int%cfg.slot_minutes)<>0 then return false; end if;
 if not exists(select 1 from public.salon_hours where salon_id=s and unit_id=u and weekday=daynum and opens<=local_start::time and closes>=local_end::time) then return false; end if;
 if not exists(select 1 from public.professional_schedules where salon_id=s and unit_id=u and professional_id=p and weekday=daynum and opens<=local_start::time and closes>=local_end::time) then return false; end if;
 if exists(select 1 from public.professional_breaks where professional_id=p and weekday=daynum and starts<local_end::time and ends>local_start::time) then return false; end if;
 if exists(select 1 from public.professional_time_off where professional_id=p and starts_at<occupied_end and ends_at>occupied_start) then return false; end if;
 -- A professional's bookings across units share the same lock and timeline.
 if exists(select 1 from public.appointments where professional_id=p and id is distinct from ignore_id and status not in('CANCELLED','REFUNDED','NO_SHOW') and (status not in('HOLD','PENDING_PAYMENT') or hold_expires_at>now()) and occupied_from<occupied_end and occupied_until>occupied_start) then return false; end if;
 if exists(select 1 from public.service_resources sr join public.resources r on r.id=sr.resource_id where sr.service_id=svc and r.unit_id<>u) then return false; end if;
 if exists(select 1 from public.service_resources sr join public.resource_bookings rb on rb.resource_id=sr.resource_id join public.appointments a on a.id=rb.appointment_id where sr.service_id=svc and a.id is distinct from ignore_id and a.status not in('CANCELLED','REFUNDED','NO_SHOW') and (a.status not in('HOLD','PENDING_PAYMENT') or a.hold_expires_at>now()) and a.occupied_from<occupied_end and a.occupied_until>occupied_start) then return false; end if;
 return true;
end $$;

create function public.appointment_json(a uuid) returns jsonb language sql stable security definer set search_path='' as $$
select to_jsonb(x)||jsonb_build_object('service_name',s.name,'professional_name',p.name,'client_name',pr.name,'client_phone',pr.phone,'unit_name',u.name,'address',u.address,'timezone',u.timezone,'review', (select to_jsonb(r) from public.reviews r where r.appointment_id=x.id)) from public.appointments x join public.services s on s.id=x.service_id join public.professionals p on p.id=x.professional_id join public.clients c on c.id=x.client_id join public.profiles pr on pr.id=c.user_id join public.salon_units u on u.id=x.unit_id where x.id=a
$$;

create function public.record_event(a uuid, event_name text) returns void language plpgsql security definer set search_path='' as $$
declare ap public.appointments; recipient uuid; event_id uuid:=gen_random_uuid();
begin
 select * into ap from public.appointments where id=a;
 select user_id into recipient from public.clients where id=ap.client_id;
 insert into public.appointment_status_history(salon_id,appointment_id,status,actor) values(ap.salon_id,a,ap.status,auth.uid());
 insert into public.audit_logs(salon_id,actor,action,entity_id) values(ap.salon_id,auth.uid(),event_name,a);
 insert into public.outbox(salon_id,event,payload,idempotency_key) values(ap.salon_id,event_name,jsonb_build_object('appointment_id',a,'user_id',recipient),event_id::text);
 insert into public.notifications(salon_id,user_id,title,body,appointment_id) values(ap.salon_id,recipient,case event_name when 'booking_confirmed' then 'Seu momento está reservado' when 'booking_cancelled' then 'Agendamento cancelado' when 'booking_rescheduled' then 'Seu novo horário está confirmado' when 'booking_completed' then 'Como foi seu momento?' else 'Novidade no seu agendamento' end, 'Acompanhe os detalhes na sua agenda.',a);
end $$;

create function public.api(action text, payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; unit uuid; pid uuid; svc uuid; aid uuid; clid uuid; at_time timestamptz; sv public.services; ap public.appointments; policy public.salon_policies; extra_ids uuid[]; extra_min int; extra_price int; result jsonb; r record; target_user uuid; requested_status text; allowed boolean;
begin
 sid:=nullif(payload->>'salon_id','')::uuid;
 if action='salons' then
  return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('branding',to_jsonb(b))) from public.salons s join public.salon_branding b on b.salon_id=s.id where s.active),'[]');
 end if;
 if action='catalog' then
  if sid is null then select id into sid from public.salons where slug=payload->>'slug' and active; end if;
  if not exists(select 1 from public.salons where id=sid and active) then raise exception 'Salão não encontrado.'; end if;
  return jsonb_build_object('salon',(select to_jsonb(s) from public.salons s where id=sid),'branding',(select to_jsonb(b) from public.salon_branding b where salon_id=sid),'settings',(select to_jsonb(b) from public.salon_settings b where salon_id=sid),'policies',(select to_jsonb(b) from public.salon_policies b where salon_id=sid),'units',coalesce((select jsonb_agg(to_jsonb(b)) from public.salon_units b where salon_id=sid),'[]'),'categories',coalesce((select jsonb_agg(to_jsonb(b)) from public.service_categories b where salon_id=sid),'[]'),'services',coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from public.services b where salon_id=sid and active),'[]'),'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'salon_id',b.salon_id,'name',b.name,'specialty',b.specialty,'bio',b.bio,'photo_url',b.photo_url,'rating',(select round(avg(r.rating),1) from public.reviews r join public.appointments a on a.id=r.appointment_id where a.professional_id=b.id),'review_count',(select count(*) from public.reviews r join public.appointments a on a.id=r.appointment_id where a.professional_id=b.id))) from public.professionals b where salon_id=sid and active),'[]'),'service_professionals',coalesce((select jsonb_agg(to_jsonb(b)) from public.service_professionals b where salon_id=sid),'[]'),'addons',coalesce((select jsonb_agg(to_jsonb(b)) from public.service_addons b where salon_id=sid),'[]'));
 end if;
 if action='slots' then
  svc:=(payload->>'service_id')::uuid; unit:=(payload->>'unit_id')::uuid; pid:=nullif(payload->>'professional_id','')::uuid;
  select coalesce(array_agg(value::uuid),'{}') into extra_ids from jsonb_array_elements_text(coalesce(payload->'addons','[]'));
  return coalesce((select jsonb_agg(jsonb_build_object('starts_at',ts,'professional_id',p.id,'professional_name',p.name) order by ts,p.name) from public.professionals p cross join public.salon_units u cross join public.salon_settings cfg cross join lateral generate_series((payload->>'date')::date::timestamp at time zone u.timezone,((payload->>'date')::date+1)::timestamp at time zone u.timezone-interval '1 minute',make_interval(mins=>cfg.slot_minutes)) ts where p.salon_id=sid and u.id=unit and u.salon_id=sid and cfg.salon_id=sid and (pid is null or p.id=pid) and public.slot_available(sid,unit,p.id,svc,ts,extra_ids,nullif(payload->>'ignore_id','')::uuid)),'[]');
 end if;
 if uid is null then raise exception 'Entre na sua conta para continuar.' using errcode='28000'; end if;
 if action='me' then
  return jsonb_build_object('profile',(select to_jsonb(p) from public.profiles p where id=uid),'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.members m where user_id=uid),'[]'));
 end if;
 if action='save_profile' then
  if coalesce(payload->>'phone','') !~ '^\+?[0-9 ()-]{10,20}$' then raise exception 'Informe um telefone válido com DDD.'; end if;
  insert into public.profiles(id,name,phone,birthday,marketing) values(uid,trim(payload->>'name'),payload->>'phone',nullif(payload->>'birthday','')::date,coalesce((payload->>'marketing')::boolean,false)) on conflict(id) do update set name=excluded.name,phone=excluded.phone,birthday=excluded.birthday,marketing=excluded.marketing;
  return (select to_jsonb(p) from public.profiles p where id=uid);
 end if;
 if action='export' then
  return jsonb_build_object('profile',(select to_jsonb(p) from public.profiles p where id=uid),'appointments',coalesce((select jsonb_agg(public.appointment_json(a.id)) from public.appointments a join public.clients c on c.id=a.client_id where c.user_id=uid),'[]'),'preferences',coalesce((select jsonb_agg(to_jsonb(n)) from public.notification_preferences n where user_id=uid),'[]'),'reviews',coalesce((select jsonb_agg(to_jsonb(n)) from public.reviews n where user_id=uid),'[]'),'favorites',coalesce((select jsonb_agg(to_jsonb(n)) from public.favorites n where user_id=uid),'[]'));
 end if;
 if action='delete_request' then
  insert into public.account_requests(user_id,kind) select uid,'deletion' where not exists(select 1 from public.account_requests where user_id=uid and kind='deletion' and state='pending');
  update public.profiles set marketing=false where id=uid;
  update public.notification_preferences set marketing=false,whatsapp=false,push=false where user_id=uid;
  return jsonb_build_object('message','Solicitação registrada. A exclusão será analisada considerando os registros de atendimento e obrigações de retenção.');
 end if;
 if not exists(select 1 from public.salons where id=sid and active) then raise exception 'Salão não encontrado.'; end if;
 if action='appointments' then
  return coalesce((select jsonb_agg(public.appointment_json(a.id) order by a.starts_at) from public.appointments a join public.clients c on c.id=a.client_id where a.salon_id=sid and c.user_id=uid and a.status not in('HOLD','PENDING_PAYMENT')),'[]');
 end if;
 if action='notifications' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(n) order by created_at desc) from (select * from public.notifications where salon_id=sid and user_id=uid order by created_at desc limit 50)n),'[]'),'preferences',coalesce((select to_jsonb(n) from public.notification_preferences n where salon_id=sid and user_id=uid),'{}'));
 end if;
 if action='read_notifications' then update public.notifications set read_at=now() where salon_id=sid and user_id=uid and read_at is null; return 'true'; end if;
 if action='preferences' then
  insert into public.notification_preferences(salon_id,user_id,push,whatsapp,marketing) values(sid,uid,coalesce((payload->>'push')::boolean,false),coalesce((payload->>'whatsapp')::boolean,false),coalesce((payload->>'marketing')::boolean,false)) on conflict(salon_id,user_id) do update set push=excluded.push,whatsapp=excluded.whatsapp,marketing=excluded.marketing;
  return 'true';
 end if;
 if action='device_token' then
  if payload->>'token' !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then raise exception 'Token inválido.'; end if;
  insert into public.device_tokens(salon_id,user_id,token) values(sid,uid,payload->>'token') on conflict(token) do update set user_id=excluded.user_id,salon_id=excluded.salon_id;
  return 'true';
 end if;
 if action='favorites' then return coalesce((select jsonb_agg(professional_id) from public.favorites where salon_id=sid and user_id=uid),'[]'); end if;
 if action='favorite' then
  pid:=(payload->>'professional_id')::uuid;
  if coalesce((payload->>'enabled')::boolean,true) then insert into public.favorites(salon_id,user_id,professional_id) values(sid,uid,pid) on conflict do nothing;
  else delete from public.favorites where salon_id=sid and user_id=uid and professional_id=pid; end if; return 'true';
 end if;
 if action='waitlist' then
  if (payload->>'date')::date<current_date then raise exception 'Escolha uma data futura.'; end if;
  insert into public.waitlist(salon_id,user_id,service_id,desired_date) values(sid,uid,(payload->>'service_id')::uuid,(payload->>'date')::date) on conflict do nothing; return 'true';
 end if;
 if action='hold' then
  if not exists(select 1 from public.profiles where id=uid and phone<>'') then raise exception 'Complete seu nome e telefone antes de reservar.'; end if;
  svc:=(payload->>'service_id')::uuid; unit:=(payload->>'unit_id')::uuid; pid:=(payload->>'professional_id')::uuid; at_time:=(payload->>'starts_at')::timestamptz;
  perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
  for r in select resource_id from public.service_resources where service_id=svc order by resource_id loop perform pg_advisory_xact_lock(hashtextextended(r.resource_id::text,0)); end loop;
  select coalesce(array_agg(value::uuid),'{}') into extra_ids from jsonb_array_elements_text(coalesce(payload->'addons','[]'));
  if not public.slot_available(sid,unit,pid,svc,at_time,extra_ids) then raise exception 'Este horário não está mais disponível. Escolha outro.' using errcode='23P01'; end if;
  target_user:=uid;
  if payload ? 'client_user_id' and nullif(payload->>'client_user_id','') is not null then
   if not public.is_staff(sid,array['owner','manager','reception']) then raise exception 'Sem permissão.' using errcode='42501'; end if;
   target_user:=(payload->>'client_user_id')::uuid;
   if not exists(select 1 from public.clients where salon_id=sid and user_id=target_user) then raise exception 'Cliente não pertence a este salão.'; end if;
  end if;
  insert into public.clients(salon_id,user_id) values(sid,target_user) on conflict(salon_id,user_id) do nothing;
  select id into clid from public.clients where salon_id=sid and user_id=target_user;
  if (select count(*) from public.appointments where created_by=uid and status='HOLD' and hold_expires_at>now())>=3 then raise exception 'Você já tem reservas em andamento. Aguarde alguns minutos.'; end if;
  select * into sv from public.services where id=svc and salon_id=sid;
  select coalesce(sum(duration_minutes),0),coalesce(sum(price_cents),0) into extra_min,extra_price from public.service_addons where id=any(extra_ids) and salon_id=sid;
  insert into public.appointments(salon_id,unit_id,client_id,professional_id,service_id,starts_at,ends_at,occupied_from,occupied_until,status,hold_expires_at,price_cents,deposit_cents,addons,created_by) values(sid,unit,clid,pid,svc,at_time,at_time+make_interval(mins=>sv.duration_minutes+extra_min),at_time-make_interval(mins=>sv.preparation_minutes),at_time+make_interval(mins=>sv.duration_minutes+extra_min+sv.cleanup_minutes),'HOLD',now()+interval '5 minutes',sv.price_cents+extra_price,sv.deposit_cents,coalesce((select jsonb_agg(to_jsonb(x)) from public.service_addons x where id=any(extra_ids)),'[]'),uid) returning id into aid;
  insert into public.resource_bookings(salon_id,appointment_id,resource_id) select sid,aid,resource_id from public.service_resources where service_id=svc;
  return public.appointment_json(aid);
 end if;
 if action in('confirm','release_hold','cancel','reschedule','checkin','review','admin_status') then
  aid:=(payload->>'appointment_id')::uuid;
  select professional_id into pid from public.appointments where id=aid and salon_id=sid;
  perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
  select * into ap from public.appointments where id=aid and salon_id=sid for update;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  allowed:=public.owns_appointment(aid) or public.is_staff(sid,array['owner','manager','reception']);
  if action='admin_status' then allowed:=allowed or exists(select 1 from public.professionals where id=ap.professional_id and user_id=uid); end if;
  if not allowed then raise exception 'Sem permissão para este agendamento.' using errcode='42501'; end if;
  if action='release_hold' then
   if ap.status='HOLD' then update public.appointments set status='CANCELLED',hold_expires_at=null where id=aid; end if; return 'true';
  end if;
  if action='confirm' then
   if ap.status='CONFIRMED' then return public.appointment_json(aid); end if;
   if ap.status not in('HOLD','PENDING_PAYMENT') or ap.hold_expires_at<=now() then raise exception 'Sua reserva expirou. Escolha o horário novamente.'; end if;
   if ap.deposit_cents>0 and not exists(select 1 from public.payments where appointment_id=aid and status='approved' and amount_cents>=ap.deposit_cents and currency='brl') then raise exception 'Este serviço exige sinal. O pagamento deve ser aprovado antes da confirmação.'; end if;
   -- Revalidate operational rules after the hold; keep its own occupied range excluded.
   select coalesce(array_agg((value->>'id')::uuid),'{}') into extra_ids from jsonb_array_elements(ap.addons);
   if not public.slot_available(sid,ap.unit_id,ap.professional_id,ap.service_id,ap.starts_at,extra_ids,aid) then raise exception 'A disponibilidade mudou. Selecione outro horário.'; end if;
   update public.appointments set status='CONFIRMED',hold_expires_at=null where id=aid;
   perform public.record_event(aid,'booking_confirmed'); return public.appointment_json(aid);
  end if;
  select * into policy from public.salon_policies where salon_id=sid;
  if action='cancel' then
   if ap.status='CANCELLED' then return public.appointment_json(aid); end if;
   if ap.status<>'CONFIRMED' then raise exception 'Este atendimento não pode ser cancelado pelo app.'; end if;
   if ap.starts_at<now()+make_interval(hours=>policy.cancel_hours) and not public.is_staff(sid,array['owner','manager','reception']) then raise exception 'O prazo de cancelamento terminou. Fale com a recepção.'; end if;
   if exists(select 1 from public.payments where appointment_id=aid and status='approved') then raise exception 'Este agendamento possui pagamento. A recepção precisa analisar o reembolso antes do cancelamento.'; end if;
   update public.appointments set status='CANCELLED' where id=aid;
   perform public.record_event(aid,'booking_cancelled'); return public.appointment_json(aid);
  end if;
  if action='reschedule' then
   if ap.status<>'CONFIRMED' then raise exception 'Só é possível reagendar um horário confirmado.'; end if;
   if ap.starts_at<now()+make_interval(hours=>policy.reschedule_hours) and not public.is_staff(sid,array['owner','manager','reception']) then raise exception 'O prazo de reagendamento terminou. Fale com a recepção.'; end if;
   at_time:=(payload->>'starts_at')::timestamptz;
   for r in select resource_id from public.resource_bookings where appointment_id=aid order by resource_id loop perform pg_advisory_xact_lock(hashtextextended(r.resource_id::text,0)); end loop;
   select coalesce(array_agg((value->>'id')::uuid),'{}') into extra_ids from jsonb_array_elements(ap.addons);
   if not public.slot_available(sid,ap.unit_id,ap.professional_id,ap.service_id,at_time,extra_ids,aid) then raise exception 'Este horário não está mais disponível. Seu horário anterior foi mantido.' using errcode='23P01'; end if;
   update public.appointments set starts_at=at_time,ends_at=at_time+(ap.ends_at-ap.starts_at),occupied_from=at_time+(ap.occupied_from-ap.starts_at),occupied_until=at_time+(ap.occupied_until-ap.starts_at) where id=aid;
   perform public.record_event(aid,'booking_rescheduled'); return public.appointment_json(aid);
  end if;
  if action='checkin' then
   if ap.status<>'CONFIRMED' or ap.starts_at<now()-interval '1 hour' or ap.starts_at>now()+interval '30 minutes' then raise exception 'O check-in fica disponível de 30 minutos antes até 1 hora após seu horário.'; end if;
   update public.appointments set status='CHECKED_IN' where id=aid; perform public.record_event(aid,'booking_checkin'); return public.appointment_json(aid);
  end if;
  if action='review' then
   if not public.owns_appointment(aid) or ap.status<>'COMPLETED' then raise exception 'Você poderá avaliar após concluir seu atendimento.'; end if;
   insert into public.reviews(salon_id,appointment_id,user_id,rating,comment) values(sid,aid,uid,(payload->>'rating')::int,coalesce(payload->>'comment','')) on conflict(appointment_id) do update set rating=excluded.rating,comment=excluded.comment;
   return 'true';
  end if;
  if action='admin_status' then
   if not public.is_staff(sid,array['owner','manager','reception']) and not exists(select 1 from public.professionals where id=ap.professional_id and user_id=uid) then raise exception 'Sem permissão.'; end if;
   requested_status:=payload->>'status';
   if not ((ap.status='CONFIRMED' and requested_status in('CHECKED_IN','NO_SHOW')) or (ap.status='CHECKED_IN' and requested_status='IN_PROGRESS') or (ap.status='IN_PROGRESS' and requested_status='COMPLETED')) then raise exception 'Esta mudança de status não é permitida.'; end if;
   update public.appointments set status=requested_status where id=aid;
   perform public.record_event(aid,case when requested_status='COMPLETED' then 'booking_completed' else 'booking_status_changed' end); return public.appointment_json(aid);
  end if;
 end if;
 if action like 'admin_%' then
  if not public.is_staff(sid) then raise exception 'Acesso reservado à equipe do salão.' using errcode='42501'; end if;
  if action='admin_summary' then
   return jsonb_build_object('appointments',coalesce((select jsonb_agg(public.appointment_json(a.id) order by starts_at) from public.appointments a where a.salon_id=sid and a.status not in('HOLD','PENDING_PAYMENT') and (public.is_staff(sid,array['owner','manager','reception','finance']) or exists(select 1 from public.professionals p where p.id=a.professional_id and p.user_id=uid))),'[]'),'clients',case when public.is_staff(sid,array['owner','manager','reception']) then coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'name',p.name,'phone',p.phone,'created_at',c.created_at)) from public.clients c join public.profiles p on p.id=c.user_id where c.salon_id=sid),'[]') else '[]'::jsonb end,'blocks',coalesce((select jsonb_agg(to_jsonb(t)) from public.professional_time_off t where t.salon_id=sid and (public.is_staff(sid,array['owner','manager','reception']) or exists(select 1 from public.professionals p where p.id=t.professional_id and p.user_id=uid))),'[]'),'audit',case when public.is_staff(sid,array['owner','manager']) then coalesce((select jsonb_agg(to_jsonb(t)) from(select * from public.audit_logs where salon_id=sid order by created_at desc limit 30)t),'[]') else '[]'::jsonb end,'role',(select role from public.members where salon_id=sid and user_id=uid));
  end if;
  if action='admin_block' then
   pid:=(payload->>'professional_id')::uuid;
   if not public.is_staff(sid,array['owner','manager','reception']) and not exists(select 1 from public.professionals where salon_id=sid and id=pid and user_id=uid) then raise exception 'Sem permissão.'; end if;
   perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
   if exists(select 1 from public.appointments where professional_id=pid and status not in('CANCELLED','REFUNDED','NO_SHOW') and (status not in('HOLD','PENDING_PAYMENT') or hold_expires_at>now()) and occupied_from<(payload->>'ends_at')::timestamptz and occupied_until>(payload->>'starts_at')::timestamptz) then raise exception 'Há agendamentos neste intervalo. Reagende-os antes de bloquear.'; end if;
   insert into public.professional_time_off(salon_id,professional_id,starts_at,ends_at,reason) values(sid,pid,(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,coalesce(payload->>'reason','Indisponível')) returning id into aid;
   insert into public.audit_logs(salon_id,actor,action,entity_id) values(sid,uid,'schedule_blocked',aid); return 'true';
  end if;
  if not public.is_staff(sid,array['owner','manager']) then raise exception 'Acesso reservado à gestão.' using errcode='42501'; end if;
  if action='admin_branding' then
   if payload->>'preset' not in('Rose','Champagne','Blossom','Noir','Clean','Lavender') then raise exception 'Tema inválido.'; end if;
   if nullif(payload->>'primary_color','') is not null and payload->>'primary_color' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Cor inválida.'; end if;
   update public.salon_branding set preset=payload->>'preset',primary_color=nullif(payload->>'primary_color',''),font_style=coalesce(payload->>'font_style','Editorial'),dark_allowed=coalesce((payload->>'dark_allowed')::boolean,true) where salon_id=sid;
   update public.salons set name=coalesce(nullif(trim(payload->>'name'),''),name) where id=sid;
   insert into public.audit_logs(salon_id,actor,action,entity_id) values(sid,uid,'branding_updated',sid); return 'true';
  end if;
  if action='admin_rules' then
   update public.salon_settings set min_notice_minutes=(payload->>'min_notice_minutes')::int,max_future_days=(payload->>'max_future_days')::int where salon_id=sid;
   update public.salon_policies set cancel_hours=(payload->>'cancel_hours')::int,reschedule_hours=(payload->>'reschedule_hours')::int where salon_id=sid;
   insert into public.audit_logs(salon_id,actor,action,entity_id) values(sid,uid,'rules_updated',sid); return 'true';
  end if;
  if action='admin_service' then
   aid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
   if exists(select 1 from public.services where id=aid and salon_id<>sid) then raise exception 'Serviço inválido.'; end if;
   insert into public.services(id,salon_id,category_id,name,description,duration_minutes,price_cents,deposit_cents,cleanup_minutes) values(aid,sid,(payload->>'category_id')::uuid,trim(payload->>'name'),coalesce(payload->>'description',''),(payload->>'duration_minutes')::int,(payload->>'price_cents')::int,coalesce((payload->>'deposit_cents')::int,0),coalesce((payload->>'cleanup_minutes')::int,10)) on conflict(id) do update set name=excluded.name,description=excluded.description,duration_minutes=excluded.duration_minutes,price_cents=excluded.price_cents,deposit_cents=excluded.deposit_cents,category_id=excluded.category_id,cleanup_minutes=excluded.cleanup_minutes;
   if payload ? 'professional_ids' then
    delete from public.service_professionals where service_id=aid;
    insert into public.service_professionals(salon_id,service_id,professional_id) select sid,aid,value::uuid from jsonb_array_elements_text(payload->'professional_ids');
   end if;
   insert into public.audit_logs(salon_id,actor,action,entity_id) values(sid,uid,'service_saved',aid); return jsonb_build_object('id',aid);
  end if;
  if action='admin_professional' then
   aid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
   if exists(select 1 from public.professionals where id=aid and salon_id<>sid) then raise exception 'Profissional inválida.'; end if;
   insert into public.professionals(id,salon_id,name,specialty,bio) values(aid,sid,payload->>'name',coalesce(payload->>'specialty',''),coalesce(payload->>'bio','')) on conflict(id) do update set name=excluded.name,specialty=excluded.specialty,bio=excluded.bio;
   unit:=(payload->>'unit_id')::uuid;
   if payload ? 'opens' then
    delete from public.professional_schedules where professional_id=aid and unit_id=unit;
    insert into public.professional_schedules(salon_id,professional_id,unit_id,weekday,opens,closes) select sid,aid,unit,value::int,(payload->>'opens')::time,(payload->>'closes')::time from jsonb_array_elements_text(payload->'weekdays');
   end if;
   insert into public.audit_logs(salon_id,actor,action,entity_id) values(sid,uid,'professional_saved',aid); return jsonb_build_object('id',aid);
  end if;
 end if;
 raise exception 'Operação não reconhecida.';
end $$;

-- Private helpers must never be exposed through PostgREST.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.api(text,jsonb) to anon,authenticated;
grant execute on function public.is_staff(uuid,text[]),public.owns_appointment(uuid) to authenticated;
