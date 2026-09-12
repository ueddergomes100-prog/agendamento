import {getMessaging,getToken,deleteToken,isSupported,onMessage} from 'firebase/messaging';
import type {FirebaseSalonApi} from './firebase-client';
import {readLocal,writeLocal} from './local-preferences';

const VAPID='BMiPpAx5ovFcEPv3puFPaUyDAMN4iDP0qnS4b-LsxFIqbd3WwhZBcqxtnh8a_-_H1QYe7C5zkEQ2p57zKZPqi90';
const KEY='bella.push.device';
type Device={uid:string;id:string};
export function currentPushDevice(uid?:string){const d=readLocal<Device|null>(KEY,null);return d?.uid===uid?d:null;}
export function pushInstallationRequired(){return (/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))&&!matchMedia('(display-mode: standalone)').matches&&!(navigator as Navigator&{standalone?:boolean}).standalone;}
async function worker(){await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;}
async function register(api:FirebaseSalonApi){
 if(!api.auth.currentUser)throw new Error('Entre na sua conta para ativar os lembretes.');
 if(!await isSupported())throw new Error('Este navegador não oferece notificações. Use o app instalado ou um navegador atualizado.');
 const token=await getToken(getMessaging(api.firebaseApp),{vapidKey:VAPID,serviceWorkerRegistration:await worker()});
 if(!token)throw new Error('Não foi possível registrar este aparelho. Tente novamente.');
 const {device_id}=await api.rpc<{device_id:string}>('register_device',{token,platform:'WEB',consent:true});
 const device={uid:api.auth.currentUser.uid,id:device_id};writeLocal(KEY,device);return device;
}
export async function enablePush(api:FirebaseSalonApi){
 if(pushInstallationRequired())throw new Error('No iPhone, adicione à Tela de Início pelo menu Compartilhar e abra o app pelo ícone.');
 if(!('Notification' in window)||!('serviceWorker' in navigator))throw new Error('Notificações indisponíveis neste navegador.');
 // Request permission directly from the user's button click, before asynchronous work (iOS).
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw new Error(permission==='denied'?'As notificações estão bloqueadas. Libere nas configurações do aparelho ou do navegador.':'Permissão não concedida. Você pode ativar quando quiser.');
 return register(api);
}
export async function syncPush(api:FirebaseSalonApi){
 if(!currentPushDevice(api.auth.currentUser?.uid)||!('Notification' in window)||Notification.permission!=='granted')return;
 return register(api);
}
export async function disablePush(api:FirebaseSalonApi){
 const device=currentPushDevice(api.auth.currentUser?.uid);if(!device)return;
 await api.rpc('unregister_device',{device_id:device.id});
 if(await isSupported())await deleteToken(getMessaging(api.firebaseApp));
 try{localStorage.removeItem(KEY);}catch{}
}
export async function listenForPush(api:FirebaseSalonApi){
 if(!await isSupported())return()=>{};
 return onMessage(getMessaging(api.firebaseApp),async message=>{
  if(!currentPushDevice(api.auth.currentUser?.uid)||Notification.permission!=='granted')return;
  const link=new URL(message.fcmOptions?.link||'/?view=agenda',location.origin);
  if(link.origin!==location.origin)return;
  const registration=await navigator.serviceWorker.ready;
  await registration.showNotification(message.notification?.title||'Novidade na agenda',{body:message.notification?.body||'Abra o aplicativo para conferir.',icon:'/icons/icon-192.png',tag:message.data?.eventId||message.messageId,data:{link:link.href}});
 });
}
