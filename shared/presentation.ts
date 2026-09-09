import {SalonApi} from './client';
import base from './demo-catalog.json';
import type {Catalog,Appointment,Profile,Session,Notice,Preferences,Professional,Service} from './types';
import {dateKey} from './theme';
const KEY='maison.presentation.v2';
const CLIENT='demo-ana',OWNER='demo-owner',PRO='demo-pro';
type CustomerState={favorites:string[];preferences:Preferences;notifications:Notice[]};
type State={customers?:Record<string,CustomerState>;catalogs:Catalog[];appointments:Appointment[];profiles:Record<string,Profile>;favorites:string[];preferences:Preferences;notifications:Notice[];waitlist:string[];blocks:{salon_id?:string;id:string;professional_id:string;starts_at:string;ends_at:string;reason:string}[];audit:{id:string;action:string;created_at:string}[];session:Session|null;campaigns:{id:string;name:string;message:string;audience:string;status:string}[];coupons:{id:string;code:string;discount:number}[]};
const uid=()=>crypto.randomUUID();
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
function initial():State{
 const c=copy(base) as unknown as Catalog;
 c.branding.cover_url='/images/salon.jpg';
 c.services.sort((a,b)=>a.id.localeCompare(b.id));
 c.services.forEach(s=>s.image_url=s.name.includes('Manicure')?'/images/nails.jpg':s.name.includes('sobrancelhas')?'/images/beauty.jpg':'/images/hair.jpg');
 c.professionals.forEach((p,i)=>{p.rating=[4.9,4.9,4.8][i];p.review_count=[128,96,74][i];p.photo_url=['/images/mariana.jpg','/images/julia.jpg','/images/camila.jpg'][i];});
 const makeup={id:'category-makeup',name:'Maquiagem'},care={id:'category-care',name:'Bem-estar'};c.categories.push(makeup,care);
 c.services.push({id:'demo-makeup',salon_id:c.salon.id,category_id:makeup.id,name:'Maquiagem natural glow',description:'Pele iluminada e beleza leve para os seus momentos especiais.',duration_minutes:60,cleanup_minutes:15,price_cents:19000,deposit_cents:0,image_url:'/images/beauty.jpg'},{id:'demo-massage',salon_id:c.salon.id,category_id:care.id,name:'Ritual relaxante',description:'Uma pausa de verdade. Massagem para renovar o corpo e desacelerar a mente.',duration_minutes:60,cleanup_minutes:15,price_cents:18000,deposit_cents:0,image_url:'/images/salon.jpg'});
 c.service_professionals.push({service_id:'demo-makeup',professional_id:c.professionals[2].id},{service_id:'demo-massage',professional_id:c.professionals[2].id});
 const second=copy(c);second.salon={...second.salon,id:'demo-lavender',slug:'atelier-lavender',name:'Atelier Lavender',description:'Sua beleza em um universo de leveza.'};second.branding={...second.branding,preset:'Lavender'};second.services.forEach(s=>s.salon_id=second.salon.id);
 const make=(id:string,serviceIndex:number,offset:number,hour:number,status:string,name='Ana',client=CLIENT):Appointment=>{const s=c.services[serviceIndex],p=c.professionals.find(p=>c.service_professionals.some(x=>x.service_id===s.id&&x.professional_id===p.id))!;const start=new Date(`${dateKey(offset)}T${String(hour).padStart(2,'0')}:30:00-03:00`);return {id,salon_id:c.salon.id,unit_id:c.units[0].id,client_id:client,professional_id:p.id,service_id:s.id,service_name:s.name,professional_name:p.name,client_name:name,client_phone:'(11) 99999-0000',starts_at:start.toISOString(),ends_at:new Date(+start+s.duration_minutes*60000).toISOString(),status,price_cents:s.price_cents,deposit_cents:0,addons:[],address:c.units[0].address,timezone:c.units[0].timezone};};
 return {catalogs:[c,second],appointments:[make('demo-next',0,3,14,'CONFIRMED'),make('demo-history-1',1,-21,10,'COMPLETED'),make('demo-history-2',2,-45,15,'COMPLETED'),make('demo-day-1',0,0,9,'COMPLETED','Clara','demo-clara'),make('demo-day-2',1,0,10,'IN_PROGRESS','Luiza','demo-luiza'),make('demo-day-3',2,0,13,'CHECKED_IN','Beatriz','demo-beatriz'),make('demo-day-4',0,0,15,'CONFIRMED','Marina','demo-marina'),make('demo-day-5',3,0,16,'CONFIRMED','Isabela','demo-isabela')],profiles:{[CLIENT]:{id:CLIENT,name:'Ana Oliveira',phone:'(11) 99999-0000',birthday:'1994-05-18',marketing:true},[OWNER]:{id:OWNER,name:'Beatriz',phone:'(11) 98888-0000',marketing:false},[PRO]:{id:PRO,name:'Mariana Costa',phone:'(11) 97777-0000',marketing:false}},favorites:[c.professionals[0].id],preferences:{push:true,whatsapp:true,marketing:false},notifications:[{id:'notice-1',title:'Seu momento está reservado',body:'Seu próximo cuidado com Mariana já está na agenda. Vai ser um prazer te receber.',appointment_id:'demo-next',created_at:new Date().toISOString()},{id:'notice-2',title:'Um carinho do Clube Bella',body:'Você está cada vez mais perto do seu próximo benefício. Veja seus pontos no perfil.',created_at:new Date(Date.now()-86400000).toISOString()}],waitlist:[],blocks:[],audit:[],session:{access_token:'presentation-only',user:{id:CLIENT,email:'ana@exemplo.com'}},campaigns:[{id:'camp-1',name:'Um novo mês, um novo cuidado',message:'Oi, {nome}! Que tal reservar um momento só seu? Estamos te esperando com carinho.',audience:'Clientes recorrentes',status:'Rascunho'},{id:'camp-2',name:'Feliz aniversário, linda!',message:'Hoje o carinho é todo seu. Aproveite 15% no seu próximo ritual durante o mês do seu aniversário.',audience:'Aniversariantes',status:'Programada'}],coupons:[{id:'coupon-1',code:'BEMVINDA15',discount:15}]};
}
export class PresentationApi extends SalonApi{
 presentation=true;
 state:State;
 constructor(){super({});this.state=initial();}
 get local(){return true;}
 private bookingQueue:Promise<unknown>=Promise.resolve();
 async init(){try{const raw=localStorage.getItem(KEY);if(raw)this.state=JSON.parse(raw);}catch{this.state=initial();}this.session=this.state.session;return this.session;}
 save(){this.state.session=this.session;try{localStorage.setItem(KEY,JSON.stringify(this.state));}catch{/* Private browsing: the current presentation still works in memory. */}}
 reset(){this.state=initial();this.session=this.state.session;this.save();}
 async login(email:string,_password:string){const id=/gestao|owner/i.test(email)?OWNER:/mariana/i.test(email)?PRO:CLIENT;this.session={access_token:'presentation-only',user:{id,email}};this.save();return this.session;}
 async register(email:string,_password:string,name:string,phone:string){const id=uid();this.state.profiles[id]={id,name,phone,marketing:false};this.session={access_token:'presentation-only',user:{id,email}};this.save();return this.session;}
 async logout(){this.session=null;this.save();}
 async rpc<T=unknown>(action:string,p:Record<string,unknown>={}):Promise<T>{
  if(['hold','confirm','reschedule'].includes(action)){
   const result=this.bookingQueue.then(()=>this.execute<T>(action,p));
   this.bookingQueue=result.catch(()=>{});return result;
  }
  return this.execute<T>(action,p);
 }
 private async execute<T=unknown>(action:string,p:Record<string,unknown>={}):Promise<T>{
  await new Promise(r=>setTimeout(r,130));
  const s=this.state;const user=this.session?.user.id;const c=s.catalogs.find(c=>p.salon_id?c.salon.id===p.salon_id:c.salon.slug===p.slug)||s.catalogs[0];const member=user===OWNER?'owner':user===PRO?'professional':null;
  const requireUser=()=>{if(!user)throw new Error('Entre na sua conta para continuar.');};
  const appointment=()=>{const a=s.appointments.find(a=>a.id===p.appointment_id&&a.salon_id===c.salon.id);if(!a||(!member&&a.client_id!==user))throw new Error('Agendamento não encontrado.');return a;};
  const catalog=()=>copy(c);
  const customerFor=(client:string,salonId=c.salon.id)=>{
   s.customers??={};const key=salonId+':'+client;
   if(!s.customers[key]){const original=client===CLIENT&&salonId===s.catalogs[0].salon.id;s.customers[key]={favorites:original?copy(s.favorites):[],preferences:original?copy(s.preferences):{push:false,whatsapp:false,marketing:false},notifications:original?copy(s.notifications):[]};}
   return s.customers[key];
  };
  const event=(a:Appointment,actionName:string)=>{s.audit.unshift({id:uid(),action:actionName,created_at:new Date().toISOString()});customerFor(a.client_id,a.salon_id).notifications.unshift({id:uid(),title:actionName==='booking_cancelled'?'Horário cancelado':actionName==='booking_rescheduled'?'Seu novo horário está confirmado':'Seu momento está reservado',body:`${a.service_name} com ${a.professional_name}.`,appointment_id:a.id,created_at:new Date().toISOString()});};
  let result:unknown=true;
  if(action==='salons')return s.catalogs.map(c=>({...c.salon,branding:c.branding})) as T;
  if(action==='catalog')return catalog() as T;
  if(action==='slots'){
   const date=String(p.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return [] as T;
   const day=new Date(date+'T12:00:00-03:00').getDay();const service=c.services.find(x=>x.id===p.service_id);if(!service||day===0)return [] as T;
   const requested=p.addons as string[]||[];const extras=c.addons.filter(a=>a.service_id===service.id&&requested.includes(a.id));if(extras.length!==requested.length)throw new Error('Escolha apenas os extras disponíveis para este cuidado.');const duration=service.duration_minutes+service.cleanup_minutes+extras.reduce((n,x)=>n+x.duration_minutes,0);
   const pros=c.professionals.filter(x=>(!p.professional_id||x.id===p.professional_id)&&c.service_professionals.some(m=>m.professional_id===x.id&&m.service_id===service.id));
   const slots=[];for(let min=9*60;min+duration<=19*60;min+=Math.max(5,c.settings.slot_minutes||30)){if(min<13*60&&min+duration>12*60)continue;const start=new Date(`${date}T${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}:00-03:00`);if(+start<Date.now()+c.settings.min_notice_minutes*60000||date>dateKey(c.settings.max_future_days))continue;for(const pro of pros){const end=+start+duration*60000;const conflicts=s.appointments.some(a=>a.salon_id===c.salon.id&&a.id!==p.ignore_id&&a.professional_id===pro.id&&!['CANCELLED','NO_SHOW','REFUNDED'].includes(a.status)&&!(a.status==='HOLD'&&new Date(a.hold_expires_at||0).getTime()<Date.now())&&new Date(a.starts_at).getTime()<end&&new Date(a.ends_at).getTime()+(c.services.find(x=>x.id===a.service_id)?.cleanup_minutes||0)*60000>+start)||s.blocks.some(b=>(b.salon_id||s.catalogs[0].salon.id)===c.salon.id&&b.professional_id===pro.id&&new Date(b.starts_at).getTime()<end&&new Date(b.ends_at).getTime()>+start);if(!conflicts)slots.push({starts_at:start.toISOString(),professional_id:pro.id,professional_name:pro.name});}}return slots as T;
  }
  requireUser();const customer=customerFor(user!);
  switch(action){
   case 'me':result={profile:s.profiles[user!],memberships:member?[{salon_id:c.salon.id,role:member}]:[]};break;
   case 'save_profile':s.profiles[user!]={...s.profiles[user!],name:String(p.name),phone:String(p.phone),birthday:String(p.birthday||''),marketing:!!p.marketing};result=s.profiles[user!];break;
   case 'appointments':result=s.appointments.filter(a=>a.salon_id===c.salon.id&&a.client_id===user&&!['HOLD','PENDING_PAYMENT'].includes(a.status)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));break;
   case 'hold':{const service=c.services.find(x=>x.id===p.service_id)!;const pro=c.professionals.find(x=>x.id===p.professional_id)!;if(!service||!pro)throw new Error('Escolha um cuidado e uma profissional.');if(!c.units.some(u=>u.id===p.unit_id))throw new Error('Escolha uma unidade válida.');const possible=await this.rpc<{starts_at:string;professional_id:string}[]>('slots',{...p,date:String(p.starts_at).slice(0,10)});if(!possible.some(x=>x.starts_at===new Date(String(p.starts_at)).toISOString()&&x.professional_id===pro.id))throw new Error('Esse horário acabou de ser reservado. Escolha outro.');const extras=c.addons.filter(a=>(p.addons as string[]||[]).includes(a.id));const start=new Date(String(p.starts_at));const client=String(p.client_user_id||user);const a:Appointment={id:uid(),salon_id:c.salon.id,unit_id:String(p.unit_id),client_id:client,professional_id:pro.id,service_id:service.id,service_name:service.name,professional_name:pro.name,client_name:s.profiles[client]?.name||s.appointments.find(a=>a.client_id===client)?.client_name||'Cliente',client_phone:s.profiles[client]?.phone||'',starts_at:start.toISOString(),ends_at:new Date(+start+(service.duration_minutes+extras.reduce((n,x)=>n+x.duration_minutes,0))*60000).toISOString(),status:'HOLD',hold_expires_at:new Date(Date.now()+300000).toISOString(),price_cents:service.price_cents+extras.reduce((n,x)=>n+x.price_cents,0),deposit_cents:service.deposit_cents,addons:extras,address:c.units[0].address,timezone:c.units[0].timezone};s.appointments.push(a);result=a;break;}
   case 'confirm':{const a=appointment();if(a.status==='CONFIRMED'){result=a;break;}if(a.status!=='HOLD')throw new Error('Esta reserva não pode mais ser confirmada. Escolha outro horário.');if(new Date(a.hold_expires_at||0).getTime()<Date.now())throw new Error('Sua reserva expirou. Escolha um horário novamente.');a.status='CONFIRMED';event(a,'booking_confirmed');result=a;break;}
   case 'release_hold':{const a=appointment();if(a.status==='HOLD')a.status='CANCELLED';break;}
   case 'cancel':{const a=appointment();if(a.status!=='CONFIRMED')throw new Error('Este agendamento não pode ser cancelado.');if(!member&&new Date(a.starts_at).getTime()-Date.now()<c.policies.cancel_hours*3600000)throw new Error('O prazo de cancelamento terminou. Fale com a recepção.');a.status='CANCELLED';event(a,'booking_cancelled');result=a;break;}
   case 'reschedule':{const a=appointment();if(a.status!=='CONFIRMED')throw new Error('Este agendamento não pode ser reagendado.');if(!member&&new Date(a.starts_at).getTime()-Date.now()<c.policies.reschedule_hours*3600000)throw new Error('O prazo de reagendamento terminou. Fale com a recepção.');const slots=await this.rpc<{starts_at:string;professional_id:string}[]>('slots',{salon_id:c.salon.id,service_id:a.service_id,professional_id:a.professional_id,date:String(p.starts_at).slice(0,10),addons:a.addons.map(x=>x.id),ignore_id:a.id});if(!slots.some(x=>x.starts_at===new Date(String(p.starts_at)).toISOString()))throw new Error('Horário indisponível. Seu agendamento anterior foi mantido.');const duration=new Date(a.ends_at).getTime()-new Date(a.starts_at).getTime();a.starts_at=new Date(String(p.starts_at)).toISOString();a.ends_at=new Date(new Date(a.starts_at).getTime()+duration).toISOString();event(a,'booking_rescheduled');result=a;break;}
   case 'checkin':{const a=appointment();if(a.status!=='CONFIRMED'||dateKey()!==new Intl.DateTimeFormat('en-CA',{timeZone:a.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(a.starts_at)))throw new Error('O check-in fica disponível no dia do atendimento.');a.status='CHECKED_IN';result=a;event(a,'booking_status_changed');break;}
   case 'review':{const a=appointment();if(a.status!=='COMPLETED'||!Number.isInteger(p.rating)||Number(p.rating)<1||Number(p.rating)>5)throw new Error('Avalie um atendimento concluído com uma nota de 1 a 5.');a.review={rating:Number(p.rating),comment:String(p.comment||'')};break;}
   case 'notifications':result={items:customer.notifications,preferences:customer.preferences};break;
   case 'read_notifications':customer.notifications.forEach(n=>n.read_at=new Date().toISOString());break;
   case 'preferences':customer.preferences={push:!!p.push,whatsapp:!!p.whatsapp,marketing:!!p.marketing};break;
   case 'favorites':result=customer.favorites;break;
   case 'favorite':customer.favorites=p.enabled?[...new Set([...customer.favorites,String(p.professional_id)])]:customer.favorites.filter(id=>id!==p.professional_id);break;
   case 'waitlist':s.waitlist.push(`${p.service_id}:${p.date}`);break;
   case 'export':result={profile:s.profiles[user!],appointments:s.appointments.filter(a=>a.client_id===user),preferences:customer.preferences,favorites:customer.favorites};break;
   case 'delete_request':customer.preferences={push:false,whatsapp:false,marketing:false};result={message:'Solicitação demonstrativa registrada. Nenhuma conta real foi excluída.'};break;
   case 'admin_summary':{if(!member)throw new Error('Entre como equipe para abrir esta área.');const appointments=s.appointments.filter(a=>a.salon_id===c.salon.id&&!['HOLD','PENDING_PAYMENT'].includes(a.status)&&(member!=='professional'||a.professional_id===c.professionals[0].id)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));result={appointments,clients:[...new Map(s.appointments.filter(a=>a.salon_id===c.salon.id).map(a=>[a.client_id,{id:a.client_id,user_id:a.client_id,name:a.client_name,phone:a.client_phone}])).values()],blocks:s.blocks.filter(b=>(b.salon_id||s.catalogs[0].salon.id)===c.salon.id),audit:s.audit,role:member};break;}
   case 'admin_status':{if(!member)throw new Error('Acesso da equipe necessário.');const a=appointment();a.status=String(p.status);event(a,a.status==='COMPLETED'?'booking_completed':'booking_status_changed');result=a;break;}
   case 'admin_block':if(!member)throw new Error('Acesso da equipe necessário.');s.blocks.push({salon_id:c.salon.id,id:uid(),professional_id:String(p.professional_id),starts_at:String(p.starts_at),ends_at:String(p.ends_at),reason:String(p.reason)});break;
   case 'admin_branding':c.branding={...c.branding,preset:String(p.preset),primary_color:String(p.primary_color||''),font_style:String(p.font_style),dark_allowed:!!p.dark_allowed};c.salon.name=String(p.name||c.salon.name);break;
   case 'admin_rules':c.settings={...c.settings,min_notice_minutes:Number(p.min_notice_minutes),max_future_days:Number(p.max_future_days)};c.policies={cancel_hours:Number(p.cancel_hours),reschedule_hours:Number(p.reschedule_hours)};break;
   case 'admin_service':{const id=String(p.id||uid());const index=c.services.findIndex(x=>x.id===id);const value={...c.services[index],...p,id,salon_id:c.salon.id} as unknown as Service;if(index>=0)c.services[index]=value;else c.services.push(value);c.service_professionals=c.service_professionals.filter(x=>x.service_id!==id);for(const pro of p.professional_ids as string[]||[])c.service_professionals.push({service_id:id,professional_id:pro});result={id};break;}
   case 'admin_professional':{const id=String(p.id||uid());const index=c.professionals.findIndex(x=>x.id===id);const value={...c.professionals[index],...p,id,review_count:0} as unknown as Professional;if(index>=0)c.professionals[index]=value;else c.professionals.push(value);result={id};break;}
   case 'campaigns':result=s.campaigns;break;
   case 'save_campaign':{const id=String(p.id||uid());const campaign={id,name:String(p.name),message:String(p.message),audience:String(p.audience),status:String(p.status||'Rascunho')};s.campaigns=s.campaigns.filter(x=>x.id!==id);s.campaigns.unshift(campaign);result=campaign;break;}
   case 'coupons':result=s.coupons;break;
   case 'save_coupon':s.coupons.push({id:uid(),code:String(p.code).toUpperCase(),discount:Number(p.discount)});break;
   default:throw new Error('Esta ação ainda não está disponível na apresentação.');
  }
  this.save();return copy(result) as T;
 }
}
