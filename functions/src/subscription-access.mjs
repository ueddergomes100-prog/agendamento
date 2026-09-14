import {DateTime} from 'luxon';
import {fail} from './validation.mjs';

// Enforcement is explicitly activated after the billing environment has been validated.
// Owners can always enter administration to pay or export data.
export async function requireSalonSubscription(db,salonId){
  const settings=(await db.doc('platformSettings/billing').get()).data();
  if(!settings?.enforceSubscriptions)return;
  const environment=settings.environment==='production'?'production':'sandbox';
  const subscription=(await db.doc(`asaasSubscriptions/${environment}_${salonId}`).get()).data()?.public;
  const today=DateTime.now().setZone('America/Sao_Paulo').toISODate();
  if(!subscription?.paidThrough||subscription.paidThrough<=today)fail('A mensalidade do salão precisa ser regularizada para receber novas reservas. A proprietária pode acessar Pagamentos na administração.');
}
