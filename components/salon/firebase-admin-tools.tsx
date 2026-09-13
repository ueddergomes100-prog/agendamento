'use client';
import {useState} from 'react';
import {FirebaseSalonApi} from '@/shared/firebase-client';
import {useSalon} from './provider';
import {themeFor} from '@/shared/theme';

export function BrandingAssets(){
  const {api,catalog,refresh,notice}=useSalon();const[logo,setLogo]=useState(catalog.branding.logo_url||''),[cover,setCover]=useState(catalog.branding.cover_url||''),[busy,setBusy]=useState(false);
  async function upload(file:File|undefined,type:'logo'|'cover'){
    if(!file||!(api instanceof FirebaseSalonApi))return;
    setBusy(true);try{const url=await api.uploadBranding(catalog.salon.id,file);if(type==='logo')setLogo(url);else setCover(url);await api.rpc('admin_branding',{salon_id:catalog.salon.id,...catalog.branding,name:catalog.salon.name,primary_color:catalog.branding.primary_color||'',...(type==='logo'?{logo_url:url}:{cover_url:url})});await refresh();notice('Imagem salva na identidade do salão.');}catch(e){notice((e as Error).message);}finally{setBusy(false);}
  }
  const theme=themeFor(catalog.branding.preset,catalog.branding.primary_color);
  return <section className="panel branding-upload"><div><h2>As imagens do seu salão</h2><p>Logo e capa acompanham a experiência das clientes.</p><label className="field-label">Logo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>upload(e.target.files?.[0],'logo')}/></label><label className="field-label">Capa<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>upload(e.target.files?.[0],'cover')}/></label><small>PNG, JPEG ou WebP, até 5 MB.</small></div><div className="salon-phone" style={{background:theme.background,color:theme.text}}>{logo&&<img className="salon-phone-logo" src={logo} alt="Logo do salão"/>}<strong>{catalog.salon.name}</strong>{cover&&<img className="salon-phone-cover" src={cover} alt="Capa do salão"/>}<h3>Seu momento.<br/>Do seu jeito.</h3><span style={{background:theme.primary,color:theme.onPrimary}}>Agendar meu cuidado</span><small>Prévia da identidade atual</small></div></section>;
}
export function MembershipForm({onSaved}:{onSaved?:()=>void}){
  const{api,catalog,notice}=useSalon();const[role,setRole]=useState('RECEPTIONIST'),[busy,setBusy]=useState(false);
  return <section className="panel"><h2>Acesso da equipe</h2><p>A pessoa precisa criar uma conta primeiro. Informe o e-mail usado no cadastro para conceder acesso a este salão.</p><form className="form-stack" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);try{await api.rpc('admin_member',{salon_id:catalog.salon.id,email:f.get('email'),role,status:f.get('status'),...(role==='PROFESSIONAL'?{professional_id:f.get('professional')}:{})});notice('Permissões atualizadas.');onSaved?.();}catch(e){notice((e as Error).message);}finally{setBusy(false);}}}><label>E-mail da pessoa<input type="email" name="email" required maxLength={254}/></label><label>Função<select value={role} onChange={e=>setRole(e.target.value)}><option value="RECEPTIONIST">Recepção</option><option value="MANAGER">Gerência</option><option value="PROFESSIONAL">Profissional</option><option value="FINANCE">Financeiro</option></select></label>{role==='PROFESSIONAL'&&<label>Perfil profissional<select required name="professional">{catalog.professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label>Acesso<select name="status"><option value="ACTIVE">Ativo</option><option value="INACTIVE">Suspenso</option></select></label><button className="btn" disabled={busy}>{busy?'Salvando…':'Salvar acesso'}</button></form></section>;
}
