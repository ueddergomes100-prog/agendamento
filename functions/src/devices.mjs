import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {z} from 'zod';
import {parse,fail,text} from './validation.mjs';

export async function registerDevice(db,uid,p){
 const d=parse(z.object({token:text(4096),platform:z.enum(['WEB','ANDROID','IOS']),consent:z.literal(true)}),p);
 const key=createHash('sha256').update(d.token).digest('hex');
 await db.runTransaction(async tx=>{
  const registry=db.doc(`pushDevices/${key}`),old=(await tx.get(registry)).data();
  if(old?.userId&&old.userId!==uid)tx.delete(db.doc(`users/${old.userId}/devices/${key}`));
  tx.set(registry,{userId:uid,updatedAt:Timestamp.now()});
  tx.set(db.doc(`users/${uid}/devices/${key}`),{token:d.token,platform:d.platform,active:true,lastUsedAt:Timestamp.now()});
 });return {device_id:key};
}
export async function unregisterDevice(db,uid,p){
 const key=parse(z.string().regex(/^[a-f0-9]{64}$/),p.device_id);
 await db.runTransaction(async tx=>{const registry=db.doc(`pushDevices/${key}`),old=(await tx.get(registry)).data();if(old?.userId===uid)tx.delete(registry);tx.delete(db.doc(`users/${uid}/devices/${key}`));});return {ok:true};
}
export async function testPush(db,uid,p,slug,send=message=>getMessaging().send(message)){
 const key=parse(z.string().regex(/^[a-f0-9]{64}$/),p.device_id);
 const ref=db.doc(`users/${uid}/devices/${key}`),device=(await ref.get()).data();
 if(!device?.active)fail('Ative as notificações neste aparelho antes de testar.','failed-precondition');
 // The caller chooses only their registered device. Recipient and content are server-owned.
 const eventId=`test-${Date.now()}`;
 try{await send({token:device.token,notification:{title:'Notificações ativadas',body:'Seu aparelho está pronto para receber novidades da agenda.'},data:{eventId},webpush:{headers:{TTL:'60'},notification:{tag:eventId,icon:'/icons/icon-192.png'},fcmOptions:{link:`https://agendamento-taupe-mu.vercel.app/?salon=${encodeURIComponent(slug)}&view=profile`}}});return {accepted:true};}
 catch(e){if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(e.code)){await ref.update({active:false});fail('O registro deste aparelho expirou. Ative as notificações novamente.','failed-precondition');}throw e;}
}
