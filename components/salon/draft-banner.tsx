'use client';
import {useState} from 'react';
import {useSalon} from './provider';
export function DraftBanner(){
  const {api,catalog,me,go,refresh,notice}=useSalon();const[busy,setBusy]=useState(false);
  if(api.presentation||catalog.published!==false)return null;
  const manager=me?.memberships.some(m=>m.salon_id===catalog.salon.id&&['owner','manager'].includes(m.role));
  if(!manager)return null;
  return <section className="draft-banner"><div><strong>Seu salão está em preparação.</strong><p>Configure a equipe, os serviços e a identidade. Depois, publique para receber agendamentos.</p></div><button className="btn outline" onClick={()=>go('admin')}>Configurar salão</button><button className="btn" disabled={busy} onClick={async()=>{setBusy(true);try{await api.rpc('publish_salon',{salon_id:catalog.salon.id});await refresh();notice('Seu salão está publicado. O link e o QR estão na área do salão.');}catch(e){notice((e as Error).message);}finally{setBusy(false);}}}>{busy?'Publicando…':'Publicar meu salão'}</button></section>;
}
