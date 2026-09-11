import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {logger} from 'firebase-functions';

// At-least-once delivery; a stable notification tag collapses a retry on the device.
export const deliverNotifications=onSchedule({schedule:'every 5 minutes',region:'southamerica-east1',maxInstances:1,timeoutSeconds:120,memory:'256MiB'},async()=>{
  const db=getFirestore(),now=Timestamp.now();
  const batch=await db.collectionGroup('outbox').where('status','==','PENDING').where('scheduledAt','<=',now).orderBy('scheduledAt').limit(100).get();
  for(const snapshot of batch.docs){
    const job=await db.runTransaction(async tx=>{
      const current=await tx.get(snapshot.ref),data=current.data();
      if(data?.status!=='PENDING'||(data.leaseUntil?.toMillis()||0)>Date.now())return null;
      tx.update(snapshot.ref,{leaseUntil:Timestamp.fromMillis(Date.now()+180000),attempts:(data.attempts||0)+1});return data;
    });
    if(!job)continue;
    try{
      const [relationship,appointment,devices,publicSalon]=await Promise.all([db.doc(`users/${job.clientId}/salons/${job.salonId}`).get(),db.doc(`salons/${job.salonId}/appointments/${job.appointmentId}`).get(),db.collection(`users/${job.clientId}/devices`).where('active','==',true).limit(20).get(),db.doc(`publicSalons/${job.salonId}`).get()]);
      const a=appointment.data();
      const stale=job.action==='booking_reminder'&&(!a||a.status!=='CONFIRMED'||a.starts_at!==job.expectedStart);
      if(stale||!relationship.data()?.preferences?.push||devices.empty){await snapshot.ref.update({status:'SKIPPED',reason:stale?'STALE':'NO_PUSH_CONSENT_OR_DEVICE',leaseUntil:null});continue;}
      const tokens=devices.docs.map(d=>d.data().token),link=`https://agendamento-taupe-mu.vercel.app/?mode=live&salon=${encodeURIComponent(publicSalon.data().slug)}&view=agenda`;
      const sent=await getMessaging().sendEachForMulticast({tokens,notification:{title:job.action==='booking_reminder'?'Seu momento está chegando':'Novidade na sua agenda',body:'Abra o aplicativo para conferir os detalhes.'},data:{salonId:job.salonId,appointmentId:job.appointmentId,eventId:snapshot.id},webpush:{notification:{tag:snapshot.id,icon:'/icons/icon-192.png'},fcmOptions:{link}}});
      const invalid=sent.responses.flatMap((r,i)=>['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code)?[devices.docs[i].ref]:[]);
      await Promise.all(invalid.map(ref=>ref.update({active:false})));
      const transient=sent.failureCount-invalid.length;
      await snapshot.ref.update({status:transient&&job.attempts<4?'PENDING':transient?'FAILED':'SENT',leaseUntil:null,scheduledAt:Timestamp.fromMillis(Date.now()+300000),successCount:sent.successCount,failureCount:sent.failureCount,updatedAt:Timestamp.now()});
    }catch(error){
      logger.warn('push_delivery_failed',{eventId:snapshot.id,code:error.code||'internal'});
      await snapshot.ref.update({status:(job.attempts||0)<4?'PENDING':'FAILED',leaseUntil:null,scheduledAt:Timestamp.fromMillis(Date.now()+300000),updatedAt:Timestamp.now()});
    }
  }
});

// TTL is eventual. Booking correctness already ignores expired entries synchronously.
export const releaseExpiredHolds=onSchedule({schedule:'every 30 minutes',region:'southamerica-east1',maxInstances:1},async()=>{
  const db=getFirestore(),expired=await db.collectionGroup('appointmentHolds').where('expiresAt','<=',Timestamp.now()).limit(400).get();
  if(expired.empty)return;
  const batch=db.batch();expired.docs.forEach(s=>batch.delete(s.ref));await batch.commit();
});
