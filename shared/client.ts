import type {Session} from './types';
// Shared contract for the presentation and Firebase adapters.
export class SalonApi {
  presentation=false;
  session:Session|null=null;
  constructor(_config:Record<string,unknown>={}){}
  get local(){return false;}
  async init(){return this.session;}
  async rpc<T=unknown>(_action:string,_payload:Record<string,unknown>={}):Promise<T>{throw new Error('Conecte o Firebase para continuar.');}
  async login(_email:string,_password:string):Promise<Session|null>{throw new Error('Conecte o Firebase para entrar.');}
  async register(_email:string,_password:string,_name:string,_phone:string,_accountType:'CLIENT'|'SALON'='CLIENT'):Promise<Session|null>{throw new Error('Conecte o Firebase para cadastrar.');}
  async logout(){this.session=null;}
}
