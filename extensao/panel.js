import {readXlsx} from './xlsx.js';
import {buildQueue, canSend, stateFor, messagesMatch, draftDiagnostic} from './core.js';
import {whatsappDom} from './whatsapp.js';
const $ = id => document.getElementById(id);
let queue=null, ledger={}, selectedId=null, running=false, paused=false, prepared=null;
const current = () => queue?.rows.find(r=>r.id===selectedId);
const notice = (text,error=false) => { $('notice').textContent=text; $('notice').classList.toggle('error',error); };
const panelVersion='0.2.2';
$('appVersion').textContent='Versão '+panelVersion;
async function showDraftDiagnostic(row,id,fallback={}){
  let reading;
  try{reading=await dom(id,'diagnose',row);}catch(e){reading={...fallback,diagnosticError:e.message};}
  const report={panelVersion,installedVersion:chrome.runtime.getManifest().version,student:row.aluno,...draftDiagnostic(reading.draft,row.message),reading};
  $('draftReport').value=JSON.stringify(report,null,2);
  $('diagnostics').hidden=false;$('diagnostics').scrollIntoView({block:'nearest'});
}
async function reloadLedger(){ledger=(await chrome.storage.local.get('ledger')).ledger||{};}
async function record(row,state,extra={}){
  await reloadLedger();
  ledger[row.id]={...ledger[row.id],student:row.aluno,phone:row.phone,hash:row.hash,state,updatedAt:new Date().toISOString(),...extra};
  await chrome.storage.local.set({ledger});render();
}
/** Atualiza a fila, contadores, prévia e ações de recuperação a partir do estado atual. */
function render(){
  const rows=queue?.rows||[], active=rows.filter(r=>r.selected);
  $('total').textContent=active.length;
  $('sent').textContent=active.filter(r=>['Enviado','Envio acionado'].includes(stateFor(r,ledger))).length;
  $('issues').textContent=active.filter(r=>r.errors.length||stateFor(r,ledger)==='Tentativa incerta'||!!ledger[r.id]?.error).length;
  $('pending').textContent=active.filter(r=>canSend(r,ledger)).length;
  $('rows').replaceChildren();
  const filter=$('search').value.toLocaleLowerCase('pt-BR');
  for(const row of rows.filter(r=>(r.aluno+' '+r.responsavel).toLocaleLowerCase('pt-BR').includes(filter))){
    const status=stateFor(row,ledger),button=document.createElement('button');button.type='button';button.className='person';
    button.classList.toggle('active',row.id===selectedId);button.classList.toggle('sent',['Enviado','Envio acionado'].includes(status));button.classList.toggle('warn',row.errors.length>0||status==='Tentativa incerta'||!!ledger[row.id]?.error);button.classList.toggle('off',!row.selected);
    const name=document.createElement('span');name.className='name';name.textContent=row.aluno;
    const label=document.createElement('span');label.className='status';label.textContent=status+(row.shared?' · telefone compartilhado':'');
    button.append(name,label);button.disabled=running;
    button.onclick=()=>{selectedId=row.id;prepared=null;$('manual').hidden=true;render();};$('rows').append(button);
  }
  const row=current();$('empty').hidden=!!row;$('preview').hidden=!row;
  if(row){
    $('rowState').textContent=stateFor(row,ledger);$('student').textContent=row.aluno;$('recipient').textContent=row.responsavel+' · +'+row.phone;
    $('message').textContent=row.message;
    const notes=[...row.errors];if(row.shared)notes.push('Telefone compartilhado: o nome do aluno identifica esta mensagem.');
    if(ledger[row.id]?.state==='Enviado'&&ledger[row.id]?.deliveryVerified===false)notes.push('Mensagem registrada na conversa. A entrega ao destinatário ainda não foi verificada.');
    if(ledger[row.id]?.state==='Envio acionado')notes.push('O bot clicou em Enviar. A mensagem enviada e a entrega não foram verificadas. Este aluno não será repetido automaticamente.');
    if(ledger[row.id]?.state==='Enviado'&&ledger[row.id]?.hash!==row.hash)notes.push('O conteúdo mudou após o envio registrado. O histórico impede novo envio automático.');
    if(ledger[row.id]?.error)notes.push(ledger[row.id].error);
    $('rowWarnings').textContent=notes.join(' ');
    $('uncertain').hidden=stateFor(row,ledger)!=='Tentativa incerta';
    $('prepare').disabled=running||!canSend(row,ledger);$('sendOne').disabled=running||!canSend(row,ledger);$('diagnose').disabled=running;
    $('manualSend').disabled=running||!$('confirmedPhone').checked;
  }
  $('start').disabled=running||!active.some(r=>canSend(r,ledger));$('pause').disabled=!running;
  for(const id of ['file','whatsappTab','refresh','markSent','release'])$(id).disabled=running;
}
/** Localiza abas do WhatsApp e mantém a seleção anterior quando ainda disponível. */
async function tabs(){
  const selected=$('whatsappTab').value;
  const list=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});
  $('whatsappTab').replaceChildren(new Option('Escolha a aba',''));
  for(const tab of list)$('whatsappTab').add(new Option((tab.title||'WhatsApp Web')+' — aba '+tab.id,String(tab.id)));
  if(list.some(t=>String(t.id)===selected))$('whatsappTab').value=selected;
  else if(list.length===1)$('whatsappTab').value=String(list[0].id);
  if(!list.length)notice('Abra https://web.whatsapp.com no mesmo perfil do Chrome e clique em Atualizar abas.',true);
}
const tabId=()=>{const id=Number($('whatsappTab').value);if(!id)throw new Error('Escolha a aba do WhatsApp Web.');return id;};
/** Injeta o adaptador na aba escolhida e devolve seu resultado; ausência de resposta é tratada como falha. */
async function dom(id,action,row,extra={},documentId=null){
  const target=documentId?{tabId:id,documentIds:[documentId]}:{tabId:id};
  const result=await chrome.scripting.executeScript({target,func:whatsappDom,args:[action,row?{phone:row.phone,message:row.message,...extra}:{}]});
  if(!result[0]?.result)throw new Error('A interface do WhatsApp não respondeu.');
  return {...result[0].result,_documentId:result[0].documentId};
}
function guard(){if(paused)throw new Error('Fila pausada.');}
async function delay(ms,interruptible=true){const end=Date.now()+ms;while(Date.now()<end){if(interruptible)guard();await new Promise(resolve=>setTimeout(resolve,Math.min(250,end-Date.now())));}}
/** Prepara o contato e valida a estabilidade do documento e do rascunho antes de autorizar o clique. */
async function ready(row,id){
  guard();
  const probe=await dom(id,'probe',row);
  if(!probe.connected)throw new Error('Entre no WhatsApp Web e aguarde a lista de conversas carregar.');
  if(probe.draft&&!messagesMatch(probe.draft,row.message)){
    const other=queue?.rows.find(r=>r.id!==row.id&&messagesMatch(probe.draft,r.message));
    await showDraftDiagnostic(row,id,probe);
    throw new Error((other?'O rascunho aberto corresponde a '+other.aluno+'. ':'O texto no WhatsApp difere da prévia de '+row.aluno+'. ')+'Nenhuma mensagem foi enviada. O diagnóstico abaixo mostra o texto lido pelo bot. Copie o relatório e envie para análise.');
  }
  let navigated=false,navigationFrom=probe._documentId,stable=null;
  const navigate=async()=>{
    const guardResult=await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:expected=>{
      const guard=globalThis.__schoolbotNavigationGuard;
      return guard?.version==='0.2.2'?guard.arm(expected):{ok:false,reason:'Após atualizar a extensão, recarregue a aba do WhatsApp uma vez antes de iniciar a fila.'};
    },args:[row.message]});
    if(!guardResult[0]?.result?.ok)throw new Error(guardResult[0]?.result?.reason||'Não foi possível preparar a troca de conversa.');
    try{
      guard();
      await chrome.tabs.update(id,{url:'https://web.whatsapp.com/send?phone='+encodeURIComponent(row.phone)+'&text='+encodeURIComponent(row.message),active:true});
    }catch(e){
      await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:()=>globalThis.__schoolbotNavigationGuard?.cancel()}).catch(()=>{});
      throw e;
    }
    navigated=true;stable=null;
  };
  if(!probe.draftMatches||(probe.routePhone!==null&&probe.routePhone!==row.phone))await navigate();
  const end=Date.now()+90000;let last='Aguardando a conversa.',opened=false,unknownSince=0;
  while(Date.now()<end){
    guard();await delay(700);
    let result;
    try{result=await dom(id,'inspect',row);}catch(e){last='Aguardando o carregamento da aba.';continue;}
    if(navigated&&navigationFrom&&result._documentId===navigationFrom){last='Aguardando a nova conversa carregar.';continue;}
    if(result.fatal)throw new Error(result.reason);
    if(result.ready){
      if(result.verified){prepared={id:row.id,tab:id,verified:true,at:Date.now()};return true;}
      // When contact details hide the number, use only a fresh document opened
      // by this run's exact phone link, with stable chat and matching draft.
      if(!navigated&&navigationFrom){await navigate();continue;}
      if(navigated&&navigationFrom&&result._documentId&&result._documentId!==navigationFrom&&result.header){
        const key=result._documentId+'|'+result.signature;
        if(stable===key){
          const bound=await dom(id,'autoBind',row,{navigationAuthorized:true,expectedSignature:result.signature},result._documentId);
          if(!bound.ok)throw new Error(bound.reason);
          prepared={id:row.id,tab:id,verified:true,at:Date.now()};return true;
        }
        stable=key;continue;
      }
      if(!opened){await dom(id,'openDetails',row);opened=true;unknownSince=Date.now();}
      else if(Date.now()-unknownSince>3500){
        prepared={id:row.id,tab:id,verified:false,at:Date.now()};$('manual').hidden=false;$('confirmedPhone').checked=false;$('expectedPhone').textContent='+'+row.phone;
        notice('Conversa preparada. Confira o número nos dados do contato e marque “Conferi o número completo do destinatário” abaixo da prévia para liberar este envio.',true);
        $('manual').scrollIntoView({block:'nearest'});return false;
      }
    }
    last=result.reason||'Conferindo o número do destinatário.';
  }
  throw new Error(last+' Não houve envio. Se aparecer erro de número ou a tela mudar, confira o WhatsApp.');
}
/** Registra a tentativa, aciona o envio e aguarda o editor vazio. Em falhas incertas mantém o bloqueio contra repetição. */
async function sendPrepared(row,id,manual=false){
  guard();await reloadLedger();if(!canSend(row,ledger))throw new Error('Este aluno não está disponível para novo envio.');
  if(manual){const bind=await dom(id,'manualBind',row);if(!bind.ok)throw new Error(bind.reason);}
  // Persist BEFORE the click: a closed panel, timeout or lost result never leads to a blind retry.
  await record(row,'Tentativa incerta',{error:'Executando o clique de envio.',attemptAt:new Date().toISOString()});
  if(paused){await record(row,'Pendente',{error:''});guard();}
  guard();
  let sent;
  try{sent=await dom(id,'send',row);}catch(e){notice('A tentativa ficou sem confirmação. Confira a conversa antes de liberar outro envio.',true);return false;}
  if(!sent.clicked){await record(row,'Pendente',{error:sent.reason||'Nenhum clique de envio executado.'});throw new Error(sent.reason||'Envio interrompido.');}
  await record(row,'Envio acionado',{error:'',clickedAt:new Date().toISOString(),verification:'Clique no botão Enviar; sem verificação posterior da mensagem',deliveryVerified:false});
  prepared=null;$('manual').hidden=true;
  const end=Date.now()+10000;let reason='O campo de mensagem não foi liberado após o clique.';
  while(Date.now()<end){
    // Do not inspect message bubbles, IDs or ticks. Wait only for the editor
    // to clear so that navigating to the next contact cannot discard a draft.
    await delay(200,false);
    try{
      const result=await dom(id,'settled',row);
      if(result.settled)return true;
      reason=result.reason||reason;if(result.fatal)break;
    }catch(e){reason='Aba fechada ou recarregada depois do clique.';break;}
  }
  await record(row,'Envio acionado',{error:reason});notice('Fila pausada: '+reason+' O clique já foi registrado e não será repetido.',true);return false;
}
/** Executa trabalho sob um bloqueio compartilhado entre painéis e restaura os controles mesmo se ocorrer erro. */
async function exclusive(work){
  if(running)return;
  await navigator.locks.request('schoolbot-rematriculas-sender',{ifAvailable:true},async lock=>{
    if(!lock){notice('Outro painel está executando a fila. Use somente um painel.',true);return;}
    running=true;paused=false;render();
    try{await work();}catch(e){notice(e.message||String(e),true);}finally{running=false;render();}
  });
}
$('file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  await exclusive(async()=>{
    const imported=await buildQueue(await readXlsx(await file.arrayBuffer()));
    queue={...imported,fileName:file.name};prepared=null;$('manual').hidden=true;
    selectedId=queue.rows.find(r=>r.selected)?.id||queue.rows[0]?.id;
    await chrome.storage.local.set({queue});await reloadLedger();
    notice(queue.rows.length+' alunos importados; '+queue.rows.filter(r=>r.selected).length+' marcados como Sim. Nenhuma mensagem foi enviada.');
  });event.target.value='';
};
$('search').oninput=render;
$('diagnose').onclick=()=>exclusive(async()=>{
  const row=current();if(!row)return;
  await showDraftDiagnostic(row,tabId());
  notice('Diagnóstico coletado. O rascunho foi apenas lido; nenhuma mensagem foi enviada. Copie o relatório abaixo e envie para análise.');
});
$('refresh').onclick=()=>tabs().catch(e=>notice(e.message,true));
$('whatsappTab').onchange=()=>{prepared=null;$('manual').hidden=true;};
$('prepare').onclick=()=>exclusive(async()=>{
  const row=current();await reloadLedger();if(!row||!canSend(row,ledger))return;
  notice('Preparando a conversa de '+row.aluno+' sem enviar...');
  if(await ready(row,tabId()))notice('Destinatário conferido e rascunho preparado. Nenhuma mensagem foi enviada.');
});
$('sendOne').onclick=()=>exclusive(async()=>{
  const row=current(),id=tabId();await reloadLedger();if(!row||!canSend(row,ledger))return;
  if(prepared?.id===row.id&&prepared.tab===id&&!prepared.verified){
    if(!$('confirmedPhone').checked){
      notice('Falta conferir o telefone. Compare o número nos dados do contato e marque a confirmação abaixo da prévia. O rascunho será mantido.',true);
      $('manual').hidden=false;$('manual').scrollIntoView({block:'nearest'});return;
    }
    if(await sendPrepared(row,id,true))notice('Envio acionado para '+row.aluno+'.');
    return;
  }
  if(!prepared||prepared.id!==row.id||prepared.tab!==id||!prepared.verified||Date.now()-prepared.at>120000)if(!await ready(row,id))return;
  if(await sendPrepared(row,id))notice('Envio acionado para '+row.aluno+'.');
});
$('start').onclick=()=>exclusive(async()=>{
  const id=tabId();
  prepared=null;$('manual').hidden=true;
  for(const row of queue.rows){
    guard();await reloadLedger();if(!canSend(row,ledger))continue;
    selectedId=row.id;render();notice('Preparando: '+row.aluno);
    if(!await ready(row,id))return;
    if(!await sendPrepared(row,id))return;
    notice('Envio acionado: '+row.aluno+'. Preparando o próximo item.');
  }
  notice('Fila concluída. Confira o histórico e eventuais registros que precisam de revisão.');
});
$('pause').onclick=()=>{paused=true;notice('Pausa solicitada. Uma tentativa já iniciada ainda será conferida; o próximo envio não começará.');};
$('confirmedPhone').onchange=render;
$('manualSend').onclick=()=>exclusive(async()=>{
  const row=current(),p=prepared;
  if(!$('confirmedPhone').checked||!p||p.id!==row?.id)throw new Error('Prepare a conversa e confira o número.');
  if(await sendPrepared(row,p.tab,true))notice('Envio acionado. Clique em retomar para continuar a fila.');
});
$('markSent').onclick=()=>exclusive(async()=>{
  const row=current();if(!row||stateFor(row,ledger)!=='Tentativa incerta')return;
  if(!confirm('Você conferiu no WhatsApp que a mensagem de '+row.aluno+' foi enviada?'))return;
  await record(row,'Enviado',{error:'',verification:'Conferência manual',sentAt:new Date().toISOString()});notice('Envio registrado após sua conferência.');
});
$('release').onclick=()=>exclusive(async()=>{
  const row=current();if(!row||stateFor(row,ledger)!=='Tentativa incerta')return;
  if(!confirm('Confirma que conferiu a conversa e esta mensagem NÃO foi enviada? Liberar sem conferir pode duplicar o envio.'))return;
  await record(row,'Pendente',{error:'',manualReleaseAt:new Date().toISOString()});notice('Nova tentativa liberada após sua conferência.');
});
$('export').onclick=async()=>{
  await reloadLedger();const blob=new Blob([JSON.stringify({campaign:'rematriculas-2027',exportedAt:new Date().toISOString(),history:Object.values(ledger)},null,2)],{type:'application/json'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='Historico_Rematriculas_2027.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.ledger){ledger=changes.ledger.newValue||{};render();}});
try{
  const stored=await chrome.storage.local.get(['queue','ledger']);queue=stored.queue||null;ledger=stored.ledger||{};
  selectedId=queue?.rows.find(r=>canSend(r,ledger))?.id||queue?.rows[0]?.id;
  render();await tabs();if(queue)notice('Lista recuperada. '+queue.rows.filter(r=>r.selected).length+' alunos selecionados. O histórico foi mantido.');
}catch(e){notice('Não foi possível iniciar: '+e.message,true);}
