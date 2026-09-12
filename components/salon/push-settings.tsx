'use client';
import {useEffect,useState} from 'react';
import {FirebaseSalonApi} from '@/shared/firebase-client';
import {currentPushDevice,enablePush,disablePush,pushInstallationRequired} from '@/shared/push';
import type {Preferences} from '@/shared/types';
import {useSalon} from './provider';

export function PushSettings({preferences,onChange}:{preferences:Preferences;onChange:(p:Preferences)=>void}){
 const {api,session,catalog}=useSalon();
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[install,setInstall]=useState(false);
 useEffect(()=>{setEnabled(!!currentPushDevice(session?.user.id)&&'Notification' in window&&Notification.permission==='granted');setInstall(pushInstallationRequired());},[session?.user.id]);
 if(!(api instanceof FirebaseSalonApi))return null;
 const change=async()=>{setBusy(true);setMessage('');try{
  if(enabled){await disablePush(api);setEnabled(false);setMessage('Notificações desativadas neste aparelho.');}
  else {await enablePush(api);const next={...preferences,push:true};await api.rpc('preferences',{salon_id:catalog.salon.id,...next});onChange(next);setEnabled(true);setMessage('Permissão concedida e aparelho registrado. Envie um teste para conferir o recebimento.');}
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 const test=async()=>{setBusy(true);setMessage('');try{const device=currentPushDevice(session?.user.id);if(!device)throw new Error('Ative este aparelho primeiro.');if(!preferences.push){const next={...preferences,push:true};await api.rpc('preferences',{...next,salon_id:catalog.salon.id});onChange(next);}await api.rpc('test_push',{device_id:device.id,salon_id:catalog.salon.id});setMessage('Teste enviado. Confira a central de notificações do aparelho.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 return <section className="panel"><h2>Notificações no celular</h2><p>Receba confirmações, alterações e lembretes dos seus agendamentos.</p>{install&&<p className="policy-note">No iPhone ou iPad (iOS 16.4 ou superior), use Compartilhar → Adicionar à Tela de Início. Abra pelo novo ícone e volte aqui para ativar. No Android, você também pode instalar pelo menu do navegador.</p>}<p>{enabled?'Este aparelho está registrado.':'Notificações ainda não ativadas neste aparelho.'}</p><div className="form-stack"><button className="btn" onClick={change} disabled={busy||install}>{busy?'Aguarde…':enabled?'Desativar neste aparelho':'Ativar notificações'}</button>{enabled&&<button className="btn secondary" disabled={busy} onClick={test}>Enviar notificação de teste</button>}</div>{message&&<p role="status" className="policy-note">{message}</p>}<small>O modo Foco e as configurações do sistema podem silenciar os alertas.</small></section>;
}
