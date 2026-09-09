import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createDatabase, invoke, seed } from './database.mjs';

if(process.env.NODE_ENV==='production') throw new Error('A API local não pode ser usada em produção. Configure Supabase.');
await mkdir('.data',{recursive:true});
const db=await createDatabase('.data/postgres');
await seed(db);
const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
 const origin=req.headers.origin;
 if(origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return res.status(403).json({error:'Origem não autorizada.'});
 if(origin) res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='OPTIONS') return res.sendStatus(204); next();
});
app.use(express.json({limit:'32kb'}));
app.use(rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false}));
const authLimit=rateLimit({windowMs:60000,limit:12,standardHeaders:'draft-8',legacyHeaders:false});
const hash=value=>createHash('sha256').update(value).digest('hex');
async function userFor(req){ const token=(req.headers.authorization||'').replace(/^Bearer /,''); if(!token)return null; return (await db.query('select user_id from local.sessions where token_hash=$1 and expires_at>now()',[hash(token)])).rows[0]?.user_id||null; }
app.get('/health',(_,res)=>res.json({ok:true,mode:'local-development',database:'PostgreSQL'}));
app.post('/auth/:action',authLimit,async(req,res)=>{
 try{
  const {action}=req.params;
  if(action==='logout'){await db.query('delete from local.sessions where token_hash=$1',[hash((req.headers.authorization||'').replace(/^Bearer /,''))]);return res.json({ok:true});}
  const {email,password,name,phone}=req.body;
  if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>200||typeof password!=='string'||password.length<8||password.length>128) return res.status(400).json({error:'Informe um e-mail válido e senha com pelo menos 8 caracteres.'});
  let user;
  if(action==='register'){
   if(typeof name!=='string'||name.trim().length<2||name.length>100||typeof phone!=='string'||!/^\+?[0-9 ()-]{10,20}$/.test(phone)) return res.status(400).json({error:'Informe seu nome e telefone com DDD.'});
   const id=randomUUID(),salt=randomBytes(16).toString('hex');
   await db.transaction(async tx=>{
    await tx.query('insert into auth.users(id,email,password_hash,salt) values($1,$2,$3,$4)',[id,email.trim().toLowerCase(),scryptSync(password,salt,64).toString('hex'),salt]);
    await tx.query('insert into public.profiles(id,name,phone) values($1,$2,$3)',[id,name.trim(),phone]);
   });
   user={id,email};
  }else if(action==='login'){
   const row=(await db.query('select * from auth.users where email=$1',[email.trim().toLowerCase()])).rows[0];
   const derived=scryptSync(password,row?.salt||'constant-unknown-user',64);
   if(!row||!timingSafeEqual(derived,Buffer.from(row.password_hash,'hex')))return res.status(401).json({error:'E-mail ou senha incorretos.'});
   user={id:row.id,email:row.email};
  }else return res.status(404).json({error:'Operação não encontrada.'});
  const access_token=randomBytes(32).toString('hex');
  await db.query("insert into local.sessions values($1,$2,now()+interval '7 days')",[hash(access_token),user.id]);
  res.json({access_token,user});
 }catch(err){res.status(400).json({error:err.code==='23505'?'Não foi possível cadastrar este e-mail. Tente entrar na conta.':'Não foi possível concluir o acesso.'});}
});
app.post('/rpc',async(req,res)=>{
 try{
  const {action,payload={}}=req.body;
  if(typeof action!=='string'||typeof payload!=='object'||Array.isArray(payload))return res.status(400).json({error:'Solicitação inválida.'});
  res.json(await invoke(db,await userFor(req),action,payload));
 }catch(err){
  const safe=err.code==='42501'?'Sem permissão para esta operação.':err.code==='23503'?'Um item não pertence a este salão.':err.code==='23514'?'Confira os valores informados.':err.code==='22P02'||err.code==='22007'?'Dados inválidos.':err.message;
  res.status(err.code==='42501'?403:err.code==='28000'?401:409).json({error:safe});
 }
});
app.use((err,req,res,next)=>res.status(400).json({error:'Não foi possível ler a solicitação.'}));
const server=app.listen(Number(process.env.LOCAL_API_PORT||4318),'127.0.0.1',()=>console.log('API PostgreSQL local: http://127.0.0.1:4318'));
async function shutdown(){server.close();await db.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
