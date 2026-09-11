import {test,before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,collection,query,where,getDocs} from 'firebase/firestore';
let env;
before(async()=>{
  if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Use the Firestore emulator.');
  env=await initializeTestEnvironment({projectId:'demo-salon',firestore:{rules:await readFile('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const [path,data] of Object.entries({
      'salons/rules-a':{name:'A'},'salons/rules-b':{name:'B'},
      'salons/rules-a/members/owner-a':{role:'OWNER',status:'ACTIVE'},
      'salons/rules-b/members/owner-b':{role:'OWNER',status:'ACTIVE'},
      'salons/rules-a/members/pro-a':{role:'PROFESSIONAL',status:'ACTIVE',professionalId:'p1'},
      'salons/rules-a/members/revoked':{role:'OWNER',status:'INACTIVE'},
      'salons/rules-a/appointments/appt-a':{client_id:'client-a',professional_id:'p1'},
      'salons/rules-a/appointments/appt-b':{client_id:'client-b',professional_id:'p2'},
      'salons/rules-a/clients/client-a':{phone:'private'},
      'salons/rules-a/scheduleDays/p1_2026-10-01':{entries:[]},
      'salons/rules-a/payments/pay':{amount:100},
      'publicSalons/rules-a':{published:true},'publicSalons/rules-b':{published:false},
      'platformSettings/private':{value:1},'users/client-a':{name:'A'}
    }))await setDoc(doc(db,path),data);
  });
});
after(async()=>env?.cleanup());
const db=uid=>env.authenticatedContext(uid).firestore();
test('owners cannot read another tenant or self-assign permissions',async()=>{
  await assertSucceeds(getDoc(doc(db('owner-a'),'salons/rules-a')));
  await assertFails(getDoc(doc(db('owner-a'),'salons/rules-b')));
  await assertFails(setDoc(doc(db('owner-a'),'salons/rules-b/members/owner-a'),{role:'OWNER',status:'ACTIVE'}));
  await assertFails(getDoc(doc(db('revoked'),'salons/rules-a')));
});
test('client reads only own appointments and cannot write critical fields',async()=>{
  await assertSucceeds(getDoc(doc(db('client-a'),'salons/rules-a/appointments/appt-a')));
  await assertFails(getDoc(doc(db('client-a'),'salons/rules-a/appointments/appt-b')));
  await assertFails(setDoc(doc(db('client-a'),'salons/rules-a/appointments/fake'),{client_id:'client-a',status:'CONFIRMED'}));
  await assertFails(getDocs(collection(db('client-a'),'salons/rules-a/appointments')));
  await assertSucceeds(getDocs(query(collection(db('client-a'),'salons/rules-a/appointments'),where('client_id','==','client-a'))));
});
test('professional access is limited to their own schedule and excludes CRM and finance',async()=>{
  await assertSucceeds(getDoc(doc(db('pro-a'),'salons/rules-a/appointments/appt-a')));
  await assertFails(getDoc(doc(db('pro-a'),'salons/rules-a/appointments/appt-b')));
  await assertFails(getDoc(doc(db('pro-a'),'salons/rules-a/clients/client-a')));
  await assertFails(getDoc(doc(db('pro-a'),'salons/rules-a/payments/pay')));
});
test('only published catalogs are public; private ledgers and profiles are inaccessible',async()=>{
  const anonymous=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymous,'publicSalons/rules-a')));
  await assertFails(getDoc(doc(anonymous,'publicSalons/rules-b')));
  await assertFails(getDoc(doc(anonymous,'salons/rules-a/scheduleDays/p1_2026-10-01')));
  await assertFails(getDoc(doc(db('client-b'),'users/client-a')));
  await assertFails(getDoc(doc(db('owner-a'),'platformSettings/private')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin',{superAdmin:true}).firestore(),'platformSettings/private')));
});
