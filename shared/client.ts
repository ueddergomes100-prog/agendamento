import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {Session} from './types';
type Storage={getItem(key:string):string|null|Promise<string|null>;setItem(key:string,value:string):void|Promise<void>;removeItem(key:string):void|Promise<void>};
export class SalonApi{
 presentation=false;
 session:Session|null=null;
 supabase:SupabaseClient|null=null;
 constructor(public config:{url?:string;key?:string;localUrl?:string},private storage?:Storage){
  if(config.url&&config.key)this.supabase=createClient(config.url,config.key,{auth:{persistSession:true,storage,autoRefreshToken:true}});
 }
 get local(){return !this.supabase&&!!this.config.localUrl;}
 async init(){
  if(this.supabase){const {data}=await this.supabase.auth.getSession();this.session=data.session as Session|null;}
  else {try{this.session=JSON.parse(await this.storage?.getItem('bella.session')||'null');}catch{this.session=null;}}
  return this.session;
 }
 async rpc<T=unknown>(action:string,payload:Record<string,unknown>={}):Promise<T>{
  if(this.supabase){const {data,error}=await this.supabase.rpc('api',{action,payload});if(error)throw new Error(error.message);return data as T;}
  if(!this.config.localUrl)throw new Error('O salão ainda não está conectado. Configure o Supabase para receber agendamentos.');
  let response:Response;
  try{response=await fetch(`${this.config.localUrl}/rpc`,{method:'POST',headers:{'Content-Type':'application/json',...(this.session?{Authorization:`Bearer ${this.session.access_token}`}:{})},body:JSON.stringify({action,payload})});}catch{throw new Error('Não foi possível conectar. Confira sua conexão e tente novamente.');}
  const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error||'Não foi possível concluir.');return data as T;
 }
 async login(email:string,password:string){
  if(this.supabase){const {data,error}=await this.supabase.auth.signInWithPassword({email,password});if(error)throw new Error('Não foi possível entrar. Confira e-mail e senha.');this.session=data.session as Session;}
  else this.session=await this.authLocal('login',{email,password});
  await this.persist();return this.session;
 }
 async register(email:string,password:string,name:string,phone:string){
  if(this.supabase){const {data,error}=await this.supabase.auth.signUp({email,password,options:{data:{name,phone}}});if(error)throw new Error(error.message);this.session=data.session as Session|null;if(this.session)await this.rpc('save_profile',{name,phone});}
  else this.session=await this.authLocal('register',{email,password,name,phone});
  await this.persist();return this.session;
 }
 async logout(){if(this.supabase)await this.supabase.auth.signOut();else if(this.session)await this.authLocal('logout',{});this.session=null;await this.storage?.removeItem('bella.session');}
 private async persist(){if(this.local)await this.storage?.setItem('bella.session',JSON.stringify(this.session));}
 private async authLocal(action:string,body:Record<string,unknown>):Promise<Session>{if(!this.config.localUrl)throw new Error('Conecte o Supabase para acessar.');const response=await fetch(`${this.config.localUrl}/auth/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(this.session?{Authorization:`Bearer ${this.session.access_token}`}:{})},body:JSON.stringify(body)});const data=await response.json() as Session & {error?:string};if(!response.ok)throw new Error(data.error);return data;}
}
