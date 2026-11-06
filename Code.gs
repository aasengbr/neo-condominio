/**
 * NEO_Condominio — backend Apps Script (preso à planilha "NEO_Condominio — Gestao")
 * Implantar como Web App: Executar como EU · Acesso: Qualquer pessoa (ou Qualquer pessoa com o link).
 * O PWA chama:
 *   GET  ?acao=cadastros                     → {categorias, fornecedores, moradores}
 *   GET  ?acao=tarefas                       → lista de Tarefas (para consulta no celular)
 *   POST {acao:'notas', linhas:[...]}        → anexa linhas na aba Notas (sem duplicar por id)
 *   POST {acao:'tarefas', linhas:[...]}      → anexa/atualiza linhas na aba Tarefas (chave id)
 *   POST {acao:'midia', nome, tipo, base64}  → grava arquivo em Drive › NEO_Condominio › Midia, devolve URL
 */
var ABAS = {
  Notas:        ['id','recebido_em','origem','remetente','tipo','titulo','texto','midia','gps','valor','fornecedor','rota','categoria','subcategoria','status','destino_id','obs'],
  Midias:       ['id','nota_id','tipo','arquivo','url_drive','duracao_s','tamanho_kb','transcricao'],
  Tarefas:      ['id','nota_id','titulo','descricao','responsavel','fornecedor','prioridade','status','criada_em','prazo','concluida_em','evidencias','obs'],
  Agenda:       ['id','nota_id','titulo','tipo','inicio','fim','local','participantes','fornecedor','status','obs'],
  Financeiro:   ['id','nota_id','data','tipo','descricao','categoria','subcategoria','fornecedor','valor','forma_pagamento','comprovante','status','obs'],
  Moradores:    ['unidade','andar','nome','telefone','email','perfil','obs'],
  Fornecedores: ['id','nome','servico','telefone_whatsapp','pix','email','categoria','obs'],
  Categorias:   ['categoria','subcategoria','tipo','ativa']
};
var PASTA_MIDIA = 'Midia';

function ss(){ return SpreadsheetApp.getActive(); }
function aba(nome){
  var s=ss().getSheetByName(nome);
  if(!s){ s=ss().insertSheet(nome); s.appendRow(ABAS[nome]); return s; }
  var cols=ABAS[nome], cab=s.getRange(1,1,1,Math.max(1,s.getLastColumn())).getValues()[0];
  cols.forEach(function(c){ if(cab.indexOf(c)<0){ s.getRange(1,s.getLastColumn()+1).setValue(c); cab.push(c); } });
  return s;
}
function json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function lerAba(nome){
  var s=aba(nome), v=s.getDataRange().getValues(); if(v.length<2) return [];
  var cab=v[0]; return v.slice(1).filter(function(r){return r.join('')!=='';}).map(function(r){ var o={}; cab.forEach(function(c,i){ o[c]=r[i]; }); return o; });
}

function doGet(e){
  var acao=(e&&e.parameter&&e.parameter.acao)||'';
  try{
    if(acao==='cadastros') return json({ok:true, categorias:lerAba('Categorias'), fornecedores:lerAba('Fornecedores'), moradores:lerAba('Moradores')});
    if(acao==='tarefas')   return json({ok:true, tarefas:lerAba('Tarefas')});
    if(acao==='notas')     return json({ok:true, notas:lerAba('Notas')});
    return json({ok:true, servico:'NEO_Condominio', acoes:['cadastros','tarefas','notas']});
  }catch(err){ return json({ok:false, erro:String(err)}); }
}

function doPost(e){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var body=JSON.parse(e.postData.contents||'{}'); var acao=body.acao;
    if(acao==='notas')   return json(upsert('Notas', body.linhas||[]));
    if(acao==='tarefas') return json(upsert('Tarefas', body.linhas||[]));
    if(acao==='agenda')  return json(upsert('Agenda', body.linhas||[]));
    if(acao==='financeiro') return json(upsert('Financeiro', body.linhas||[]));
    if(acao==='midias')  return json(upsert('Midias', body.linhas||[]));
    if(acao==='midia')   return json(salvarMidia(body));
    return json({ok:false, erro:'acao desconhecida: '+acao});
  }catch(err){ return json({ok:false, erro:String(err)});
  }finally{ lock.releaseLock(); }
}

/** Insere ou atualiza pela coluna id. Nada é apagado. */
function upsert(nome, linhas){
  var s=aba(nome), v=s.getDataRange().getValues(), cols=v[0];
  var idx={}; for(var i=1;i<v.length;i++){ idx[String(v[i][0])]=i+1; }
  var ins=0, upd=0;
  linhas.forEach(function(o){
    var row=cols.map(function(c){ return o[c]===undefined||o[c]===null?'':o[c]; });
    var r=idx[String(o.id)];
    if(r){ s.getRange(r,1,1,cols.length).setValues([row]); upd++; }
    else { s.appendRow(row); idx[String(o.id)]=s.getLastRow(); ins++; }
  });
  return {ok:true, aba:nome, inseridas:ins, atualizadas:upd};
}

function pastaMidia(){
  var arq=DriveApp.getFileById(ss().getId()); var pais=arq.getParents(); var pai=pais.hasNext()?pais.next():DriveApp.getRootFolder();
  var it=pai.getFoldersByName(PASTA_MIDIA); return it.hasNext()?it.next():pai.createFolder(PASTA_MIDIA);
}
function salvarMidia(b){
  if(!b.base64) return {ok:false, erro:'sem conteúdo'};
  var blob=Utilities.newBlob(Utilities.base64Decode(b.base64), b.tipo||'application/octet-stream', b.nome||('midia_'+Date.now()));
  var f=pastaMidia().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {ok:true, id:f.getId(), url:'https://drive.google.com/file/d/'+f.getId()+'/view'};
}

/** Teste manual no editor: Executar → testeLocal */
function testeLocal(){
  Logger.log(upsert('Notas',[{id:'N-TESTE-1',recebido_em:new Date().toISOString(),origem:'App',remetente:'Teste',tipo:'texto',texto:'nota de teste',status:'Nova'}]));
  Logger.log(JSON.stringify(lerAba('Categorias')));
}
