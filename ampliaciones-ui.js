/* HIDRANDINA_VENTAS — interfaz modular OM5/UIA; solo requiere postGateway() del index vigente. */
(function(){
'use strict';
const MODS={OM5:{titulo:'AMPLIACIONES DE REDES OM5',sol:6,res:2},UIA:{titulo:'AMPLIACIONES UIA',sol:3,res:0}};
const ETAPAS=[['Registro',0,29],['Revisión de expediente',29,36],['Inspección de campo',36,49],['Montaje',49,57],['Gestión de clientes',57,60]];
const STORE={OM5:null,UIA:null},NAV={OM5:{page:0,filter:'',col:'todos',start:'',end:'',selected:''},UIA:{page:0,filter:'',col:'todos',start:'',end:'',selected:''}};
let curso='OM5',registro=null,etapa=0,ocrCandidates=[],ocrCanceled=false,ocrFile=null,recognizer=null;
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const canonical=n=>String(n??'').replace(/\D/g,'').replace(/^0+/,'');
const values=(x)=>String(x??'').split(/[\n\r;,|/]+/).map(s=>canonical(s)).filter(Boolean);
const head=(headers,...aliases)=>headers.find(x=>aliases.some(a=>key(x)===key(a)))||'';
const get=(row,h,...aliases)=>row[head(h,...aliases)]??'';
const field=(h,prefix,n)=>head(h,prefix+n);
const item=(d)=>get(d,STORE[curso]?.headers||[],'Item','Ítem');
const id=(d)=>d.__HD_ID||'';
const adm=()=>['Administrador','Administrador Total','Administrador OM5'].includes((typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : ''));
const asis=()=>(typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : '')==='Asistente OM5';
const oper=()=>(typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : '')==='Operador OM5';
const view=()=>adm()||asis()||oper()||['Visitante OM5','Visitante Total'].includes((typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : ''));
const edit=()=>adm()||asis()||oper();
const update=(txt)=>{let e=$('amplStatus');if(e)e.textContent=txt;};
const api=async(action,data={})=>{let res=await window.postGateway({action,...data},110000);return res;};
function sheet(mod){return STORE[mod]||{headers:[],registros:[],adjuntos:[],catalogos:{}};}
function section(){return $('tab-'+curso.toLowerCase());}
function format(v){if(v===null||v===undefined)return '';if(typeof v==='object')return '';return String(v);}
function fieldsByStage(mod,stage){let hs=sheet(mod).headers;if(mod==='UIA')return hs.filter(h=>!h.startsWith('__'));return hs.slice(ETAPAS[stage][1],ETAPAS[stage][2]).filter(h=>!h.startsWith('__'));}
function rolesReady(){return typeof currentUser !== 'undefined' && !!currentUser && view();}
async function enter(mod){curso=mod;if(!rolesReady()){update('No tienes acceso a este módulo.');return;}if(!STORE[mod])await refresh(mod);else render(mod);}
async function refresh(mod){curso=mod;update('Cargando '+mod+'...');try{STORE[mod]=await api('amplRead',{modulo:mod});render(mod);update(mod+': '+STORE[mod].registros.length+' expedientes disponibles.');}catch(e){update('No se pudo cargar '+mod+': '+e.message);}}
function numDocs(row,mod){let h=sheet(mod).headers,n=MODS[mod].sol;let s=[];for(let i=1;i<=n;i++){let x=field(h,'NroSolicitud',i),f=field(h,'FechaSolicitud',i);if(x&&row[x])s.push(String(row[x])+(f&&row[f]?' · '+format(row[f]):''));}return s.join('\n');}
function numRes(row,mod){let h=sheet(mod).headers,n=MODS[mod].res;let s=[];for(let i=1;i<=n;i++){let x=field(h,'NroResolución',i),f=field(h,'FechaResolucion',i);if(x&&row[x])s.push(String(row[x])+(f&&row[f]?' · '+format(row[f]):''));}return s.join('\n');}
function estadoColor(value){let v=key(value);return !v?'#8c96a6':/terminado|conforme|atendido/.test(v)?'#1e67d2':/proceso/.test(v)?'#e59624':/pendiente|observado/.test(v)?'#d64545':'#8c96a6';}
function filt(row,mod){let n=NAV[mod],h=sheet(mod).headers,q=key(n.filter);if(q){let val=n.col==='todos'?h.map(k=>format(row[k])).join(' '):n.col==='sol'?numDocs(row,mod):n.col==='res'?numRes(row,mod):format(row[head(h,n.col)]);if(!key(val).includes(q))return false;}
 if(n.start||n.end){let dates=h.filter(x=>/^fecha(solicitud|resoluc)/i.test(key(x))).map(k=>format(row[k]).slice(0,10)).filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v));if(!dates.some(d=>(!n.start||d>=n.start)&&(!n.end||d<=n.end)))return false;}
 return true;}
function visible(mod){return sheet(mod).registros.filter(r=>filt(r,mod));}
function render(mod){curso=mod;let n=NAV[mod],list=visible(mod),sub=list.slice(n.page*30,(n.page+1)*30),h=sheet(mod).headers;
 let container=$('amplTableBody');if(!container)return;container.innerHTML=sub.map(row=>{let chosen=n.selected===id(row),label=mod==='OM5'?get(row,h,'Solicitante'):get(row,h,'Nombre');let sector=mod==='OM5'?get(row,h,'NombreSector'):get(row,h,'Direccion');let status=mod==='UIA'?get(row,h,'Estado Actual'):get(row,h,'EstadoExpVentas');return `<tr data-id="${safe(id(row))}" class="${chosen?'hd-ampl-selected':''}"><td><input type="radio" name="amplElegido" ${chosen?'checked':''} aria-label="Seleccionar ítem ${safe(get(row,h,'Item','Ítem'))}" onchange="Ampliaciones.select('${safe(id(row))}')"></td><td>${safe(get(row,h,'Item','Ítem'))}</td><td>${safe(label)}</td><td>${safe(sector)}</td><td class="hd-ampl-multi">${safe(numDocs(row,mod))}</td>${mod==='OM5'?`<td class="hd-ampl-multi">${safe(numRes(row,mod))}</td>`:''}<td><span style="display:inline-block;border-radius:20px;padding:3px 8px;color:#fff;background:${estadoColor(status)}">${safe(status||'Sin estado')}</span></td><td><button onclick="Ampliaciones.open('${safe(id(row))}',0,false)">Consultar</button>${edit()?` <button onclick="Ampliaciones.open('${safe(id(row))}',0,true)">Editar</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="8">No se encontraron expedientes</td></tr>';
 $('amplTableHead').innerHTML=`<tr><th>Elegir</th><th>Ítem</th><th>${mod==='OM5'?'Solicitante':'Nombre'}</th><th>${mod==='OM5'?'Sector':'Dirección'}</th><th>Solicitudes</th>${mod==='OM5'?'<th>Resoluciones</th>':''}<th>Estado</th><th>Acción</th></tr>`;
 $('amplCount').textContent=list.length+' expedientes; página '+(n.page+1)+' de '+Math.max(1,Math.ceil(list.length/30));$('amplPrev').disabled=n.page===0;$('amplNext').disabled=(n.page+1)*30>=list.length;
 let buttons=$('amplStages');buttons.innerHTML=mod==='OM5'?ETAPAS.map((et,i)=>{let selected=sheet(mod).registros.find(r=>id(r)===n.selected),st=[null,'EstadoExpVentas','EstadoInspeccionVentas','EstadoUMD','EstadoCaptacionClientes'][i];let estado=selected&&st?get(selected,h,st):'';return `<button style="background:${i===0?'#1e67d2':estadoColor(estado)}" ${selected?'':'disabled'} onclick="Ampliaciones.open('${safe(n.selected)}',${i},false)">${safe(et[0])}</button>`;}).join(''):'<span class="hd-ampl-muted">UIA no utiliza etapas</span>';
 $('amplNew').hidden=!edit();$('amplDelete').hidden=!edit()||!(adm()||asis());$('amplRestoreBtn').hidden=!adm();$('amplAuditBtn').hidden=!adm();
}
function select(idValue){NAV[curso].selected=idValue;render(curso);}
function page(delta){let n=NAV[curso];n.page=Math.max(0,n.page+delta);render(curso);}
function search(){let n=NAV[curso];n.filter=$('amplSearch').value;n.col=$('amplField').value;n.start=$('amplStart').value;n.end=$('amplEnd').value;n.page=0;render(curso);}
function valuesOptions(c){let catalog=sheet(curso).catalogos||{},map={Modalidad:'A',TipoSuministro:'B',Departamento:'C',Provincia:'D',Distrito:'E',EstadoExpVentas:'F',EstadoInspeccionVentas:'G',EstadoUMD:'H',EstadoCaptacionClientes:'I'};let col=map[Object.keys(map).find(x=>key(x)===key(c))];return col?catalog[col]||[]:[];}
function fieldInput(h,value,editable){let date=/^fecha/i.test(key(h)),text=/observac|obs|memo/i.test(key(h)),opts=valuesOptions(h);if(key(h)==='estadoactual'&&curso==='UIA')opts=['Pendiente','Atendido'];let disabled=editable?'':'disabled';let val=format(value);
 if(opts.length)return `<select data-k="${safe(h)}" ${disabled}><option value="">Seleccionar...</option>${[...new Set([...opts,val].filter(Boolean))].map(v=>`<option ${v===val?'selected':''} value="${safe(v)}">${safe(v)}</option>`).join('')}</select>`;
 if(text)return `<textarea ${disabled} rows="3" data-k="${safe(h)}">${safe(val)}</textarea>`;
 return `<input ${disabled} data-k="${safe(h)}" type="${date?'date':/^clientes|^redes|^postes/i.test(key(h))?'number':'text'}" ${/^clientes|^redes|^postes/i.test(key(h))?'min="0"':''} value="${safe(date?val.slice(0,10):val)}">`;
}
/* REV08: formularios compactos según estructura real de Google Sheets. */
function open(rid,stage=0,editable=false){
 let row=rid?sheet(curso).registros.find(r=>id(r)===rid):null;
 if(rid&&!row){update('Expediente no disponible.');return;}
 if(editable&&!edit()){update('Sin permisos de edición.');return;}
 registro={id:rid||'',version:row?row.__HD_VERSION:0,editable:!!editable,stage,row:row||{},mod:curso};
 const hs=fieldsByStage(curso,stage),all=sheet(curso).headers,ui=$('amplFormBody');
 $('amplFormTitle').textContent=(rid?'Ítem '+get(row,all,'Item','Ítem'):'Nuevo expediente')+' — '+(curso==='OM5'?ETAPAS[stage][0]:'UIA');
 const grouped=new Set();
 // Ocultar solo los campos que se renderizan en filas agrupadas; nunca eliminar sus valores reales.
 if(stage===0||curso==='UIA'){
  for(const prefix of ['NroSolicitud','FechaSolicitud','NroResolución','FechaResolucion'])for(let j=1;j<=6;j++){
   const col=field(all,prefix,j);if(col)grouped.add(col);
  }
 }
 if(curso==='UIA')for(let j=1;j<=5;j++){const col=field(all,'MemorandoGC',j);if(col)grouped.add(col);}
 if(curso==='OM5'&&stage===1)for(let j=1;j<=3;j++)for(const prefix of ['ObsExpediente','MemoObsGC']){const col=field(all,prefix,j);if(col)grouped.add(col);}
 if(curso==='OM5'&&stage===2)for(let j=1;j<=3;j++)for(const prefix of ['ObsInspecciones','MemoObsInspGC']){const col=field(all,prefix,j);if(col)grouped.add(col);}
 const out=[];
 hs.forEach(h=>{
  if(key(h)==='item'||grouped.has(h))return;
  let value=row?row[h]:'';
  if(curso==='UIA'&&!rid&&key(h)==='estadoactual')value='Pendiente';
  out.push(`<label class="hd-ampl-label"><span>${safe(sheet(curso).etiquetas?.[key(h)]||h)}</span>${fieldInput(h,value,editable)}</label>`);
 });
 if(stage===0||curso==='UIA'){
  out.push('<section class="hd-ampl-doc-group"><h4>Solicitudes</h4><div class="hd-ampl-doc-list" id="amplRequests"></div></section>');
  if(curso==='OM5')out.push('<section class="hd-ampl-doc-group"><h4>Resoluciones</h4><div class="hd-ampl-doc-list" id="amplResolutions"></div></section>');
 }
 if(curso==='UIA')out.push('<section class="hd-ampl-doc-group"><h4>Memorandos GC — sin fecha</h4><div class="hd-ampl-doc-list" id="amplMemosGC"></div></section>');
 if(curso==='OM5'&&stage===1)out.push('<section class="hd-ampl-doc-group"><h4>Observaciones de expediente y memorandos GC</h4><div class="hd-ampl-doc-list" id="amplObsExp"></div></section>');
 if(curso==='OM5'&&stage===2)out.push('<section class="hd-ampl-doc-group"><h4>Observaciones de inspección y memorandos GC</h4><div class="hd-ampl-doc-list" id="amplObsInsp"></div></section>');
 ui.innerHTML=out.join('');
 if(stage===0||curso==='UIA'){docs('sol',editable);if(curso==='OM5')docs('res',editable);}
 if(curso==='UIA')docs('memo',editable);
 if(curso==='OM5'&&stage===1)docs('obsExp',editable);
 if(curso==='OM5'&&stage===2)docs('obsInsp',editable);
 if(rid)renderAttachments();else $('amplExistingAttachments').textContent='También podrás añadir archivos después de guardar el expediente.';
 $('amplSave').hidden=!editable;$('amplModal').hidden=false;
}
function docGroup(kind){
 let h=sheet(curso).headers;
 const defs={
  sol:{id:'amplRequests',max:MODS[curso].sol,label:'Solicitud',number:'NroSolicitud',date:'FechaSolicitud'},
  res:{id:'amplResolutions',max:MODS[curso].res,label:'Resolución',number:'NroResolución',date:'FechaResolucion'},
  memo:{id:'amplMemosGC',max:5,label:'Memorando GC',number:'MemorandoGC'},
  obsExp:{id:'amplObsExp',max:3,label:'Observación de expediente',number:'MemoObsGC',note:'ObsExpediente'},
  obsInsp:{id:'amplObsInsp',max:3,label:'Observación de inspección',number:'MemoObsInspGC',note:'ObsInspecciones'}
 };
 let d=defs[kind];if(!d)return null;
 let rows=[];
 for(let i=1;i<=d.max;i++){
  let num=field(h,d.number,i),date=d.date?field(h,d.date,i):'',note=d.note?field(h,d.note,i):'';
  if(!num || (d.date&&!date) || (d.note&&!note))continue;
  rows.push({i,num,date,note,v:format(registro.row[num]),f:date?format(registro.row[date]):'',obs:note?format(registro.row[note]):''});
 }
 return {...d,rows,kind};
}
function compactNumberInput(fieldName,value,editable){return `<input data-k="${safe(fieldName)}" type="text" value="${safe(value)}" ${editable?'':'disabled'} autocomplete="off">`;}
function inlineUpload(fieldName,editable){
 if(!editable)return '<span class="hd-ampl-empty">Adjuntos en sección inferior</span>';
 return `<label class="hd-ampl-inline-attachment"><span>Archivos (opcionales)</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" data-ampl-upload="${safe(fieldName)}" aria-label="Adjuntar archivos a ${safe(fieldName)}"><small>PDF o imágenes, hasta 10 MB por archivo. Se subirán al guardar.</small></label>`;
}
function docs(kind,editable){
 const g=docGroup(kind),container=g?$(g.id):null;if(!g||!container)return;
 const maxShown=Math.max(1,...g.rows.filter(x=>x.v||x.f||x.obs).map(x=>x.i));
 const rows=g.rows.map(r=>{
  const numberLabel=(kind==='obsExp'||kind==='obsInsp')?'N.º de memorando GC':'Número de '+g.label.toLowerCase();
  const noteCell=r.note?`<label class="hd-ampl-doc-cell hd-ampl-note"><span>Observación ${r.i}</span>${fieldInput(r.note,r.obs,editable)}</label>`:'';
  const dateCell=r.date?`<label class="hd-ampl-doc-cell hd-ampl-date"><span>Fecha</span>${fieldInput(r.date,r.f,editable)}</label>`:'';
  const remove=registro.id&&editable&&r.v&&['sol','res'].includes(kind)?`<button type="button" class="hd-ampl-remove" onclick="Ampliaciones.deleteDocField('${safe(r.num)}')">Eliminar documento y adjuntos</button>`:'';
  return `<div class="hd-ampl-doc" data-doc="${safe(kind)}" data-num="${r.i}" ${r.i>maxShown?'hidden':''}>
   <div class="hd-ampl-doc-heading"><strong>${safe(g.label)} ${r.i}</strong>${remove}</div>
   ${noteCell}
   <label class="hd-ampl-doc-cell"><span>${safe(numberLabel)}</span>${compactNumberInput(r.num,r.v,editable)}</label>
   ${dateCell}
   ${inlineUpload(r.num,editable)}
  </div>`;
 }).join('');
 const visibleCount=Math.min(maxShown,g.rows.length);
 container.innerHTML=rows+(editable?`<div class="hd-ampl-doc-footer"><button type="button" class="hd-ampl-add" onclick="Ampliaciones.addDoc('${safe(kind)}')" ${visibleCount>=g.max?'disabled':''}>+ Agregar ${safe(g.label.toLowerCase())}</button><small>Máximo ${g.max}</small></div>`:'');
}
function addDoc(kind){
 let rows=[...document.querySelectorAll('[data-doc="'+kind+'"]')],next=rows.find(e=>e.hidden);
 if(!next){update('Se alcanzó el máximo permitido para este tipo.');return;}
 next.hidden=false;
 const btn=next.parentElement.querySelector('.hd-ampl-add');if(btn)btn.disabled=!rows.some(e=>e.hidden);
 next.querySelector('input[data-k],textarea[data-k]')?.focus();
}
async function deleteDocField(campo){if(!registro?.id||!registro.editable)return;if(!confirm('¿Eliminar '+campo+' y enviar a la papelera TODOS sus adjuntos?'))return;try{let r=await api('amplDeleteDocument',{modulo:curso,expedienteId:registro.id,campo,confirmar:'ELIMINAR_DOCUMENTO'});let rid=registro.id;await refresh(curso);open(rid,registro.stage,true);update('Documento eliminado; '+r.adjuntos+' adjunto(s) enviados a papelera.');}catch(e){update(e.message)}}
function close(){ $('amplModal').hidden=true;registro=null; }
function collect(){let result={};$('amplFormBody').querySelectorAll('[data-k]').forEach(e=>{if(e.closest('[data-doc]')?.hidden)return;result[e.getAttribute('data-k')]=e.value.trim();});return result;}
async function save(){
 if(!registro?.editable)return;
 const payload=collect(),mod=registro.mod;
 // Capturar los archivos ANTES de cerrar el formulario; nombre original intacto.
 const files=[...$('amplFormBody').querySelectorAll('input[data-ampl-upload]')]
  .filter(x=>!x.closest('[data-doc]')?.hidden)
  .flatMap(x=>[...x.files].map(file=>({campo:x.getAttribute('data-ampl-upload'),file})));
 try{
  for(const {file} of files){if(file.size>10*1024*1024)throw Error('Archivo mayor de 10 MB: '+file.name);}
  update('Guardando expediente y validando datos...');
  const r=await api('amplSave',{modulo:mod,expedienteId:registro.id,version:registro.version,datos:JSON.stringify(payload)});
  let failed=[];
  for(let i=0;i<files.length;i++){
   const {campo,file}=files[i];
   update('Expediente guardado. Subiendo archivo '+(i+1)+' de '+files.length+': '+file.name);
   try{await api('amplUpload',{modulo:mod,expedienteId:r.expedienteId,campo,nombre:file.name,base64:await fileToBase64(file)});}
   catch(e){failed.push(file.name+': '+e.message);}
  }
  close();await refresh(mod);NAV[mod].selected=r.expedienteId;render(mod);
  let note='Expediente guardado.'+(r.advertencias?.length?' '+r.advertencias.join(' | '):'');
  if(failed.length){note+=' No se pudieron adjuntar '+failed.length+' archivo(s).';alert('El expediente SE GUARDÓ, pero estos archivos NO se subieron. Vuelve a seleccionarlos en Editar:\n'+failed.join('\n'));}
  else if(files.length)note+=' '+files.length+' archivo(s) adjuntados.';
  update(note);
  if(r.advertencias?.length)alert('Guardado con advertencias:\n'+r.advertencias.join('\n'));
 }catch(e){update('No se pudo guardar: '+e.message);}
}
function renderAttachments(){let box=$('amplExistingAttachments'),a=sheet(curso).adjuntos.filter(x=>x.expedienteId===registro.id);box.innerHTML='<h4>Archivos adjuntos</h4>'+a.map(x=>`<div class="hd-ampl-attach"><span title="${safe(x.nombre)}">${safe(x.nombre)} (${safe(x.campo)})</span><button onclick="Ampliaciones.download('${safe(x.id)}')">Ver/descargar</button>${registro.editable?`<button onclick="Ampliaciones.removeFile('${safe(x.id)}')">Eliminar</button>`:''}</div>`).join('')+(registro.editable?`<label>Vincular nuevo archivo a campo <select id="amplAttachmentField">${sheet(curso).headers.filter(h=>/^nro(solicitud|resoluc)|^memo/i.test(key(h))).map(x=>`<option>${safe(x)}</option>`).join('')}</select></label><input type="file" id="amplUploadInput" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"><button onclick="Ampliaciones.upload()">Subir adjuntos</button>`:'');}
async function upload(){if(!registro?.id)return;let input=$('amplUploadInput'),campo=$('amplAttachmentField').value;if(!input?.files?.length)return;try{for(let file of input.files){if(file.size>10*1024*1024)throw Error('Archivo mayor de 10 MB: '+file.name);let b64=await fileToBase64(file);await api('amplUpload',{modulo:curso,expedienteId:registro.id,campo,nombre:file.name,base64:b64});}await refresh(curso);registro.row=sheet(curso).registros.find(r=>id(r)===registro.id);renderAttachments();update('Archivos subidos correctamente.');}catch(e){update('Error al subir archivo: '+e.message)}}
function fileToBase64(file){return new Promise((resolve,reject)=>{let r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('No se pudo leer archivo'));r.readAsDataURL(file)});}
async function download(aid){try{let parts=[],r;for(let i=0;;i++){r=await api('amplPreview',{adjuntoId:aid,parte:i});let bin=atob(r.base64),ar=new Uint8Array(bin.length);for(let j=0;j<bin.length;j++)ar[j]=bin.charCodeAt(j);parts.push(ar);if(i+1>=r.total)break;}let blob=new Blob(parts,{type:r.mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.nombre;a.target='_blank';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){update('No se pudo recuperar el adjunto: '+e.message)}}
async function removeFile(aid){if(!confirm('¿Enviar este archivo a papelera de Google Drive?'))return;try{await api('amplDeleteAdj',{adjuntoId:aid,confirmar:'SI'});await refresh(curso);renderAttachments()}catch(e){update(e.message)}}
async function removeExp(){let mod=curso,row=sheet(mod).registros.find(r=>id(r)===NAV[mod].selected);if(!row)return update('Selecciona un expediente.');if(!confirm('¿Eliminar expediente Ítem '+get(row,sheet(mod).headers,'Item')+' y enviar sus archivos a papelera?'))return;try{await api('amplDelete',{modulo:mod,expedienteId:id(row),confirmar:'ELIMINAR'});NAV[mod].selected='';await refresh(mod);}catch(e){update(e.message)}}
async function showTrash(){let mod=curso;try{let r=await api('amplTrash',{modulo:mod});let names=r.registros.map(x=>`<div>Ítem ${safe(x.item)} <button onclick="Ampliaciones.restore('${safe(x.id)}')">Restaurar</button></div>`).join('');$('amplExtras').innerHTML='<h3>Papelera '+mod+'</h3>'+names;}catch(e){update(e.message)}}
async function restore(rid){if(!confirm('¿Restaurar expediente y sus adjuntos disponibles?'))return;try{let r=await api('amplRestore',{modulo:curso,expedienteId:rid});await refresh(curso);$('amplExtras').textContent=(r.archivosNoRestaurados||[]).length?'Archivos no recuperados: '+r.archivosNoRestaurados.join(', '):'Expediente restaurado.';}catch(e){update(e.message)}}
async function audit(){try{let r=await api('amplAudit',{modulo:curso});let rows=r.filas.map(x=>`<tr>${x.map(v=>`<td>${safe(v)}</td>`).join('')}</tr>`).join('');$('amplExtras').innerHTML='<h3>Auditoría</h3><div style="overflow:auto;max-height:400px"><table><thead><tr>'+r.headers.map(x=>'<th>'+safe(x)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';}catch(e){update(e.message)}}
let reportChart=null;
function summary(chartType='bar'){
 let mod=curso,rows=visible(mod),hs=sheet(mod).headers;
 let by={};for(let r of rows){let label=mod==='OM5'?get(r,hs,'Modalidad'):'UIA';label=String(label||'Sin modalidad');if(!by[label])by[label]={count:0,clients:0};by[label].count++;
 let value=Number(get(r,hs,'ClientesCaptar','N° Clientes','N Clientes'))||0;if(value>0)by[label].clients+=value;}
 let records=Object.entries(by).sort((a,b)=>a[0].localeCompare(b[0],'es'));
 $('amplExtras').innerHTML=`<h3>Reporte de ampliaciones — ${safe(mod)}</h3><p>Se contabiliza cada expediente una vez, no cada solicitud.</p><label>Título del informe <input id="amplReportTitle" value="Reporte ${safe(mod)}"></label><label>Gráfico <select id="amplChartType" onchange="Ampliaciones.summary(this.value)"><option value="bar" ${chartType==='bar'?'selected':''}>Barras</option><option value="pie" ${chartType==='pie'?'selected':''}>Circular</option></select></label><div style="overflow:auto"><table><thead><tr><th>Ítem</th><th>Modalidad</th><th>N.º de ampliaciones</th><th>Clientes a captar</th></tr></thead><tbody>${records.map(([m,v],i)=>`<tr><td>${i+1}</td><td>${safe(m)}</td><td>${v.count}</td><td>${v.clients}</td></tr>`).join('')}</tbody></table></div><div style="height:320px;max-width:550px"><canvas id="amplSummaryChart"></canvas></div>`;
 if(window.Chart){try{if(reportChart)reportChart.destroy();reportChart=new Chart($('amplSummaryChart'),{type:chartType,data:{labels:records.map(([k])=>k),datasets:[{label:'N.º de ampliaciones',data:records.map(([,v])=>v.count),backgroundColor:['#1557aa','#16988d','#df9924','#8b5bd8','#bc4f69','#45aabc']}]},options:{responsive:true,maintainAspectRatio:false}});}catch(e){update('Gráfico no disponible: '+e.message)}}
}
function excel(){let wb=XLSX.utils.book_new(),mod=curso,data=visible(mod),heads=sheet(mod).headers;let ws=XLSX.utils.json_to_sheet(data.map(r=>Object.fromEntries(heads.map(k=>[k,format(r[k])]))),{header:heads});ws['!cols']=heads.map(k=>({wch:Math.min(44,Math.max(17,k.length+4))}));XLSX.utils.book_append_sheet(wb,ws,mod);XLSX.writeFile(wb,mod+'_Registros_'+new Date().toISOString().slice(0,10)+'.xlsx');}
function share(){let mod=curso,text=mod+' - '+visible(mod).length+' expedientes consultados';let a=document.createElement('a');a.href='https://api.whatsapp.com/send?text='+encodeURIComponent(text);a.target='_blank';a.rel='noopener noreferrer';a.click();}
function localeTexts(){return sheet(curso).headers.filter(h=>!h.startsWith('__'));}
function startUI(){document.querySelectorAll('[data-ampl-tab]').forEach(x=>x.hidden=false);}
function init(){startUI();}
// OCR se ejecuta solo localmente mediante Tesseract.js/Web Worker; las imágenes no se envían a API externa.
async function tesseractReady(){if(window.Tesseract)return window.Tesseract;await new Promise((yes,no)=>{let s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=yes;s.onerror=()=>no(Error('No se cargó OCR local'));document.head.appendChild(s)});return window.Tesseract;}
function ocrMessage(v){$('amplOCRStatus').textContent=v;}
function candidates(text,confidence){let list=[];let numbers=text.match(/(?:\d[\s-]*){9,16}/g)||[];numbers.forEach(n=>{let val=canonical(n);if(val.length>=8)list.push({type:'sol',value:val,uncertain:confidence<75});});
 let lines=text.split(/\n/).map(x=>x.trim()).filter(x=>x.length>3);for(let l of lines){if(/resoluci[oó]n/i.test(l))list.push({type:'res',value:l,uncertain:confidence<80});else if(/solicitante|sector|pueblo|nombre/i.test(l))list.push({type:/sector|pueblo/i.test(l)?'sector':'nombre',value:l.split(':').slice(1).join(':').trim()||l,uncertain:confidence<80});}
 return list;}
async function recognize(){let f=$('amplOCRFile').files?.[0];if(!f)return ocrMessage('Selecciona una imagen o PDF.');if(!navigator.onLine)return ocrMessage('Se necesita conexión a internet.');ocrFile=f;ocrCanceled=false;ocrCandidates=[];let run=$('amplOCRRun');run.disabled=true;try{
 let T=await tesseractReady(),worker=await T.createWorker('spa',1,{logger:m=>{if(m.status==='recognizing text')ocrMessage('Reconociendo texto: '+Math.round((m.progress||0)*100)+'%')}});recognizer=worker;
 if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')){let doc=await pdfjsLib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;for(let n=1;n<=doc.numPages&&!ocrCanceled;n++){let p=await doc.getPage(n),viewport=p.getViewport({scale:1.45});let canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;let out=await worker.recognize(canvas);ocrCandidates.push(...candidates(out.data.text,out.data.confidence||0));canvas.width=canvas.height=0;ocrMessage('Página '+n+' de '+doc.numPages+' — '+Math.round(n/doc.numPages*100)+'%');}}
 else{let out=await worker.recognize(f);ocrCandidates.push(...candidates(out.data.text,out.data.confidence||0));}
 ocrCandidates=[...new Map(ocrCandidates.map(c=>[c.type+'-'+key(c.value),c])).values()];renderCandidates();if(ocrCanceled)ocrMessage('OCR cancelado; se muestran candidatos parciales.');else ocrMessage('Reconocimiento terminado; revisa y selecciona los datos.');}
 catch(e){ocrMessage('OCR no disponible: '+e.message);}finally{if(recognizer){await recognizer.terminate().catch(()=>{});recognizer=null;}ocrFile=null;$('amplOCRFile').value='';run.disabled=false;}}
function ocrCancel(){ocrCanceled=true;ocrMessage('Cancelando reconocimiento...');}
function renderCandidates(){let list=$('amplCandidates');list.innerHTML=ocrCandidates.map((c,i)=>`<div class="hd-ampl-candidate"><label><input type="checkbox" data-ocr="${i}" checked><select data-type="${i}"><option value="sol" ${c.type==='sol'?'selected':''}>Solicitud</option><option value="res" ${c.type==='res'?'selected':''}>Resolución</option><option value="nombre" ${c.type==='nombre'?'selected':''}>Solicitante</option><option value="sector" ${c.type==='sector'?'selected':''}>Pueblo/sector</option></select></label><input data-value="${i}" value="${safe(c.value)}"><small>${c.uncertain?'Revisar reconocimiento':'Dato reconocido'}</small></div>`).join('');}
function selectedCandidates(){return ocrCandidates.map((c,i)=>{let checkbox=document.querySelector(`[data-ocr="${i}"]`);return checkbox?.checked?{type:document.querySelector(`[data-type="${i}"]`).value,value:document.querySelector(`[data-value="${i}"]`).value.trim()}:null;}).filter(c=>c&&c.value);}
function sim(a,b){a=key(a);b=key(b);if(!a||!b)return 0;if(a===b)return 1;if(a.includes(b)||b.includes(a))return .86;let dist=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=dist[0];dist[0]=i;for(let j=1;j<=b.length;j++){let tmp=dist[j];dist[j]=Math.min(dist[j]+1,dist[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=tmp;}}return 1-dist[b.length]/Math.max(a.length,b.length);}
function match(row,mod,c){let h=sheet(mod).headers,vals=[];if(c.type==='sol'){for(let i=1;i<=MODS[mod].sol;i++){let k=field(h,'NroSolicitud',i);if(k)vals.push(...values(row[k]));}return vals.some(v=>v===canonical(c.value))?1:0;}
 if(c.type==='res'){if(mod==='UIA')return 0;for(let i=1;i<=2;i++){let k=field(h,'NroResolución',i);if(k)vals.push(...values(row[k]));}return vals.some(v=>v===canonical(c.value))?1:0;}
 let s=c.type==='sector'?get(row,h,'NombreSector','Direccion'):get(row,h,'Solicitante','Nombre');return sim(s,c.value);}
async function searchOCR(){let candidates=selectedCandidates();if(!candidates.length)return ocrMessage('Selecciona al menos un dato.');try{await Promise.all(['OM5','UIA'].filter(m=>!STORE[m]).map(m=>refresh(m)));let container=$('amplOCRResults');let html='';for(let mod of ['OM5','UIA']){let items=sheet(mod).registros.map(r=>{let matched=candidates.map(c=>({c,score:match(r,mod,c)})).filter(x=>x.score>=.70);return {r,matched,score:Math.max(0,...matched.map(x=>x.score))};}).filter(x=>x.matched.length).sort((a,b)=>b.score-a.score);html+=`<h3>${mod} (${items.length})</h3>`+items.map(x=>`<div class="hd-ampl-result"><b>Ítem ${safe(get(x.r,sheet(mod).headers,'Item','Ítem'))}</b><p>${safe(get(x.r,sheet(mod).headers,'Solicitante','Nombre'))}</p><small>${x.matched.map(z=>safe(z.c.value)+' ('+(z.score===1?'exacta':'aproximada')+')').join(', ')}</small><div><button onclick="Ampliaciones.ocrOpen('${mod}','${safe(id(x.r))}')">Abrir ficha</button><button onclick="Ampliaciones.ocrLocate('${mod}','${safe(id(x.r))}')">Localizar en lista</button></div></div>`).join('');}container.innerHTML=html;ocrMessage('Búsqueda realizada.');}catch(e){ocrMessage('Error: '+e.message)}}
function ocrOpen(mod,rid){curso=mod;let sec=$('tab-'+mod.toLowerCase());window.switchTab(mod.toLowerCase());NAV[mod].selected=rid;open(rid,0,false);}
function ocrLocate(mod,rid){window.switchTab(mod.toLowerCase());curso=mod;NAV[mod].filter='';NAV[mod].page=Math.floor(sheet(mod).registros.findIndex(r=>id(r)===rid)/30);NAV[mod].selected=rid;render(mod);}
window.Ampliaciones={getData:mod=>STORE[mod],enter,refresh,select,page,search,open,close,save,addDoc,deleteDocField,summary,upload,download,removeFile,removeExp,showTrash,restore,audit,excel,share,recognize,ocrCancel,searchOCR,ocrOpen,ocrLocate,reset:()=>{STORE.OM5=null;STORE.UIA=null;ocrCandidates=[];ocrFile=null;ocrCanceled=true;}};
window.amplModuleReady=init;
})();
