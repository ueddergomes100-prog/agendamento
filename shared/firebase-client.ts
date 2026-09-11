import {getApps,initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut,updateProfile,sendPasswordResetEmail,signInWithPopup,GoogleAuthProvider} from 'firebase/auth';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'firebase/app-check';
import {getFirestore,connectFirestoreEmulator,collection,query,where,orderBy,limit,onSnapshot} from 'firebase/firestore';
import {getStorage,connectStorageEmulator,ref,uploadBytes,getDownloadURL} from 'firebase/storage';
import {SalonApi} from './client';
import {firebaseConfig} from './firebase-config';

let initialized=false;
const clean=(value:Record<string,unknown>)=>JSON.parse(JSON.stringify(value)) as Record<string,unknown>;
export class FirebaseSalonApi extends SalonApi {
  private app=getApps().find(a=>a.name==='salon')||initializeApp({...firebaseConfig,...(import.meta.env.VITE_FIREBASE_EMULATORS==='true'?{projectId:'demo-salon'}:{})},'salon');
  readonly auth=getAuth(this.app);
  readonly db=getFirestore(this.app);
  readonly functions=getFunctions(this.app,'southamerica-east1');
  readonly storage=getStorage(this.app);
  private currentSalon?:string;
  constructor(){
    super();
    if(!initialized){
      if(import.meta.env.VITE_FIREBASE_EMULATORS==='true'){
        if(!/^(localhost|127\.0\.0\.1)$/.test(location.hostname))throw new Error('Emuladores disponíveis apenas no ambiente local.');
        connectAuthEmulator(this.auth,'http://127.0.0.1:9099',{disableWarnings:true});
        connectFirestoreEmulator(this.db,'127.0.0.1',8080);
        connectFunctionsEmulator(this.functions,'127.0.0.1',5001);
        connectStorageEmulator(this.storage,'127.0.0.1',9199);
      }else if(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY){
        initializeAppCheck(this.app,{provider:new ReCaptchaEnterpriseProvider(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});
      }
      initialized=true;
    }
  }
  private async syncSession(){const user=this.auth.currentUser;this.session=user?{access_token:await user.getIdToken(),user:{id:user.uid,email:user.email||undefined}}:null;return this.session;}
  async init(){await this.auth.authStateReady();return this.syncSession();}
  async rpc<T=unknown>(action:string,payload:Record<string,unknown>={}):Promise<T>{
    await this.syncSession();
    const p=clean({...(!payload.salon_id&&this.currentSalon?{salon_id:this.currentSalon}:{}),...payload});
    if(['hold','provision_salon','admin_block'].includes(action)&&!p.request_id)p.request_id=crypto.randomUUID();
    try{
      const response=await httpsCallable<{action:string;payload:Record<string,unknown>},T>(this.functions,'salonApi')({action,payload:p});
      if(action==='catalog')this.currentSalon=(response.data as {salon:{id:string}}).salon.id;
      return response.data;
    }catch(error){throw this.friendly(error);}
  }
  async login(email:string,password:string){try{await signInWithEmailAndPassword(this.auth,email,password);return this.syncSession();}catch(e){throw this.friendly(e);}}
  async register(email:string,password:string,name:string,phone:string){try{const result=await createUserWithEmailAndPassword(this.auth,email,password);await updateProfile(result.user,{displayName:name});await this.syncSession();await this.rpc('save_profile',{name,phone});return this.session;}catch(e){throw this.friendly(e);}}
  async googleLogin(){try{await signInWithPopup(this.auth,new GoogleAuthProvider());return this.syncSession();}catch(e){throw this.friendly(e);}}
  async resetPassword(email:string){try{await sendPasswordResetEmail(this.auth,email);}catch(e){throw this.friendly(e);}}
  async logout(){await signOut(this.auth);this.session=null;}
  watchAppointments(salonId:string,callback:()=>void,onError:(error:Error)=>void){
    if(!this.auth.currentUser)return()=>{};
    const q=query(collection(this.db,`salons/${salonId}/appointments`),where('client_id','==',this.auth.currentUser.uid),orderBy('starts_at','asc'),limit(100));
    let initial=true;
    return onSnapshot(q,()=>{if(initial){initial=false;return;}callback();},error=>onError(this.friendly(error)));
  }
  async uploadBranding(salonId:string,file:File){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>=5*1024*1024)throw new Error('Use PNG, JPEG ou WebP com menos de 5 MB.');
    const asset=ref(this.storage,`salons/${salonId}/branding/${crypto.randomUUID()}`);
    await uploadBytes(asset,file,{contentType:file.type});return getDownloadURL(asset);
  }
  private friendly(error:unknown){
    const e=error as {code?:string;message?:string};
    const messages:Record<string,string>={
      'auth/invalid-credential':'Confira seu e-mail e senha.',
      'auth/email-already-in-use':'Este e-mail já possui uma conta. Entre para continuar.',
      'auth/weak-password':'Use uma senha com pelo menos seis caracteres.',
      'auth/operation-not-allowed':'Este método de acesso ainda precisa ser ativado no Firebase.',
      'auth/unauthorized-domain':'Este domínio precisa ser autorizado no Firebase Authentication.',
      'auth/network-request-failed':'Confira sua conexão e tente novamente.',
      'auth/too-many-requests':'Muitas tentativas. Aguarde alguns minutos.',
      'functions/unauthenticated':'Entre novamente. Se o erro continuar, confira a configuração do App Check.',
      'functions/unavailable':'O servidor está indisponível. Tente novamente em instantes.',
      'functions/internal':'Não foi possível acessar o servidor. Confira se a integração Firebase foi publicada.',
      'permission-denied':'Sua conta não possui permissão para consultar esses dados.',
    };
    return new Error(messages[e.code||'']||e.message||'Não foi possível concluir.');
  }
}
