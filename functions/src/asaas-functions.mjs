import {getFirestore} from 'firebase-admin/firestore';
import {onCall,onRequest,HttpsError} from 'firebase-functions/v2/https';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {defineSecret} from 'firebase-functions/params';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {readAsaasConfig,tokenMatches} from './asaas-client.mjs';
import {financialDispatch,processAsaasEvent,runPayout} from './asaas.mjs';
import {parse} from './validation.mjs';
import {rateLimit} from './api.mjs';

const config=defineSecret('ASAAS_CONFIG');
const options={region:'southamerica-east1',secrets:[config],memory:'256MiB',maxInstances:5};
export const asaasApi=onCall({...options,enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true',timeoutSeconds:120},async request=>{
  const envelope=parse(z.object({action:z.string().min(1).max(80),payload:z.record(z.string(),z.unknown()).default({})}),request.data);
  const db=getFirestore();await rateLimit(db,request.auth?.uid,envelope.action);
  try{return await financialDispatch(db,request.auth?.uid,envelope.action,envelope.payload,readAsaasConfig(config.value()));}
  catch(e){if(e instanceof HttpsError)throw e;throw new HttpsError('failed-precondition',e.definitive?e.message:'A operação precisa ser conferida. Atualize o histórico antes de repetir.');}
});
export const asaasWebhook=onRequest({...options,timeoutSeconds:30},async(req,res)=>{
  const c=readAsaasConfig(config.value());
  if(req.method!=='POST'){res.sendStatus(405);return;}
  if(!c.enabled||!tokenMatches(req.get('asaas-access-token'),c.webhookToken)){res.sendStatus(401);return;}
  const body=req.body,scope=req.query.salon||'platform';
  if(typeof scope!=='string'||!/^([a-zA-Z0-9_-]{1,128})$/.test(scope)||typeof body?.id!=='string'||body.id.length>200||typeof body.event!=='string'){res.sendStatus(400);return;}
  // Store identifiers only; processing reads current provider state to handle reordered events.
  const event={id:body.id,event:body.event,...(body.payment?{payment:{id:body.payment.id||null,subscription:body.payment.subscription||null}}:{}),...(body.subscription?{subscription:{id:body.subscription.id||null}}:{}),...(body.transfer?{transfer:{id:body.transfer.id||null}}:{})};
  const ref=getFirestore().doc(`asaasEvents/${createHash('sha256').update(`${c.environment}:${scope}:${body.id}`).digest('hex')}`);
  try{await ref.create({event,scope,environment:c.environment,status:'PENDING',createdAt:new Date().toISOString()});res.status(200).json({received:true});}
  catch(e){if(e.code===6)res.status(200).json({received:true});else res.sendStatus(503);}
});
export const asaasEventWorker=onDocumentCreated({...options,document:'asaasEvents/{eventId}',retry:true,timeoutSeconds:120},async event=>{
  const row=event.data?.data(),c=readAsaasConfig(config.value());if(!row||row.environment!==c.environment)return;
  if((await event.data.ref.get()).data()?.status==='DONE')return;
  await processAsaasEvent(getFirestore(),c,row.event,row.scope);
  await event.data.ref.update({status:'DONE',processedAt:new Date().toISOString()});
});
export const asaasScheduledPayouts=onSchedule({...options,schedule:'every 15 minutes',timeZone:'America/Sao_Paulo',timeoutSeconds:540,maxInstances:1},async()=>{
  const c=readAsaasConfig(config.value());if(!c.enabled||!c.apiKey)return;
  const db=getFirestore(),cursor=db.doc('asaasJobState/payouts'),last=(await cursor.get()).data()?.cursor;
  let query=db.collection('asaasAccounts').orderBy('__name__').limit(50);if(last)query=query.startAfter(last);
  const accounts=await query.get();for(const a of accounts.docs)await runPayout(db,c,a.data());
  await cursor.set({cursor:accounts.size===50?accounts.docs.at(-1).id:null});
});
