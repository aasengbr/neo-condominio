/* NEO_Condomínio — app.js (PWA v0) · banco local IndexedDB · captura direta · ponte com a planilha */
(function(){
'use strict';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const pad=n=>String(n).padStart(2,'0');
const nowIso=()=>new Date().toISOString();
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mkId(p){const d=new Date();return p+'-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'-'+Math.random().toString(36).slice(2,5).toUpperCase();}
function fmtDT(iso){if(!iso)return'';const d=new Date(iso),t=new Date();const hm=pad(d.getHours())+':'+pad(d.getMinutes());if(d.toDateString()===t.toDateString())return'hoje '+hm;const y=new Date(t);y.setDate(t.getDate()-1);if(d.toDateString()===y.toDateString())return'ontem '+hm;return pad(d.getDate())+'/'+pad(d.getMonth()+1)+' '+hm;}
function fmtD(iso){if(!iso)return'';const d=new Date(iso);return pad(d.getDate())+'/'+pad(d.getMonth()+1)+' '+pad(d.getHours())+':'+pad(d.getMinutes());}
function brl(v){const n=Number(v);return isNaN(n)?'':n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function toast(m,ms){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),ms||2600);}
function diag(m){const d=$('#diag');d.hidden=!m;d.textContent=m||'';}
window.addEventListener('error',e=>diag('Erro: '+(e.message||e)));
window.addEventListener('unhandledrejection',e=>diag('Erro: '+((e.reason&&e.reason.message)||e.reason)));

/* ---------- banco local ---------- */
const DB_NAME='neo_condominio', DB_VER=1, STORES=['notas','midias','tarefas','agenda','financeiro','cadastros','config'];
let db=null;
function abrirDB(){return new Promise((res,rej)=>{const o=indexedDB.open(DB_NAME,DB_VER);o.onupgradeneeded=e=>{const d=e.target.result;for(const s of STORES)if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'});if(!d.objectStoreNames.contains('compartilhados'))d.createObjectStore('compartilhados',{autoIncrement:true});};o.onsuccess=()=>res(o.result);o.onerror=()=>rej(o.error);});}
const tx=(s,mode,fn)=>new Promise((res,rej)=>{const t=db.transaction(s,mode);const r=fn(t.objectStore(s));t.oncomplete=()=>res(r&&r.result!==undefined?r.result:undefined);t.onerror=()=>rej(t.error);});
const put=(s,o)=>tx(s,'readwrite',st=>st.put(o));
const get=(s,id)=>new Promise((res,rej)=>{const r=db.transaction(s).objectStore(s).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
const all=s=>new Promise((res,rej)=>{const r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});
const del=(s,id)=>tx(s,'readwrite',st=>st.delete(id));
const cfgGet=async k=>{const o=await get('config',k);return o?o.v:undefined;};
const cfgSet=(k,v)=>put('config',{id:k,v});

/* ---------- estado ---------- */
let view='capturar', notas=[], midias=[], tarefas=[], agenda=[], financeiro=[], cadastros={categorias:[],fornecedores:[],moradores:[],centros:[]};
let notaAbertaId=null, notaAbertaEm=0, notaAtual=null, defSel=null, tTab='A fazer';
const CENTROS_PADRAO=['Áreas comuns','Garagem','Elevadores','Fachada e estrutura','Administração','Obra extraordinária'];
let CENTROS=CENTROS_PADRAO.slice();
const CATS={'Manutenção':['Portão','Elevador','Hidráulica','Elétrica','Pintura','Estrutura','Outro'],'Limpeza':['Áreas comuns','Garagem','Caixa d\'água','Outro'],'Segurança':['Portaria','Câmeras','Iluminação','Outro'],'Compras':['Material','Serviço','Outro'],'Administrativo':['Taxa condominial','Documento','Reunião','Morador','Outro'],'Outro':['Outro']};
async function carregar(){[notas,midias,tarefas,agenda,financeiro]=await Promise.all(['notas','midias','tarefas','agenda','financeiro'].map(all));const c=await all('cadastros');cadastros={categorias:c.filter(x=>x.tipo_cad==='categoria'),fornecedores:c.filter(x=>x.tipo_cad==='fornecedor'),moradores:c.filter(x=>x.tipo_cad==='morador'),centros:c.filter(x=>x.tipo_cad==='centro')};}

/* ---------- GPS ---------- */
let gpsCache={v:'',t:0};
function pegarGPS(){return new Promise(res=>{if(!navigator.geolocation)return res('');if(Date.now()-gpsCache.t<60000)return res(gpsCache.v);navigator.geolocation.getCurrentPosition(p=>{gpsCache={v:p.coords.latitude.toFixed(6)+','+p.coords.longitude.toFixed(6),t:Date.now()};res(gpsCache.v);},()=>res(gpsCache.v||''),{enableHighAccuracy:true,timeout:6000,maximumAge:60000});});}
pegarGPS();

/* ---------- sugestão (R5, R6) ---------- */
function sugerir(texto,valor){
  const t=(texto||'').toLowerCase();let rota='Tarefa',cat='Manutenção',sub='Outro';
  if(valor>0||/recibo|nota fiscal|\bnf\b|pag(uei|amento)|compr(a|ei)|r\$/.test(t)){rota='Gasto';cat='Compras';sub='Material';}
  else if(/reuni|assembl|visita|marcad|agend|amanh|semana que vem|\bdia \d/.test(t)){rota='Compromisso';cat='Administrativo';sub='Reunião';}
  if(/port[aã]o/.test(t)){cat='Manutenção';sub='Portão';}else if(/elevador/.test(t)){cat='Manutenção';sub='Elevador';}
  else if(/vazamento|infiltra|hidr|cano|[aá]gua/.test(t)){cat='Manutenção';sub='Hidráulica';}
  else if(/l[âa]mpada|\bluz\b|el[ée]tric|disjuntor/.test(t)&&rota==='Tarefa'){cat='Manutenção';sub='Elétrica';}
  else if(/limpeza|lixo|faxina/.test(t)){cat='Limpeza';sub='Áreas comuns';}
  else if(/c[âa]mera|portaria|seguran/.test(t)){cat='Segurança';sub='Portaria';}
  const prio=/urgente|perigo|sem [aá]gua|sem luz|elevador parado|vazamento grande/.test(t)?'Alta':'Média';
  return{rota,categoria:cat,subcategoria:sub,prioridade:prio};
}
function dataNoTexto(t){const m=/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?:.*?(\d{1,2})[:h](\d{2})?)?/.exec(t||'');if(!m)return'';const y=m[3]?(m[3].length===2?'20'+m[3]:m[3]):new Date().getFullYear();const d=new Date(+y,+m[2]-1,+m[1],m[4]?+m[4]:9,m[5]?+m[5]:0);return isNaN(d)?'':d.toISOString();}

/* ---------- navegação ---------- */
const VIEWS={capturar:['Capturar','Viu, pegou o celular, capturou. O resto é depois.'],notas:['Notas','Tudo o que foi capturado. Toque para completar e definir.'],nota:['Nota','',],tarefas:['Tarefas','O que precisa ser resolvido, com as evidências'],compromissos:['Compromissos','Visitas, reuniões, datas — por dia'],retaguarda:['Planilha','Retaguarda (Agnaldo). Toque longo no título para sair.']};
function setView(v,arg){view=v;$$('nav.bottom button').forEach(b=>b.toggleAttribute('aria-current',false));const nb=$('nav.bottom button[data-view="'+v+'"]');if(nb)nb.setAttribute('aria-current','page');$$('.view').forEach(s=>s.hidden=s.id!=='v-'+v);$('#hdr').classList.toggle('dark',v==='retaguarda');$('#eyebrow').textContent=v==='retaguarda'?'NEO_Condomínio · retaguarda':'NEO_Condomínio · v0';if(v==='nota')abrirNota(arg);render();$('#main').scrollTop=0;}
$$('nav.bottom button').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
// toque longo no título → retaguarda (R12)
(function(){let t=null;const h=$('#hdr');const start=()=>{t=setTimeout(()=>{setView(view==='retaguarda'?'capturar':'retaguarda');navigator.vibrate&&navigator.vibrate(30);},900);};const end=()=>clearTimeout(t);h.addEventListener('touchstart',start,{passive:true});h.addEventListener('touchend',end);h.addEventListener('touchmove',end);h.addEventListener('mousedown',start);h.addEventListener('mouseup',end);h.addEventListener('mouseleave',end);})();

/* ---------- microfone → texto (Web Speech) ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let recAtivo=null;
$$('.mic').forEach(b=>b.addEventListener('click',()=>ditar(b.dataset.mic,b)));
function ditar(campoId,btn){
  const guardar=campoId==='cTexto'; // microfone do Texto da tela 1: dita E guarda o áudio como evidência
  if(recAtivo){recAtivo.stop();return;}
  if(!SR&&!guardar){toast('Transcrição de voz não disponível neste navegador. Use o Chrome.');return;}
  const campo=document.getElementById(campoId);const base=campo.value?campo.value.replace(/\s+$/,'')+' ':'';
  let aud=null;
  const fim=()=>{recAtivo=null;btn.classList.remove('on');if(aud)aud.stop();};
  if(SR){
    const r=new SR();r.lang='pt-BR';r.continuous=true;r.interimResults=true;recAtivo=r;btn.classList.add('on');
    r.onresult=e=>{let fin='',tmp='';for(let i=0;i<e.results.length;i++){const s=e.results[i][0].transcript;if(e.results[i].isFinal)fin+=s+' ';else tmp+=s;}campo.value=(base+fin+tmp).replace(/^\s/,'');campo.dispatchEvent(new Event('input'));};
    r.onend=fim;r.onerror=e=>{fim();if(e.error!=='no-speech'&&e.error!=='aborted')toast('Voz: '+e.error);};
    try{r.start();}catch(err){fim();toast('Não consegui iniciar o microfone.');return;}
  }else{recAtivo={stop:()=>fim()};btn.classList.add('on');}
  if(guardar)iniciarAudio(campo).then(a=>{aud=a;if(!recAtivo&&aud)aud.stop();});
}
// grava o áudio junto com o ditado; se o aparelho não deixar abrir o microfone duas vezes, só dita (sem áudio)
async function iniciarAudio(campo){
  try{
    const st=await navigator.mediaDevices.getUserMedia({audio:true});
    const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported(m))||'';
    const ch=[];const rec=new MediaRecorder(st,mime?{mimeType:mime}:undefined);const ini=Date.now();
    rec.ondataavailable=e=>{if(e.data.size)ch.push(e.data);};
    rec.onstop=async()=>{st.getTracks().forEach(t=>t.stop());if(!ch.length)return;const blob=new Blob(ch,{type:rec.mimeType||mime||'audio/webm'});const dur=Math.round((Date.now()-ini)/1000);if(dur<1)return;
      const n=await notaParaCaptura();const txt=campo.value.trim();n.texto=txt;await put('notas',n);
      await gravarMidia(n,blob,'audio','voz_'+Date.now()+(/mp4/.test(blob.type)?'.m4a':'.webm'),{duracao_s:dur,transcricao:txt});toast('Áudio guardado ✓ ('+dur+' s)');render();};
    rec.start(1000);return rec;
  }catch(e){toast('Áudio não guardado (só texto).');return null;}
}

/* ---------- CAPTURAR ---------- */
async function notaParaCaptura(){
  // R3: até 2 min sem título novo → mesma nota
  const tit=$('#cTitulo').value.trim(), txt=$('#cTexto').value.trim();
  if(notaAbertaId&&Date.now()-notaAbertaEm<120000){const n=await get('notas',notaAbertaId);if(n){if(tit&&n.titulo&&tit!==n.titulo){/* a nota aberta já tem OUTRO título → nota nova */}else{n.texto=txt||n.texto;n.titulo=n.titulo||tit;await put('notas',n);notaAbertaEm=Date.now();return n;}}}
  const n={id:mkId('N'),recebido_em:nowIso(),origem:'App',remetente:'Síndico',tipo:'misto',titulo:tit,texto:txt,midia:'',gps:await pegarGPS(),valor:0,fornecedor:'',rota:'',categoria:'',subcategoria:'',status:'Capturada',destino_id:'',obs:'',exportado_em:''};
  await put('notas',n);notaAbertaId=n.id;notaAbertaEm=Date.now();return n;
}
async function gravarMidia(nota,blob,tipo,nome,extra){
  const m=Object.assign({id:mkId('M'),nota_id:nota.id,tipo,arquivo:nome||(tipo+'_'+Date.now()),mime:blob.type||'',tamanho_kb:Math.round(blob.size/1024),duracao_s:0,transcricao:'',url_drive:'',blob,exportado_em:''},extra||{});
  await put('midias',m);
  nota.midia=(nota.midia?nota.midia+';':'')+m.id;
  const tipos=new Set((nota.midia?nota.midia.split(';'):[]).map(id=>id===m.id?tipo:(midias.find(x=>x.id===id)||{}).tipo).filter(Boolean));
  nota.tipo=tipos.size===1?[...tipos][0]:'misto';
  await put('notas',nota);await carregar();
  banner('Gravado · '+fmtD(nota.recebido_em)+(nota.gps?' · GPS ok':' · sem GPS')+' · '+tipo);
  return m;
}
function banner(t){$('#cBannerTxt').textContent=t;$('#cBanner').hidden=false;}
$('#cNova').addEventListener('click',()=>{notaAbertaId=null;$('#cTitulo').value='';$('#cTexto').value='';$('#cBanner').hidden=true;toast('Pronto para a próxima nota.');});
$('#cSalvarTexto').addEventListener('click',async()=>{if(!$('#cTitulo').value.trim()&&!$('#cTexto').value.trim()){toast('Escreva ou fale algo primeiro.');return;}const n=await notaParaCaptura();if(!n.tipo||n.tipo==='misto'&&!n.midia)n.tipo='texto';await put('notas',n);await carregar();banner('Gravado · '+fmtD(n.recebido_em)+(n.gps?' · GPS ok':' · sem GPS')+' · texto');render();});
// Câmera: visor próprio (getUserMedia); se recusar, seletor do celular
let stream=null,mediaRec=null,recChunks=[],recTimer=null,ovMode='',fotoBlob=null,reciboOn=false,track=null;
async function abrirVisor(modo){
  ovMode=modo;const ov=$('#ov'),vd=$('#ovVideo');fotoBlob=null;$('#ovModoFoto').setAttribute('aria-pressed',String(modo==='foto'));$('#ovModoVid').setAttribute('aria-pressed',String(modo==='video'));
  try{stream=await navigator.mediaDevices.getUserMedia(modo==='foto'?{video:{facingMode:{ideal:'environment'},width:{ideal:1920}},audio:false}:{video:{facingMode:{ideal:'environment'}},audio:true});}
  catch(err){diag('');return false;}
  track=stream.getVideoTracks()[0];vd.srcObject=stream;vd.muted=true;vd.hidden=false;$('#ovPrev').hidden=true;$('#ovBarLive').hidden=false;$('#ovBarPrev').hidden=true;ov.hidden=false;
  $('#ovRec').textContent=modo==='foto'?'Enquadre e toque em Tirar':'Toque em Gravar (até 60 s)';$('#ovShot').textContent=modo==='foto'?'Tirar':'Gravar';
  // lanterna e zoom: só se a câmera oferecer
  const caps=track.getCapabilities?track.getCapabilities():{};
  $('#ovTorch').hidden=!caps.torch;$('#ovTorch').setAttribute('aria-pressed','false');
  const z=$('#ovZoom');if(caps.zoom){z.min=caps.zoom.min||1;z.max=caps.zoom.max||1;z.step=caps.zoom.step||0.1;z.value=(track.getSettings().zoom)||caps.zoom.min||1;$('#ovZoomWrap').hidden=false;}else $('#ovZoomWrap').hidden=true;
  $('#ovRecibo').hidden=modo!=='foto';vd.classList.toggle('recibo',reciboOn&&modo==='foto');$('#ovRecibo').setAttribute('aria-pressed',String(reciboOn));
  return true;
}
function fecharVisor(){if(recTimer){clearInterval(recTimer);recTimer=null;}if(mediaRec&&mediaRec.state!=='inactive'){try{mediaRec.stop();}catch(_){}}mediaRec=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}track=null;$('#ovVideo').srcObject=null;$('#ov').hidden=true;fotoBlob=null;}
$('#ovCancel').addEventListener('click',fecharVisor);
$('#ovTorch').addEventListener('click',async()=>{if(!track)return;const on=$('#ovTorch').getAttribute('aria-pressed')!=='true';try{await track.applyConstraints({advanced:[{torch:on}]});$('#ovTorch').setAttribute('aria-pressed',String(on));}catch(e){toast('Lanterna não disponível nesta câmera.');}});
$('#ovZoom').addEventListener('input',async e=>{if(!track)return;try{await track.applyConstraints({advanced:[{zoom:parseFloat(e.target.value)}]});}catch(_){}});
$('#ovRecibo').addEventListener('click',()=>{reciboOn=!reciboOn;$('#ovRecibo').setAttribute('aria-pressed',String(reciboOn));$('#ovVideo').classList.toggle('recibo',reciboOn);toast(reciboOn?'Modo Recibo: preto e branco, alto contraste.':'Modo normal.');});
function tirarFoto(){const vd=$('#ovVideo');const cv=document.createElement('canvas');cv.width=vd.videoWidth||1280;cv.height=vd.videoHeight||720;const ctx=cv.getContext('2d');if(reciboOn)ctx.filter='grayscale(1) contrast(1.6) brightness(1.1)';ctx.drawImage(vd,0,0);return new Promise(r=>cv.toBlob(r,'image/jpeg',0.88));}
$('#ovShot').addEventListener('click',async()=>{
  if(ovMode==='foto'){fotoBlob=await tirarFoto();const img=$('#ovPrev');img.src=URL.createObjectURL(fotoBlob);$('#ovVideo').hidden=true;img.hidden=false;$('#ovBarLive').hidden=true;$('#ovBarPrev').hidden=false;$('#ovRec').textContent='Ficou boa? OK grava; Repetir tira outra.';return;}
  if(!mediaRec){const mime=['video/mp4','video/webm;codecs=vp9,opus','video/webm'].find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported(m))||'';recChunks=[];mediaRec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);mediaRec.ondataavailable=e=>{if(e.data.size)recChunks.push(e.data);};
    mediaRec.onstop=async()=>{const blob=new Blob(recChunks,{type:mediaRec.mimeType||mime||'video/webm'});const dur=Math.round((Date.now()-ini)/1000);fecharVisor();const n=await notaParaCaptura();await gravarMidia(n,blob,'video','video_'+Date.now()+(/mp4/.test(blob.type)?'.mp4':'.webm'),{duracao_s:dur});toast('Vídeo gravado ✓ ('+dur+' s)');render();};
    const ini=Date.now();mediaRec.start(1000);$('#ovShot').textContent='Parar';let s=0;recTimer=setInterval(()=>{s++;$('#ovRec').textContent='Gravando · '+s+' s';if(s>=60)$('#ovShot').click();},1000);return;}
  mediaRec.stop();
});
$('#ovRetry').addEventListener('click',()=>{const img=$('#ovPrev');if(img.src)URL.revokeObjectURL(img.src);img.hidden=true;$('#ovVideo').hidden=false;$('#ovBarPrev').hidden=true;$('#ovBarLive').hidden=false;$('#ovRec').textContent='Enquadre e toque em Tirar';fotoBlob=null;});
$('#ovOk').addEventListener('click',async()=>{const blob=fotoBlob;if(!blob)return;const img=$('#ovPrev');if(img.src)URL.revokeObjectURL(img.src);fecharVisor();const n=await notaParaCaptura();await gravarMidia(n,blob,'foto','foto_'+Date.now()+'.jpg');toast('Foto gravada ✓'+(n.gps?' · GPS ok':''));render();});
$('#bCam').addEventListener('click',async()=>{if(!(await abrirVisor('foto')))$('#fCamFallback').click();});
$('#bVid').addEventListener('click',async()=>{if(!(await abrirVisor('video')))$('#fVidFallback').click();});
async function trocarModo(m){if(mediaRec||m===ovMode)return;fecharVisor();if(!(await abrirVisor(m)))(m==='foto'?$('#fCamFallback'):$('#fVidFallback')).click();}
$('#ovModoFoto').addEventListener('click',()=>trocarModo('foto'));$('#ovModoVid').addEventListener('click',()=>trocarModo('video'));
// Arquivos e reservas (seletor do celular)
async function arquivos(files,notaFixa){
  if(!files||!files.length)return;let n=notaFixa||await notaParaCaptura();
  for(const f of files){const t=(f.type||'').toLowerCase(),nm=(f.name||'').toLowerCase();const tipo=t.startsWith('image/')?'foto':(t.startsWith('video/')||/\.(mp4|webm|mov|3gp)$/.test(nm))?'video':(t.startsWith('audio/')||/\.(opus|ogg|m4a|aac|mp3|wav)$/.test(nm))?'audio':'foto';
    let blob=f;if(tipo==='foto'&&!/jpeg|png|webp|gif/.test(t)){try{blob=await paraJpeg(f);}catch(_){}}
    await gravarMidia(n,blob,tipo,f.name);}
  render();
}
function paraJpeg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file);const im=new Image();im.onload=()=>{const k=Math.min(1,1600/Math.max(im.width,im.height));const cv=document.createElement('canvas');cv.width=Math.round(im.width*k);cv.height=Math.round(im.height*k);cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);URL.revokeObjectURL(u);cv.toBlob(b=>b?res(b):rej(new Error('conv')),'image/jpeg',0.85);};im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('img'));};im.src=u;});}
$('#fArq').addEventListener('change',e=>{arquivos(Array.from(e.target.files));e.target.value='';});
['fCamFallback','fVidFallback'].forEach(id=>document.getElementById(id).addEventListener('change',e=>{arquivos(Array.from(e.target.files));e.target.value='';}));

/* ---------- NOTAS (lista) ---------- */
function thumbEl(m,small){const d=document.createElement('div');d.className='thumb';if(!m){d.textContent='texto';return d;}
  const url=m.blob?URL.createObjectURL(m.blob):(m.url_drive||'');
  if(m.tipo==='foto'&&url){const i=document.createElement('img');i.alt='foto';i.src=url;d.appendChild(i);}
  else if(m.tipo==='video'&&url){const v=document.createElement('video');v.src=url;v.muted=true;v.playsInline=true;v.preload='metadata';d.appendChild(v);const t=document.createElement('span');t.className='tag';t.textContent='▶ '+(m.duracao_s||'')+'s';d.appendChild(t);}
  else{d.innerHTML=(m.tipo==='audio'?'voz':m.tipo)+'<br>'+(m.duracao_s?m.duracao_s+' s':'');}
  return d;}
function midiasDe(n){return(n.midia?n.midia.split(';'):[]).map(id=>midias.find(m=>m.id===id)).filter(Boolean);}
function classeRota(n){return n.status==='Arquivada'?'arq':n.rota==='Tarefa'?'tar':n.rota==='Compromisso'?'com':n.rota==='Gasto'?'gas':'';}
function estadoNota(n){if(n.status==='Arquivada')return'Guardada';if(n.status==='Capturada')return'A definir';if(n.rota==='Tarefa'){const t=tarefas.find(x=>x.id===n.destino_id);return'Tarefa · '+(t?t.status:'');}if(n.rota==='Compromisso'){const a=agenda.find(x=>x.id===n.destino_id);return'Compromisso · '+(a&&a.inicio?fmtD(a.inicio):'');}if(n.rota==='Gasto'){const f=financeiro.find(x=>x.id===n.destino_id);return'Gasto · '+(f?brl(f.valor):'');}return n.status;}
function renderNotas(){
  const el=$('#notasLista');el.innerHTML='';const aDef=notas.filter(n=>n.status==='Capturada').length;const b=$('#vBadge');b.hidden=false;b.textContent=aDef+' a definir';
  const lista=[...notas].sort((a,b)=>a.recebido_em<b.recebido_em?1:-1);
  if(!lista.length){el.innerHTML='<div class="empty">Nenhuma nota ainda. Vá em Capturar e toque em Câmera, Filmadora, Voz ou Arquivos.</div>';return;}
  let dia='';for(const n of lista){const d=new Date(n.recebido_em);const k=d.toDateString();if(k!==dia){dia=k;const s=document.createElement('div');s.className='section';const t=new Date();s.textContent=k===t.toDateString()?'Hoje':(pad(d.getDate())+'/'+pad(d.getMonth()+1));el.appendChild(s);}
    const ms=midiasDe(n);const c=document.createElement('button');c.type='button';c.className='item '+classeRota(n);const th=thumbEl(ms[0]);if(ms.length>1){const t=document.createElement('span');t.className='tag';t.textContent='+'+(ms.length-1);th.appendChild(t);}c.appendChild(th);
    const col=document.createElement('div');col.className='col';col.innerHTML='<div class="title'+(n.titulo?'':' empty')+'">'+esc(n.titulo||(n.texto?n.texto.slice(0,60):'Sem título'))+'</div><div class="meta">'+esc(fmtDT(n.recebido_em))+(n.gps?' · GPS ok':'')+' · '+ms.length+' evid.'+(n.origem==='WhatsApp'?' · WhatsApp':'')+'</div><div class="state '+classeRota(n)+'">'+esc(estadoNota(n))+'</div>';c.appendChild(col);
    c.addEventListener('click',()=>setView('nota',n.id));el.appendChild(c);}
}

/* ---------- NOTA (detalhe) ---------- */
const DEFS=[['Tarefa','resolver, consertar, chamar'],['Compromisso','visita, reunião, data'],['Gasto','recibo, compra, pagamento'],['Arquivar','só guardar, sem ação']];
async function abrirNota(id){notaAtual=notas.find(n=>n.id===id);if(!notaAtual)return;defSel=notaAtual.rota||null;$('#nTitulo').value=notaAtual.titulo||'';$('#nTexto').value=notaAtual.texto||'';}
function renderNota(){
  const n=notaAtual;if(!n)return;$('#vTitle').textContent='Nota de '+fmtD(n.recebido_em);$('#vSub').textContent=(n.gps?'GPS '+n.gps:'sem GPS')+' · '+(n.origem==='WhatsApp'?'veio do WhatsApp':'capturada no app')+(n.status==='Arquivada'?' · guardada':'');
  const ev=$('#nEvi');ev.innerHTML='';for(const m of midiasDe(n)){const t=thumbEl(m);t.addEventListener('click',()=>abrirMidia(m));ev.appendChild(t);}
  const add=document.createElement('label');add.className='add';add.textContent='+';const inp=document.createElement('input');inp.type='file';inp.accept='image/*,video/*,audio/*';inp.multiple=true;inp.setAttribute('aria-label','Acrescentar evidência');inp.addEventListener('change',async e=>{await arquivos(Array.from(e.target.files),n);notaAtual=notas.find(x=>x.id===n.id);renderNota();});add.appendChild(inp);ev.appendChild(add);
  const sg=sugerir(($('#nTitulo').value+' '+$('#nTexto').value),n.valor);const def=$('#nDef');def.innerHTML='';
  for(const[r,s]of DEFS){const b=document.createElement('button');b.type='button';b.className=(defSel===r?'sel':(!defSel&&sg.rota===r?'sug':''));b.innerHTML='<b>'+r+'</b><span>'+s+'</span>'+(sg.rota===r?'<span class="tsug">sugerido</span>':'');b.addEventListener('click',()=>{defSel=r;renderNota();});def.appendChild(b);}
  const ex=$('#nExtra');ex.innerHTML='';const rotaUI=defSel||sg.rota;
  if(rotaUI==='Gasto'){ex.innerHTML='<div class="grid2"><div class="field"><label for="nValor">Valor (R$)</label><input id="nValor" class="plain" type="number" inputmode="decimal" step="0.01" min="0" value="'+(n.valor||'')+'"></div><div class="field"><label for="nForn">Fornecedor</label><input id="nForn" class="plain" type="text" list="dlForn" value="'+esc(n.fornecedor||'')+'"></div></div>';}
  else if(rotaUI==='Compromisso'){const ini=(agenda.find(a=>a.id===n.destino_id)||{}).inicio||dataNoTexto($('#nTexto').value+' '+$('#nTitulo').value);const loc=ini?new Date(ini):null;const v=loc?loc.getFullYear()+'-'+pad(loc.getMonth()+1)+'-'+pad(loc.getDate())+'T'+pad(loc.getHours())+':'+pad(loc.getMinutes()):'';ex.innerHTML='<div class="field"><label for="nQuando">Quando</label><input id="nQuando" class="plain" type="datetime-local" value="'+v+'"></div>';}
  else if(rotaUI==='Tarefa'){ex.innerHTML='<div class="field"><label for="nForn">Fornecedor (opcional)</label><input id="nForn" class="plain" type="text" list="dlForn" value="'+esc(n.fornecedor||'')+'"></div>';}
  // Detalhar (opcional): Categoria › Subcategoria › Centro de Resultado — pré-preenchido com a sugestão
  const det=document.createElement('details');det.id='nDet';det.open=!!(n.centro_resultado||(n.categoria&&n.categoria!==sg.categoria));
  const cat=n.categoria||sg.categoria, sub=n.subcategoria||sg.subcategoria;
  const opts=(arr,val)=>arr.map(o=>'<option'+(o===val?' selected':'')+'>'+esc(o)+'</option>').join('');
  det.innerHTML='<summary class="section" style="cursor:pointer;list-style:none">▸ Detalhar (opcional): categoria e centro de resultado</summary><div class="field" style="margin-top:8px"><label for="nCat">Categoria</label><select id="nCat" class="plain">'+opts(Object.keys(CATS),cat)+'</select></div><div class="grid2" style="margin-top:8px"><div class="field"><label for="nSub">Subcategoria</label><select id="nSub" class="plain">'+opts(CATS[cat]||['Outro'],sub)+'</select></div><div class="field"><label for="nCen">Centro de resultado</label><select id="nCen" class="plain"><option value="">—</option>'+opts(CENTROS,n.centro_resultado||'')+'</select></div></div>';
  ex.appendChild(det);
  det.querySelector('#nCat').addEventListener('change',e=>{const sb=det.querySelector('#nSub');sb.innerHTML=opts(CATS[e.target.value]||['Outro'],'');});
  $('#nHint').textContent='Sugerido: '+sg.rota+' · '+sg.categoria+' › '+sg.subcategoria+'. Um toque confirma. Detalhar é opcional.';
  $('#nSalvar').textContent=n.status==='Capturada'?'Salvar e definir':'Salvar';$('#nArquivar').hidden=n.status==='Arquivada';
  let sh=$('#nShare');if(!sh){sh=document.createElement('div');sh.id='nShare';sh.className='btns';$('#nHint').after(sh);}sh.innerHTML='';
  sh.appendChild(btnCompartilhar(n.titulo||'Nota',('*NEO_Condomínio — Nota*\n'+(n.titulo||'')+'\n'+(n.texto||'')+'\n'+fmtD(n.recebido_em)+(n.gps?'\nGPS: https://maps.google.com/?q='+n.gps:'')).trim(),midiasDe(n)));
}
function abrirMidia(m){if(!m.blob&&!m.url_drive)return;const url=m.blob?URL.createObjectURL(m.blob):m.url_drive;const ov=document.createElement('div');ov.className='overlay';ov.style.background='#000';let inner;if(m.tipo==='foto'){inner=document.createElement('img');inner.src=url;inner.style.cssText='flex:1;object-fit:contain;width:100%;min-height:0';}else{inner=document.createElement(m.tipo==='video'?'video':'audio');inner.src=url;inner.controls=true;inner.autoplay=true;inner.playsInline=true;inner.style.cssText=m.tipo==='video'?'flex:1;width:100%;min-height:0':'margin:auto;width:90%';}
  const bar=document.createElement('div');bar.className='bar';const b=document.createElement('button');b.type='button';b.textContent='Fechar';b.style.cssText='background:#fff;color:#000';b.addEventListener('click',()=>{ov.remove();if(m.blob)URL.revokeObjectURL(url);});bar.appendChild(b);ov.append(inner,bar);document.body.appendChild(ov);}
$('#nTitulo').addEventListener('input',()=>{if(!defSel)renderNota();});
$('#nTexto').addEventListener('input',()=>{if(!defSel)renderNota();});
$('#nArquivar').addEventListener('click',async()=>{const n=notaAtual;await arquivarDestino(n);n.status='Arquivada';n.rota='Arquivar';n.obs=(n.obs?n.obs+'\n':'')+fmtD(nowIso())+' guardada';await put('notas',n);await carregar();toast('Nota guardada.');setView('notas');});
$('#nSalvar').addEventListener('click',async()=>{
  const n=notaAtual;n.titulo=$('#nTitulo').value.trim();n.texto=$('#nTexto').value.trim();
  const sg=sugerir(n.titulo+' '+n.texto,n.valor);const rota=defSel||sg.rota;const vEl=$('#nValor'),fEl=$('#nForn'),qEl=$('#nQuando');
  if(vEl)n.valor=parseFloat(vEl.value)||0;if(fEl)n.fornecedor=fEl.value.trim();
  const cEl=$('#nCat'),sEl=$('#nSub'),ceEl=$('#nCen');
  if(cEl&&sEl){n.categoria=cEl.value;n.subcategoria=sEl.value;}else if(!n.categoria||n.rota!==rota){n.categoria=sg.categoria;n.subcategoria=sg.subcategoria;}
  if(ceEl)n.centro_resultado=ceEl.value;
  if(n.rota&&n.rota!==rota&&n.destino_id)await arquivarDestino(n); // R4: redefinir arquiva o anterior
  if(rota==='Arquivar'){n.status='Arquivada';n.rota='Arquivar';n.destino_id='';}
  else{
    if(n.rota!==rota||!n.destino_id){
      const titulo=n.titulo||(n.texto||'Nota '+fmtD(n.recebido_em)).slice(0,90);
      if(rota==='Tarefa'){const t={id:mkId('T'),nota_id:n.id,titulo,descricao:n.texto,responsavel:'',fornecedor:n.fornecedor,prioridade:sg.prioridade,status:'A fazer',criada_em:nowIso(),prazo:'',concluida_em:'',evidencias:n.midia,obs:fmtD(nowIso())+' criada',categoria:n.categoria,subcategoria:n.subcategoria,centro_resultado:n.centro_resultado||'',exportado_em:''};await put('tarefas',t);n.destino_id=t.id;}
      else if(rota==='Compromisso'){const ini=qEl&&qEl.value?new Date(qEl.value).toISOString():'';const a={id:mkId('A'),nota_id:n.id,titulo,tipo:n.subcategoria||'Compromisso',inicio:ini,fim:'',local:'',participantes:'',fornecedor:n.fornecedor,status:'Marcado',obs:fmtD(nowIso())+' criado',centro_resultado:n.centro_resultado||'',exportado_em:''};await put('agenda',a);n.destino_id=a.id;}
      else if(rota==='Gasto'){const f={id:mkId('F'),nota_id:n.id,data:n.recebido_em.slice(0,10),tipo:'despesa',descricao:titulo,categoria:n.categoria,subcategoria:n.subcategoria,fornecedor:n.fornecedor,valor:n.valor,forma_pagamento:'',comprovante:n.midia,status:'Lançado',obs:fmtD(nowIso())+' criado',centro_resultado:n.centro_resultado||'',exportado_em:''};await put('financeiro',f);n.destino_id=f.id;}
    }else{ // atualiza o destino existente
      if(rota==='Tarefa'){const t=tarefas.find(x=>x.id===n.destino_id);if(t){t.titulo=n.titulo||t.titulo;t.descricao=n.texto;t.fornecedor=n.fornecedor;t.evidencias=n.midia;t.categoria=n.categoria;t.subcategoria=n.subcategoria;t.centro_resultado=n.centro_resultado||'';t.exportado_em='';await put('tarefas',t);}}
      if(rota==='Compromisso'){const a=agenda.find(x=>x.id===n.destino_id);if(a){a.titulo=n.titulo||a.titulo;if(qEl&&qEl.value)a.inicio=new Date(qEl.value).toISOString();a.centro_resultado=n.centro_resultado||'';a.exportado_em='';await put('agenda',a);}}
      if(rota==='Gasto'){const f=financeiro.find(x=>x.id===n.destino_id);if(f){f.descricao=n.titulo||f.descricao;f.valor=n.valor;f.fornecedor=n.fornecedor;f.comprovante=n.midia;f.categoria=n.categoria;f.subcategoria=n.subcategoria;f.centro_resultado=n.centro_resultado||'';f.exportado_em='';await put('financeiro',f);}}
    }
    n.status='Definida';n.rota=rota;
  }
  n.exportado_em='';await put('notas',n);await carregar();toast(rota==='Arquivar'?'Nota guardada.':'Definida como '+rota+'.');setView(rota==='Tarefa'?'tarefas':rota==='Compromisso'?'compromissos':'notas');
});
async function arquivarDestino(n){if(!n.destino_id)return;const s=n.rota==='Tarefa'?'tarefas':n.rota==='Compromisso'?'agenda':n.rota==='Gasto'?'financeiro':null;if(!s)return;const o=await get(s,n.destino_id);if(o){o.status='Arquivada';o.obs=(o.obs?o.obs+'\n':'')+fmtD(nowIso())+' arquivado (nota redefinida)';o.exportado_em='';await put(s,o);}}

/* ---------- TAREFAS ---------- */
$$('#tTabs button').forEach(b=>b.addEventListener('click',()=>{tTab=b.dataset.st;render();}));
function resumoWhats(t){const l=['*NEO_Condomínio — Ocorrência*',t.titulo,'','Situação: '+(t.status==='A fazer'?'Aberta':t.status)+' · prioridade '+t.prioridade];if(t.categoria)l.push('Tipo: '+t.categoria+(t.subcategoria&&t.subcategoria!=='Outro'?' › '+t.subcategoria:''));if(t.fornecedor)l.push('Fornecedor: '+t.fornecedor);if(t.prazo)l.push('Prazo: '+t.prazo);l.push('Aberta em: '+fmtD(t.criada_em));if(t.status==='Concluída'&&t.concluida_em)l.push('Concluída em: '+fmtD(t.concluida_em));return l.join('\n');}
async function compartilhar(titulo,texto,mids){
  const files=[];for(const m of (mids||[])){if(m&&m.blob){const ext=/jpeg/.test(m.blob.type)?'.jpg':/png/.test(m.blob.type)?'.png':/mp4/.test(m.blob.type)?(m.tipo==='audio'?'.m4a':'.mp4'):/webm/.test(m.blob.type)?'.webm':/ogg/.test(m.blob.type)?'.ogg':'';files.push(new File([m.blob],(m.arquivo||m.id).replace(/\.[a-z0-9]+$/i,'')+ext,{type:m.blob.type}));}}
  const dados={title:titulo,text:texto};if(files.length)dados.files=files;
  if(navigator.share&&(!files.length||(navigator.canShare&&navigator.canShare({files})))){try{await navigator.share(dados);return true;}catch(e){if(e&&e.name==='AbortError')return false;}}
  if(files.length&&navigator.share){try{await navigator.share({title:titulo,text:texto});toast('Este navegador não compartilha arquivos; foi só o texto.');return true;}catch(e){if(e&&e.name==='AbortError')return false;}}
  window.open('https://wa.me/?text='+encodeURIComponent(texto),'_blank');return true;
}
function btnCompartilhar(titulo,texto,mids){const b=document.createElement('button');b.type='button';b.className='btn wa';b.textContent=(mids&&mids.length)?'WhatsApp + mídia':'Enviar no WhatsApp';b.addEventListener('click',()=>compartilhar(titulo,texto,mids));return b;}
function waLink(txt){const a=document.createElement('a');a.className='btn wa';a.href='https://wa.me/?text='+encodeURIComponent(txt);a.target='_blank';a.rel='noopener';a.textContent='Enviar no WhatsApp';return a;}
function renderTarefas(){
  const counts={'A fazer':0,'Em andamento':0,'Concluída':0};tarefas.forEach(t=>{if(counts[t.status]!=null)counts[t.status]++;});
  $$('#tTabs button').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.st===tTab));b.textContent=(b.dataset.st==='Concluída'?'Concluídas':b.dataset.st)+' · '+counts[b.dataset.st];});
  const el=$('#tLista');el.innerHTML='';const lista=tarefas.filter(t=>t.status===tTab).sort((a,b)=>a.criada_em<b.criada_em?1:-1);
  if(!lista.length){el.innerHTML='<div class="empty">Nenhuma tarefa em "'+esc(tTab)+'".</div>';return;}
  for(const t of lista){const n=notas.find(x=>x.id===t.nota_id);const c=document.createElement('div');c.className='card';
    c.innerHTML='<div class="hrow"><span class="chip '+(t.status==='Em andamento'?'and':t.prioridade)+'">'+esc(t.status==='Em andamento'?'Em andamento':t.prioridade)+'</span><span class="meta">'+(t.status==='Concluída'?'concluída '+esc(fmtDT(t.concluida_em)):'aberta '+esc(fmtDT(t.criada_em)))+'</span></div><div class="title">'+esc(t.titulo)+'</div>';
    const ev=document.createElement('div');ev.className='evi';if(n){for(const m of midiasDe(n).slice(0,3)){const th=thumbEl(m);th.style.width='56px';th.style.height='56px';th.addEventListener('click',()=>abrirMidia(m));ev.appendChild(th);}}
    const info=document.createElement('div');info.className='info';info.innerHTML='<span>'+esc(t.categoria||'')+(t.subcategoria?' › '+esc(t.subcategoria):'')+(t.centro_resultado?' · '+esc(t.centro_resultado):'')+'</span><span>Fornecedor: '+esc(t.fornecedor||'a definir')+'</span>'+(n&&n.gps?'<span>GPS registrado</span>':'');ev.appendChild(info);c.appendChild(ev);
    if(t.obs){const o=document.createElement('div');o.className='hint';o.style.whiteSpace='pre-line';o.textContent=t.obs.split('\n').slice(-3).join('\n');c.appendChild(o);}
    const cm=document.createElement('div');cm.className='box';cm.innerHTML='<input type="text" placeholder="Comentário: fale ou digite…" aria-label="Comentário"><button type="button" class="mic" aria-label="Falar comentário"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>';
    const ci=cm.querySelector('input');ci.id='cm-'+t.id;cm.querySelector('.mic').dataset.mic=ci.id;cm.querySelector('.mic').addEventListener('click',e=>ditar(ci.id,e.currentTarget));ci.addEventListener('keydown',async e=>{if(e.key==='Enter'&&ci.value.trim()){t.obs=(t.obs?t.obs+'\n':'')+fmtD(nowIso())+' '+ci.value.trim();t.exportado_em='';await put('tarefas',t);await carregar();render();toast('Comentário gravado.');}});c.appendChild(cm);
    const b=document.createElement('div');b.className='btns';
    const st=t.status==='A fazer'?['Iniciar →','Em andamento','pri']:t.status==='Em andamento'?['Concluir ✓','Concluída','okline']:['Reabrir','Em andamento','sec'];
    const x=document.createElement('button');x.type='button';x.className='btn '+st[2];x.textContent=st[0];x.addEventListener('click',async()=>{t.status=st[1];t.concluida_em=st[1]==='Concluída'?nowIso():'';t.obs=(t.obs?t.obs+'\n':'')+fmtD(nowIso())+' '+st[1];t.exportado_em='';await put('tarefas',t);await carregar();render();toast('Tarefa: '+st[1]);});
    b.append(x,btnCompartilhar(t.titulo,resumoWhats(t),n?midiasDe(n):[]));c.appendChild(b);el.appendChild(c);}
}

/* ---------- COMPROMISSOS ---------- */
const DIAS=['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
function renderAgenda(){
  const el=$('#aLista');el.innerHTML='';const lista=agenda.filter(a=>a.status!=='Arquivada').sort((a,b)=>(a.inicio||'9')<(b.inicio||'9')?-1:1);
  if(!lista.length){el.innerHTML='<div class="empty">Nenhum compromisso. Defina uma nota como Compromisso.</div>';return;}
  const hoje=new Date();hoje.setHours(0,0,0,0);let sec='';
  for(const a of lista){const d=a.inicio?new Date(a.inicio):null;const grupo=!d?'Sem data':d<hoje?'Passados':(d-hoje)<7*864e5?'Esta semana':'Próximos';if(grupo!==sec){sec=grupo;const s=document.createElement('div');s.className='section';s.textContent=grupo;el.appendChild(s);}
    const c=document.createElement('div');c.className='card';c.style.opacity=a.status==='Realizado'?'.7':'1';
    const row=document.createElement('div');row.style.cssText='display:flex;gap:12px';row.innerHTML='<div class="day"><span>'+(d?DIAS[d.getDay()]:'—')+'</span><b>'+(d?pad(d.getDate()):'?')+'</b></div><div class="col"><div class="title">'+esc(a.titulo)+'</div><div class="meta">'+(d?pad(d.getHours())+':'+pad(d.getMinutes())+' · ':'')+esc(a.local||'')+(a.fornecedor?' · '+esc(a.fornecedor):'')+' · '+esc(a.status)+'</div></div>';c.appendChild(row);
    const b=document.createElement('div');b.className='btns';const x=document.createElement('button');x.type='button';x.className='btn '+(a.status==='Realizado'?'sec':'okline');x.textContent=a.status==='Realizado'?'Reabrir':'Realizado ✓';x.addEventListener('click',async()=>{a.status=a.status==='Realizado'?'Marcado':'Realizado';a.obs=(a.obs?a.obs+'\n':'')+fmtD(nowIso())+' '+a.status;a.exportado_em='';await put('agenda',a);await carregar();render();});
    const na=notas.find(x=>x.id===a.nota_id);b.append(x,btnCompartilhar(a.titulo,'*NEO_Condomínio — Compromisso*\n'+a.titulo+'\n'+(d?'Quando: '+fmtD(a.inicio):'Data a confirmar')+(a.local?'\nLocal: '+a.local:'')+(a.fornecedor?'\nFornecedor: '+a.fornecedor:''),na?midiasDe(na):[]));c.appendChild(b);el.appendChild(c);}
}

/* ---------- RETAGUARDA ---------- */
const COL_N=['id','recebido_em','origem','remetente','tipo','titulo','texto','midia','gps','valor','fornecedor','rota','categoria','subcategoria','centro_resultado','status','destino_id','obs'];
const COL_T=['id','nota_id','titulo','descricao','responsavel','fornecedor','prioridade','status','criada_em','prazo','concluida_em','evidencias','obs','categoria','subcategoria','centro_resultado'];
const COL_A=['id','nota_id','titulo','tipo','inicio','fim','local','participantes','fornecedor','status','obs','centro_resultado'];
const COL_F=['id','nota_id','data','tipo','descricao','categoria','subcategoria','fornecedor','valor','forma_pagamento','comprovante','status','obs','centro_resultado'];
const COL_M=['id','nota_id','tipo','arquivo','url_drive','duracao_s','tamanho_kb','transcricao'];
const pick=(o,cols)=>{const r={};cols.forEach(c=>r[c]=o[c]===undefined||o[c]===null?'':o[c]);return r;};
function pend(){return{n:notas.filter(x=>!x.exportado_em),t:tarefas.filter(x=>!x.exportado_em),a:agenda.filter(x=>!x.exportado_em),f:financeiro.filter(x=>!x.exportado_em),m:midias.filter(x=>!x.exportado_em&&x.blob)};}
async function renderRet(){const p=pend();const mb=(p.m.reduce((s,m)=>s+(m.tamanho_kb||0),0)/1024).toFixed(1);$('#rPend').textContent=(p.n.length+p.t.length+p.a.length+p.f.length)?p.n.length+' notas, '+p.t.length+' tarefas, '+p.a.length+' compromissos, '+p.f.length+' gastos não enviados · '+p.m.length+' mídias ('+mb+' MB)':'Tudo enviado.';
  const ult=await cfgGet('ultimo_envio');$('#rEnvStatus').textContent=ult?'Último envio: '+fmtD(ult):'';$('#rCad').innerHTML='<span>Categorias: '+(cadastros.categorias.length||'0 (lista padrão do app)')+'</span><span>Centros de resultado: '+(cadastros.centros.length||'0 (lista padrão do app)')+'</span><span>Fornecedores: '+cadastros.fornecedores.length+'</span><span>Moradores: '+cadastros.moradores.length+'</span>';
  const api=await cfgGet('api_url');$('#rApi').value=api||'';$('#rEnviar').disabled=!api||!(p.n.length+p.t.length+p.a.length+p.f.length);$('#rCadastros').disabled=!api;}
$('#rApiSalvar').addEventListener('click',async()=>{const u=$('#rApi').value.trim();if(u&&!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)){toast('URL deve ser do Apps Script e terminar em /exec.');return;}await cfgSet('api_url',u);toast('URL salva.');renderRet();});
async function api(acao,body){const u=await cfgGet('api_url');if(!u)throw new Error('URL do Apps Script não configurada');const r=body?await fetch(u,{method:'POST',body:JSON.stringify(Object.assign({acao},body)),headers:{'Content-Type':'text/plain;charset=utf-8'},redirect:'follow'}):await fetch(u+'?acao='+acao,{redirect:'follow'});const j=await r.json();if(!j.ok)throw new Error(j.erro||'erro na planilha');return j;}
$('#rApiTestar').addEventListener('click',async()=>{$('#rApiStatus').textContent='Testando…';try{await cfgSet('api_url',$('#rApi').value.trim());const j=await api('');$('#rApiStatus').textContent='Conectado · '+(j.servico||'ok');}catch(e){$('#rApiStatus').textContent='Falhou: '+e.message;}renderRet();});
$('#rCadastros').addEventListener('click',async()=>{try{const j=await api('cadastros');const lote=[];(j.categorias||[]).forEach((c,i)=>lote.push(Object.assign({id:'cat-'+i,tipo_cad:'categoria'},c)));(j.fornecedores||[]).forEach((f,i)=>lote.push(Object.assign({id:'for-'+(f.id||i),tipo_cad:'fornecedor'},f)));(j.moradores||[]).forEach((m,i)=>lote.push(Object.assign({id:'mor-'+(m.unidade||i),tipo_cad:'morador'},m)));(j.centros||[]).forEach((c,i)=>lote.push(Object.assign({id:'cen-'+i,tipo_cad:'centro'},c)));
  for(const c of await all('cadastros'))await del('cadastros',c.id);for(const c of lote)await put('cadastros',c);await carregar();aplicarCadastros();toast(lote.length+' registros de cadastro carregados.');renderRet();}catch(e){toast('Cadastros: '+e.message);}});
function aplicarCadastros(){CENTROS=cadastros.centros.length?cadastros.centros.filter(c=>!/^(n[aã]o|false|0)$/i.test(String(c.ativo))).map(c=>c.nome).filter(Boolean):CENTROS_PADRAO.slice();if(cadastros.categorias.length){for(const k of Object.keys(CATS))delete CATS[k];for(const c of cadastros.categorias){if(/^(n[aã]o|false|0)$/i.test(String(c.ativa)))continue;(CATS[c.categoria||'Outro']=CATS[c.categoria||'Outro']||[]).push(c.subcategoria||'Outro');}if(!Object.keys(CATS).length)CATS['Outro']=['Outro'];}
  let dl=$('#dlForn');if(!dl){dl=document.createElement('datalist');dl.id='dlForn';document.body.appendChild(dl);}dl.innerHTML='';cadastros.fornecedores.forEach(f=>{const o=document.createElement('option');o.value=f.nome||'';dl.appendChild(o);});}
const blobB64=b=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(',')[1]);fr.onerror=()=>rej(fr.error);fr.readAsDataURL(b);});
$('#rEnviar').addEventListener('click',async()=>{
  const btn=$('#rEnviar');btn.disabled=true;const st=$('#rEnvStatus');const p=pend();const ts=nowIso();
  try{
    let i=0;for(const m of p.m){i++;st.textContent='Mídia '+i+' de '+p.m.length+'…';if(m.tamanho_kb>20*1024){m.obs='não enviada: >20 MB';continue;}const j=await api('midia',{nome:m.arquivo,tipo:m.mime||m.blob.type,base64:await blobB64(m.blob)});m.url_drive=j.url;m.exportado_em=ts;await put('midias',m);}
    const mids=await all('midias');const urlDe=id=>{const m=mids.find(x=>x.id===id);return m&&m.url_drive?m.url_drive:id;};
    st.textContent='Mídias (registro)…';await api('midias',{linhas:mids.filter(m=>m.exportado_em===ts||!m.registro_em).map(m=>pick(m,COL_M))});
    st.textContent='Notas…';await api('notas',{linhas:p.n.map(n=>Object.assign(pick(n,COL_N),{midia:(n.midia?n.midia.split(';'):[]).map(urlDe).join(' ; ')}))});
    st.textContent='Tarefas…';await api('tarefas',{linhas:p.t.map(t=>Object.assign(pick(t,COL_T),{evidencias:(t.evidencias?t.evidencias.split(';'):[]).map(urlDe).join(' ; ')}))});
    st.textContent='Compromissos…';await api('agenda',{linhas:p.a.map(a=>pick(a,COL_A))});
    st.textContent='Gastos…';await api('financeiro',{linhas:p.f.map(f=>Object.assign(pick(f,COL_F),{comprovante:(f.comprovante?f.comprovante.split(';'):[]).map(urlDe).join(' ; ')}))});
    for(const x of p.n){x.exportado_em=ts;await put('notas',x);}for(const x of p.t){x.exportado_em=ts;await put('tarefas',x);}for(const x of p.a){x.exportado_em=ts;await put('agenda',x);}for(const x of p.f){x.exportado_em=ts;await put('financeiro',x);}
    for(const m of mids){if(!m.registro_em){m.registro_em=ts;await put('midias',m);}}
    await cfgSet('ultimo_envio',ts);await carregar();toast('Enviado para a planilha.');
  }catch(e){st.textContent='Falhou: '+e.message;toast('Envio falhou: '+e.message);}
  renderRet();
});
// CSV reserva
function csv(rows,cols){const q=v=>{v=v==null?'':String(v);return/[";\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};return'﻿'+[cols.join(';'),...rows.map(r=>cols.map(c=>q(r[c])).join(';'))].join('\r\n');}
function baixar(nome,txt){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv'}));a.download=nome;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
$('#rCsvNotas').addEventListener('click',()=>baixar('NEO_Notas.csv',csv(notas,COL_N)));$('#rCsvTarefas').addEventListener('click',()=>baixar('NEO_Tarefas.csv',csv(tarefas,COL_T)));
// Importar WhatsApp (.txt)
function hash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return(h>>>0).toString(36).toUpperCase();}
function parseWhatsApp(txt){const lines=txt.replace(/‎|‏|‪|‬/g,'').split(/\r?\n/);const re=/^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]?\s*(?:-\s*)?(.*)$/;const out=[];let cur=null;
  for(const ln of lines){const m=ln.match(re);if(m){if(cur)out.push(cur);let[,d,mo,y,h,mi,s,ap,rest]=m;y=y.length===2?'20'+y:y;h=+h;if(ap){const pm=/p/i.test(ap);if(pm&&h<12)h+=12;if(!pm&&h===12)h=0;}const dt=new Date(+y,+mo-1,+d,h,+mi,+(s||0));const sep=rest.indexOf(': ');if(sep<0){cur=null;continue;}cur={dt,remetente:rest.slice(0,sep).trim(),texto:rest.slice(sep+2)};}else if(cur)cur.texto+='\n'+ln;}
  if(cur)out.push(cur);
  return out.map(m=>{let tipo='texto',texto=m.texto.trim();if(/\.(jpe?g|png|webp|heic)\b.*(anexad|omitid)|imagem omitida|<m[ií]dia oculta>|<media omitted>/i.test(texto)){tipo='foto';texto='[foto enviada no WhatsApp — anexar pela galeria] '+texto;}else if(/\.(opus|ogg|m4a|aac|mp3)\b.*(anexad|omitid)|[aá]udio omitido|audio omitted|PTT-/i.test(texto)){tipo='audio';texto='[áudio enviado no WhatsApp — anexar pela galeria] '+texto;}else if(/\.(mp4|3gp|mov)\b.*(anexad|omitid)|v[ií]deo omitido|video omitted|VID-/i.test(texto)){tipo='video';texto='[vídeo enviado no WhatsApp — anexar pela galeria] '+texto;}
    const iso=isNaN(m.dt)?nowIso():m.dt.toISOString();return{id:'W-'+hash(iso+'|'+m.remetente+'|'+m.texto),recebido_em:iso,origem:'WhatsApp',remetente:m.remetente,tipo,titulo:'',texto,midia:'',gps:'',valor:0,fornecedor:'',rota:'',categoria:'',subcategoria:'',status:'Capturada',destino_id:'',obs:'importado do .txt do WhatsApp',exportado_em:''};});}
$('#rTxt').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const msgs=parseWhatsApp(await f.text());const ids=new Set(notas.map(n=>n.id));const novas=msgs.filter(m=>!ids.has(m.id));for(const n of novas)await put('notas',n);await carregar();$('#rImpStatus').textContent=msgs.length+' mensagens · '+(msgs.length-novas.length)+' já existiam · '+novas.length+' novas';toast(novas.length+' notas importadas.');renderRet();});

/* ---------- Compartilhar (Web Share Target) ---------- */
async function processarCompartilhados(){const itens=await new Promise((res,rej)=>{const r=db.transaction('compartilhados').objectStore('compartilhados').getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});if(!itens.length)return;
  for(const it of itens){const n={id:mkId('N'),recebido_em:it.recebido_em||nowIso(),origem:'WhatsApp',remetente:'Síndico',tipo:'texto',titulo:(it.title||'').slice(0,90),texto:[it.text,it.url].filter(Boolean).join('\n'),midia:'',gps:await pegarGPS(),valor:0,fornecedor:'',rota:'',categoria:'',subcategoria:'',status:'Capturada',destino_id:'',obs:'recebido por Compartilhar',exportado_em:''};await put('notas',n);
    for(const f of(it.files||[])){const t=(f.type||'').toLowerCase();const tipo=t.startsWith('image/')?'foto':t.startsWith('video/')?'video':t.startsWith('audio/')?'audio':'foto';await gravarMidia(n,f.blob,tipo,f.name);}}
  await tx('compartilhados','readwrite',st=>st.clear());await carregar();toast(itens.length+' item(ns) recebido(s) do Compartilhar.');setView('notas');}

/* ---------- render ---------- */
function render(){const[t,s]=VIEWS[view];if(view!=='nota'){$('#vTitle').textContent=t;$('#vSub').textContent=s;}$('#vBadge').hidden=view!=='notas';
  if(view==='capturar'){}else if(view==='notas')renderNotas();else if(view==='nota')renderNota();else if(view==='tarefas')renderTarefas();else if(view==='compromissos')renderAgenda();else if(view==='retaguarda')renderRet();}

/* ---------- início ---------- */
(async function(){
  try{db=await abrirDB();await carregar();aplicarCadastros();}catch(e){diag('Banco local indisponível: '+e.message);}
  if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)diag('Câmera/microfone diretos não disponíveis aqui; o app usa o seletor do celular.');
  render();
  if(location.search.includes('share=1')){history.replaceState(null,'','./');await processarCompartilhados();}
})();
})();
