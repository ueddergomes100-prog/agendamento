import {z} from 'zod';
import {parse,fail} from './validation.mjs';

// Prices belong to the platform. Client payloads and legacy secret values cannot override them.
export const subscriptionPlans=Object.freeze([
  Object.freeze({id:'BASIC',name:'Sem WhatsApp',monthlyCents:5990,whatsapp:false,available:true}),
  // Enable only after the WhatsApp integration and plan entitlement checks are implemented.
  Object.freeze({id:'WHATSAPP',name:'Com WhatsApp',monthlyCents:9990,whatsapp:true,available:false}),
]);

export function requireSubscriptionPlan(value){
  const planId=parse(z.enum(['BASIC','WHATSAPP']).default('BASIC'),value);
  const plan=subscriptionPlans.find(p=>p.id===planId);
  if(!plan.available)fail('O plano com WhatsApp estará disponível após a ativação da integração.');
  return plan;
}
