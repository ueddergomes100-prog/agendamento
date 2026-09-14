import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';
import {fail} from './validation.mjs';

export function readAsaasConfig(raw=process.env.ASAAS_CONFIG) {
  const c=raw?JSON.parse(raw):{};
  return {...c,enabled:c.enabled===true,environment:c.environment==='production'?'production':'sandbox'};
}
export function requireAsaas(c){
  if(!c.enabled||!c.apiKey||!c.encryptionKey||!c.webhookToken)fail('Asaas aguardando configuração segura da plataforma.');
  if(Buffer.from(c.encryptionKey,'base64').length!==32)fail('Configuração de segurança do Asaas inválida.');
}
export function seal(value,key,context){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64')).join('.');
}
export function unseal(value,key,context){
  const [iv,tag,data]=value.split('.').map(s=>Buffer.from(s,'base64'));
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);cipher.setAAD(Buffer.from(context));cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');
}
export function tokenMatches(actual,expected){
  if(typeof actual!=='string'||typeof expected!=='string'||expected.length<32)return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export function asaasClient(config,key=config.apiKey,transport=fetch){
  requireAsaas(config);
  const base=config.environment==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
  return async(path,method='GET',body)=>{
    if(!path.startsWith('/')||path.includes('://'))throw Error('Invalid Asaas route');
    let response;
    try{response=await transport(base+path,{method,redirect:'error',headers:{access_token:key,'Content-Type':'application/json','User-Agent':'Agendamento/1.0'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}
    catch{fail('Não foi possível confirmar a resposta do Asaas. Consulte o histórico antes de repetir.','unavailable');}
    let result;try{result=await response.json();}catch{fail('Resposta incompleta do Asaas. A operação precisa ser conferida.','unavailable');}
    if(!response.ok){
      // Never forward provider responses: they may echo personal data or credentials.
      const error=new Error(response.status===401||response.status===403?'Conta Asaas sem autorização. Confira a chave e a aprovação.':'O Asaas recusou a operação. Confira os dados e a situação da conta no painel Asaas.');
      error.definitive=response.status>=400&&response.status<500&&response.status!==408&&response.status!==429;
      error.providerStatus=response.status;throw error;
    }
    return result;
  };
}
export const cents=value=>Math.round(Number(value)*100);
export function checkoutUrl(value){
  try{const u=new URL(value);if(u.protocol==='https:'&&(u.hostname==='asaas.com'||u.hostname.endsWith('.asaas.com')))return u.href;}catch{}
  return null;
}
