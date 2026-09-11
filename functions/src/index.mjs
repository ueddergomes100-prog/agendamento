import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall,HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { dispatch,rateLimit } from './api.mjs';
import { parse } from './validation.mjs';
export {deliverNotifications,releaseExpiredHolds} from './jobs.mjs';

initializeApp();
const db=getFirestore();
db.settings({ignoreUndefinedProperties:true});
export const salonApi=onCall({region:'southamerica-east1',memory:'256MiB',maxInstances:10,concurrency:40,timeoutSeconds:60,enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true'},async request=>{
  const envelope=parse(z.object({action:z.string().min(1).max(80),payload:z.record(z.string(),z.unknown()).default({})}),request.data);
  const uid=request.auth?.uid;
  try {
    await rateLimit(db,uid,envelope.action);
    return await dispatch(db,uid,envelope.action,envelope.payload,request.auth?.token||{});
  } catch(error) {
    if(error instanceof HttpsError) throw error;
    logger.error('salon_operation_failed',{action:envelope.action,code:error.code||'internal'});
    throw new HttpsError('internal','Não foi possível concluir. Tente novamente.');
  }
});
