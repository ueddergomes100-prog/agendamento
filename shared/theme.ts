export const presets={
 Luxury:{primary:'#614d30',secondary:'#eee3cf',accent:'#ac873f',background:'#fcfaf5',surface:'#ffffff',text:'#30291f',muted:'#746750',border:'#e5d9c2'},
 Minimal:{primary:'#3f4d49',secondary:'#e8eeeb',accent:'#7e9087',background:'#fafcfb',surface:'#ffffff',text:'#24342c',muted:'#65756d',border:'#dce5df'},
 Rose:{primary:'#92515f',secondary:'#f2e3e5',accent:'#b18c59',background:'#fcf9f7',surface:'#ffffff',text:'#352c30',muted:'#78676e',border:'#eadfe1'},
 Champagne:{primary:'#7c613d',secondary:'#f2eadc',accent:'#997945',background:'#fcfaf6',surface:'#ffffff',text:'#362f27',muted:'#75695c',border:'#e6ded1'},
 Blossom:{primary:'#965573',secondary:'#f4e5ee',accent:'#9374a5',background:'#fdf9fc',surface:'#ffffff',text:'#3b2c37',muted:'#7c6876',border:'#e9ddea'},
 Noir:{primary:'#d8b6a1',secondary:'#342c2e',accent:'#c9a566',background:'#1c181a',surface:'#272224',text:'#f6eeea',muted:'#c3b2b8',border:'#453a40'},
 Clean:{primary:'#8a6258',secondary:'#f3eeeb',accent:'#ad8462',background:'#ffffff',surface:'#faf8f6',text:'#3b302d',muted:'#766a65',border:'#e9e1db'},
 Lavender:{primary:'#75618e',secondary:'#ede7f3',accent:'#af82a3',background:'#fbf9fd',surface:'#ffffff',text:'#352d40',muted:'#786c84',border:'#e4dcec'},
};
export type ThemeName=keyof typeof presets;
export function themeFor(preset='Rose',custom?:string|null,dark=false){
 const base=presets[preset as ThemeName]||presets.Rose;
 const palette=dark?{...base,background:'#211d23',surface:'#2d2730',secondary:'#3b303d',text:'#f6edf3',muted:'#c5b5c3',border:'#4b3d4b',primary:'#d5a8bc'}:base;
 const primary=custom&&/^#[0-9a-f]{6}$/i.test(custom)?custom:palette.primary;
 const [r,g,b]=[1,3,5].map(i=>parseInt(primary.slice(i,i+2),16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
 const onPrimary=(r*.2126+g*.7152+b*.0722)>.179?'#211a1e':'#ffffff';
 const darkSurface=dark||preset==='Noir';
 return {...palette,primary,onPrimary,success:darkSurface?'#a7d5bf':'#38735a',warning:darkSurface?'#e1c785':'#8a671e',error:darkSurface?'#f0a0a0':'#a33d47',radius:22,spacing:8,shadow:'0 12px 40px rgba(50,25,35,.06)',fontFamily:'Inter',headingFont:'Georgia',animationStyle:'gentle'};
}
export const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(cents/100);
export const dateLabel=(value:string,zone='America/Sao_Paulo')=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long',timeZone:zone}).format(new Date(value));
export const timeLabel=(value:string,zone='America/Sao_Paulo')=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:zone}).format(new Date(value));
export function dateKey(offset=0,zone='America/Sao_Paulo'){const date=new Date();date.setDate(date.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export const statusLabels:Record<string,string>={CONFIRMED:'Confirmado',CHECKED_IN:'Você chegou',IN_PROGRESS:'Em atendimento',COMPLETED:'Concluído',CANCELLED:'Cancelado',NO_SHOW:'Não compareceu',HOLD:'Reservado por 5 minutos',PENDING_PAYMENT:'Aguardando pagamento',REFUNDED:'Reembolsado'};
export function calendarICS(a:{id:string;service_name:string;professional_name:string;starts_at:string;ends_at:string;address:string}){
 const escape=(v:string)=>v.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const utc=(v:string)=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Maison Bella//Agendamento//PT-BR','BEGIN:VEVENT',`UID:${a.id}@maison-bella`,`DTSTAMP:${utc(new Date().toISOString())}`,`DTSTART:${utc(a.starts_at)}`,`DTEND:${utc(a.ends_at)}`,`SUMMARY:${escape(a.service_name)}`,`DESCRIPTION:${escape('Com '+a.professional_name)}`,`LOCATION:${escape(a.address)}`,'END:VEVENT','END:VCALENDAR'];
 return lines.map(line=>{const chunks:string[]=[];let chunk='',bytes=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(bytes+size>72){chunks.push(chunk);chunk=' ';bytes=1;}chunk+=char;bytes+=size;}chunks.push(chunk);return chunks.join('\r\n');}).join('\r\n');
}
