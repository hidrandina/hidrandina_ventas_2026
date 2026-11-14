/* HIDRANDINA_VENTAS REV16 OCR Y PREVIEW — Guardar + validaciones claras + catálogo UUEE. Backend sin cambios. */
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
const update=(txt,type='info')=>{let e=$('amplStatus');if(e)e.textContent=txt;let m=$('amplFormStatus');if(m&&!$('amplModal')?.hidden){m.textContent=txt;m.dataset.type=type;m.hidden=!txt;}};
let saving=false;
function formAlert(message,type='error',fieldName=''){
 const t=String(message||'No se pudo completar la operación.');update(t,type);
 const e=$('amplFormStatus');if(e){e.hidden=false;e.scrollIntoView({block:'nearest',behavior:'smooth'});}
 const target=fieldName?[...$('amplFormBody').querySelectorAll('[data-k]')].find(el=>key(el.getAttribute('data-k'))===key(fieldName)):null;
 if(target){target.classList.add('hd-ampl-invalid');target.setAttribute('aria-invalid','true');target.focus({preventScroll:true});}
}
function validateBeforeSave(payload,mod,isNew){
 // Las reglas existentes de edición histórica se conservan. Solo exigir
 // datos base en expedientes nuevos; las solicitudes nuevas siempre llevan fecha.
 const hs=sheet(mod).headers;
 const lookup=(name)=>Object.keys(payload).find(h=>key(h)===key(name));
 if(isNew){
  const required=mod==='OM5'?['Solicitante','NombreSector','Departamento','Provincia','Distrito','UUEE','ClientesCaptar']:['Nombre','Direccion','Departamento','Provincia','Distrito'];
  for(const label of required){
   const actual=head(hs,label),k=lookup(label);
   if(actual && (!k||!String(payload[k]??'').trim()))return {message:'Falta un campo obligatorio: '+(sheet(mod).etiquetas?.[key(actual)]||label)+'.',field:actual};
  }
 }
 let documents=0;
 const specs=mod==='OM5'?[['NroSolicitud','FechaSolicitud',6,'Solicitud'],['NroResolución','FechaResolucion',2,'Resolución']]:[['NroSolicitud','FechaSolicitud',3,'Solicitud']];
 for(const [numberPrefix,datePrefix,max,label] of specs){
  for(let i=1;i<=max;i++){
   const numberField=field(hs,numberPrefix,i),dateField=field(hs,datePrefix,i);
   if(!numberField)continue;
   const n=lookup(numberField),d=dateField?lookup(dateField):null;
   const number=n?String(payload[n]??'').trim():'';
   const date=d?String(payload[d]??'').trim():'';
   if(number){documents++;
    // No bloquear la edición de una fila histórica incompleta y no modificada.
    const previous=registro?.row||{};
    const unchanged=!isNew && String(previous[numberField]??'').trim()===number;
    if(dateField&&!date&&!unchanged)return {message:'Falta la fecha de '+label.toLowerCase()+' '+i+'.',field:dateField};
   } else if(date){return {message:'Falta el número de '+label.toLowerCase()+' '+i+' para la fecha ingresada.',field:numberField};}
  }
 }
 if(isNew&&!documents)return {message:'Debes ingresar al menos una solicitud'+(mod==='OM5'?' o una resolución':'')+' con su fecha.',field:field(hs,'NroSolicitud',1)};
 return null;
}
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
 $('amplNew').hidden=!edit();$('amplDelete').hidden=!edit()||!(adm()||asis());
}
function select(idValue){NAV[curso].selected=idValue;render(curso);}
function page(delta){let n=NAV[curso];n.page=Math.max(0,n.page+delta);render(curso);}
function search(){let n=NAV[curso];n.filter=$('amplSearch').value;n.col=$('amplField').value;n.start=$('amplStart').value;n.end=$('amplEnd').value;n.page=0;render(curso);}
function valuesOptions(c){let catalog=sheet(curso).catalogos||{},map={Modalidad:'A',TipoSuministro:'B',Departamento:'C',Provincia:'D',Distrito:'E',EstadoExpVentas:'F',EstadoInspeccionVentas:'G',EstadoUMD:'H',EstadoCaptacionClientes:'I',UUEE:'J'};let col=map[Object.keys(map).find(x=>key(x)===key(c))];return col?catalog[col]||[]:[];}
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
 $('amplFormTitle').textContent=(rid?'Ítem '+get(row,all,'Item','Ítem'):'Nuevo expediente')+' — '+(curso==='OM5'?ETAPAS[stage][0]:'UIA')+' · Rev. 12';
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
 $('amplSave').hidden=!editable;$('amplModal').hidden=false;const note=$('amplFormStatus');if(note){note.textContent='';note.hidden=true;note.dataset.type='info';}if($('amplSave')){$('amplSave').disabled=false;$('amplSave').textContent='Guardar';}
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
 return `<label class="hd-ampl-inline-attachment"><span>Archivos (opcionales)</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" data-ampl-upload="${safe(fieldName)}" aria-label="Adjuntar archivos a ${safe(fieldName)}"><small>PDF o imágenes, hasta 10 MB por archivo. Se subirán al guardar.</small><span class="hd-ampl-local-actions" data-preview-files></span></label>`;
}
function docs(kind,editable){
 const g=docGroup(kind),container=g?$(g.id):null;if(!g||!container)return;
 if(!g.rows.length){container.innerHTML='<p class="hd-ampl-schema-warning">La estructura de columnas recibida no contiene los campos esperados para '+safe(g.label)+'. No se ha cambiado ni borrado información. Comprueba que la aplicación lea la base correcta.</p>';return;}
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
function close(){if(saving){formAlert('El guardado todavía está en curso. No cierres el formulario.','info');return;}$('amplModal').hidden=true;registro=null;}
function collect(){let result={};$('amplFormBody').querySelectorAll('[data-k]').forEach(e=>{if(e.closest('[data-doc]')?.hidden)return;result[e.getAttribute('data-k')]=e.value.trim();});return result;}
async function save(){
 if(saving)return;
 if(!registro?.editable){formAlert('No hay un expediente editable abierto.');return;}
 const button=$('amplSave');
 let savedOnServer=false;
 try{
  $('amplFormBody').querySelectorAll('.hd-ampl-invalid').forEach(el=>{el.classList.remove('hd-ampl-invalid');el.removeAttribute('aria-invalid');});
  const payload=collect(),mod=registro.mod,isNew=!registro.id;
  const validation=validateBeforeSave(payload,mod,isNew);
  if(validation){formAlert(validation.message,'error',validation.field);return;}
  const files=[...$('amplFormBody').querySelectorAll('input[data-ampl-upload]')]
   .filter(x=>!x.closest('[data-doc]')?.hidden)
   .flatMap(x=>[...x.files].map(file=>({campo:x.getAttribute('data-ampl-upload'),file})));
  for(const {file} of files)if(file.size>10*1024*1024)throw Error('Archivo mayor de 10 MB: '+file.name);
  saving=true;if(button){button.disabled=true;button.textContent='Guardando…';}
  update('Guardando expediente. No cierres esta ventana.');
  const r=await api('amplSave',{modulo:mod,expedienteId:registro.id,version:registro.version,datos:JSON.stringify(payload)});
  if(!r||!r.expedienteId)throw Error('El servidor no confirmó el ID del expediente. Antes de reintentar, consulta la lista para evitar duplicados.');
  savedOnServer=true;
  const failed=[];
  for(let i=0;i<files.length;i++){
   const {campo,file}=files[i];update('Expediente guardado. Subiendo archivo '+(i+1)+' de '+files.length+': '+file.name);
   try{await api('amplUpload',{modulo:mod,expedienteId:r.expedienteId,campo,nombre:file.name,base64:await fileToBase64(file)});}
   catch(e){failed.push(file.name+': '+e.message);}
  }
  // No perder el aviso de guardado si fallara la recarga de la lista.
  const note='Expediente guardado correctamente.'+(r.advertencias?.length?' '+r.advertencias.join(' | '):'');
  $('amplModal').hidden=true;registro=null;update(note);
  try{await refresh(mod);NAV[mod].selected=r.expedienteId;render(mod);update(note+(failed.length?' Algunos archivos no se subieron.':files.length?' '+files.length+' archivo(s) adjuntados.':''));}
  catch(e){update(note+' No se pudo actualizar la lista automáticamente: '+e.message);}
  if(failed.length)alert('Expediente guardado, pero estos archivos NO se subieron. Usa Editar para volver a adjuntarlos:\n'+failed.join('\n'));
  if(r.advertencias?.length)alert('Guardado con advertencias:\n'+r.advertencias.join('\n'));
 }catch(e){
  const msg=(e&&e.message)||String(e);
  formAlert((savedOnServer?'El expediente pudo guardarse; verifica la lista antes de reintentar. ':'No se pudo guardar. ')+msg);
 }finally{saving=false;if(button){button.disabled=false;button.textContent='Guardar';}}
}
function renderAttachments(){let box=$('amplExistingAttachments'),a=sheet(curso).adjuntos.filter(x=>x.expedienteId===registro.id);box.innerHTML='<h4>Archivos adjuntos</h4>'+a.map(x=>`<div class="hd-ampl-attach"><span title="${safe(x.nombre)}">${safe(x.nombre)} (${safe(x.campo)})</span><button type="button" onclick="Ampliaciones.previewSaved('${safe(x.id)}')">Vista previa</button><button type="button" onclick="Ampliaciones.download('${safe(x.id)}')">Descargar</button>${registro.editable?`<button onclick="Ampliaciones.removeFile('${safe(x.id)}')">Eliminar</button>`:''}</div>`).join('')+(registro.editable?`<label>Vincular nuevo archivo a campo <select id="amplAttachmentField">${sheet(curso).headers.filter(h=>/^nro(solicitud|resoluc)|^memo/i.test(key(h))).map(x=>`<option>${safe(x)}</option>`).join('')}</select></label><input type="file" id="amplUploadInput" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"><div id="amplExtraPreviews" class="hd-ampl-local-actions"></div><button onclick="Ampliaciones.upload()">Subir adjuntos</button>`:'');}
async function upload(){if(!registro?.id)return;let input=$('amplUploadInput'),campo=$('amplAttachmentField').value;if(!input?.files?.length)return;try{for(let file of input.files){if(file.size>10*1024*1024)throw Error('Archivo mayor de 10 MB: '+file.name);let b64=await fileToBase64(file);await api('amplUpload',{modulo:curso,expedienteId:registro.id,campo,nombre:file.name,base64:b64});}await refresh(curso);registro.row=sheet(curso).registros.find(r=>id(r)===registro.id);renderAttachments();update('Archivos subidos correctamente.');}catch(e){update('Error al subir archivo: '+e.message)}}
function fileToBase64(file){return new Promise((resolve,reject)=>{let r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('No se pudo leer archivo'));r.readAsDataURL(file)});}
async function download(aid){try{let parts=[],r;for(let i=0;;i++){r=await api('amplPreview',{adjuntoId:aid,parte:i});let bin=atob(r.base64),ar=new Uint8Array(bin.length);for(let j=0;j<bin.length;j++)ar[j]=bin.charCodeAt(j);parts.push(ar);if(i+1>=r.total)break;}let blob=new Blob(parts,{type:r.mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.nombre;a.target='_blank';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){update('No se pudo recuperar el adjunto: '+e.message)}}
async function removeFile(aid){if(!confirm('¿Enviar este archivo a papelera de Google Drive?'))return;try{await api('amplDeleteAdj',{adjuntoId:aid,confirmar:'SI'});await refresh(curso);renderAttachments()}catch(e){update(e.message)}}
async function removeExp(){let mod=curso,row=sheet(mod).registros.find(r=>id(r)===NAV[mod].selected);if(!row)return update('Selecciona un expediente.');if(!confirm('¿Eliminar expediente Ítem '+get(row,sheet(mod).headers,'Item')+' y enviar sus archivos a papelera?'))return;try{await api('amplDelete',{modulo:mod,expedienteId:id(row),confirmar:'ELIMINAR'});NAV[mod].selected='';await refresh(mod);}catch(e){update(e.message)}}

// REV13: Vista previa local y de Drive sin modificar ni subir archivos.
let previewObjectUrl=null, previewGeneration=0, previewPdf=null, previewPage=1;
function previewModal(){return $('hdAmplPreviewModal');}
function closePreview(){previewGeneration++;if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null;}previewPdf=null;let modal=previewModal();if(modal){modal.hidden=true;$('hdAmplPreviewBody').replaceChildren();}}
function localPreview(file){if(!file)return;previewBlob(file,file.name,file.type);}
// Los adjuntos ya consultados se reutilizan dentro de la sesión (máximo 18 MB).
const previewCache=new Map();let previewCacheBytes=0;
function cacheAttachment(id,blob,name,mime){
 if(blob.size>10*1024*1024)return;
 while(previewCacheBytes+blob.size>18*1024*1024 && previewCache.size){const oldest=previewCache.keys().next().value;previewCacheBytes-=previewCache.get(oldest).blob.size;previewCache.delete(oldest);}
 previewCache.set(id,{blob,name,mime});previewCacheBytes+=blob.size;
}
async function previewSaved(aid){
 const t=++previewGeneration;
 const cached=previewCache.get(aid);
 if(cached){await previewBlob(cached.blob,cached.name,cached.mime,t);return;}
 openPreview('Cargando vista previa…');
 try{
  const parts=[];let info=null;
  for(let i=0;i<100;i++){
   const p=await api('amplPreview',{adjuntoId:aid,parte:i});if(t!==previewGeneration)return;
   if(!p||!p.base64)throw Error('Respuesta incompleta del archivo.');
   info=p;const b=atob(p.base64),a=new Uint8Array(b.length);for(let j=0;j<b.length;j++)a[j]=b.charCodeAt(j);parts.push(a);
   if(i+1>=Number(p.total||1))break;
   const status=$('hdAmplPreviewBody');if(status)status.textContent='Descargando fragmento '+(i+1)+' de '+p.total+'…';
  }
  if(t!==previewGeneration)return;
  const blob=new Blob(parts,{type:info.mime||'application/octet-stream'}),name=info.nombre||'Archivo',mime=info.mime||'';
  cacheAttachment(aid,blob,name,mime);
  await previewBlob(blob,name,mime,t);
 }catch(e){if(t===previewGeneration)$('hdAmplPreviewBody').textContent='No se pudo visualizar: '+(e.message||e);}
}
function openPreview(name){const m=previewModal();if(!m)return;m.hidden=false;$('hdAmplPreviewTitle').textContent=name;$('hdAmplPreviewBody').textContent='Preparando vista previa…';$('hdAmplPreviewDownload').hidden=true;}
async function previewBlob(blob,name,mime,generation){
 if(generation===undefined)generation=++previewGeneration;
 else if(generation!==previewGeneration)return;
 openPreview(name);
 if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null;}
 const url=URL.createObjectURL(blob);previewObjectUrl=url;
 const body=$('hdAmplPreviewBody');body.replaceChildren();
 const dl=$('hdAmplPreviewDownload');dl.hidden=false;dl.href=url;dl.download=name;
 const typ=(mime||blob.type||'').toLowerCase(),ext=String(name).split('.').pop().toLowerCase();
 if(typ.startsWith('image/')||['jpg','jpeg','png','gif','webp','bmp'].includes(ext)){
  const img=document.createElement('img');img.alt='Vista previa: '+name;img.src=url;img.className='hd-ampl-preview-image';body.appendChild(img);return;
 }
 if(typ.includes('pdf')||ext==='pdf'){
  if(!window.pdfjsLib){body.textContent='No se cargó el visor PDF. Usa Descargar.';return;}
  try{
   const data=new Uint8Array(await blob.arrayBuffer());if(generation!==previewGeneration)return;
   previewPdf=await pdfjsLib.getDocument({data}).promise;previewPage=1;
   const controls=document.createElement('div');controls.className='hd-ampl-pdf-controls';
   controls.innerHTML='<button type="button" id="hdAmplPrevPage">Anterior</button><span id="hdAmplPdfCount"></span><button type="button" id="hdAmplNextPage">Siguiente</button>';
   const holder=document.createElement('div');holder.id='hdAmplPdfCanvasHolder';holder.className='hd-ampl-pdf-page';
   body.append(controls,holder);
   controls.querySelector('#hdAmplPrevPage').onclick=()=>drawPreviewPdfPage(previewPage-1,generation);
   controls.querySelector('#hdAmplNextPage').onclick=()=>drawPreviewPdfPage(previewPage+1,generation);
   await drawPreviewPdfPage(1,generation);
  }catch(e){if(generation===previewGeneration)body.textContent='No se pudo renderizar PDF: '+e.message;}
  return;
 }
 if(ext==='docx' && window.mammoth){
  try{let result=await mammoth.convertToHtml({arrayBuffer:await blob.arrayBuffer()});if(generation!==previewGeneration)return;
   const content=document.createElement('div');content.className='hd-ampl-word-preview';
   // No introducir HTML de archivos como código ejecutable.
   content.innerHTML=window.DOMPurify?DOMPurify.sanitize(result.value):safe(result.value);body.appendChild(content);
  }catch(e){body.textContent='No se pudo mostrar el documento Word: '+e.message;}return;
 }
 body.textContent='Este formato no tiene visualización integrada. Usa Descargar para abrirlo con una aplicación compatible.';
}
async function drawPreviewPdfPage(n,generation){
 if(!previewPdf||n<1||n>previewPdf.numPages||generation!==previewGeneration)return;
 previewPage=n;const count=$('hdAmplPdfCount');if(count)count.textContent='Página '+n+' / '+previewPdf.numPages;
 const prev=$('hdAmplPrevPage'),next=$('hdAmplNextPage');if(prev)prev.disabled=n===1;if(next)next.disabled=n===previewPdf.numPages;
 const holder=$('hdAmplPdfCanvasHolder');if(!holder)return;holder.textContent='Cargando página…';
 const page=await previewPdf.getPage(n);if(generation!==previewGeneration||previewPage!==n)return;
 const targetWidth=Math.max(270,Math.min(830,holder.clientWidth||650));const raw=page.getViewport({scale:1});const scale=Math.min(2,targetWidth/raw.width);
 const vp=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.floor(vp.width);canvas.height=Math.floor(vp.height);
 await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
 if(generation!==previewGeneration||previewPage!==n)return;holder.replaceChildren(canvas);
}
function renderPendingFilePreviews(input){
 const parent=input.closest('.hd-ampl-inline-attachment');const target=parent?.querySelector('[data-preview-files]')||(input.id==='amplUploadInput'?$('amplExtraPreviews'):null);
 if(!target)return;target.replaceChildren();
 [...input.files].forEach((file,i)=>{
  const b=document.createElement('button');b.type='button';b.className='hd-ampl-file-preview-btn';b.textContent='👁 Vista previa: '+file.name;
  b.onclick=()=>localPreview(file);target.appendChild(b);
 });
}
document.addEventListener('change',e=>{if(e.target.matches('input[data-ampl-upload],#amplUploadInput'))renderPendingFilePreviews(e.target);});
// REV16: OCR conservador. Sin franjas con whitelist: causaban cifras inventadas.
function ocrMessage(message){const e=$('amplOCRStatus');if(e)e.textContent=message;}
let tesseractLoading=null;
function tesseractReady(){
 if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
 if(tesseractLoading)return tesseractLoading;
 tesseractLoading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  script.onload=()=>window.Tesseract?.createWorker?resolve(window.Tesseract):reject(Error('No se inició el OCR.'));
  script.onerror=()=>reject(Error('No se pudo descargar el motor OCR. Revisa la conexión.'));
  document.head.appendChild(script);
 }).catch(e=>{tesseractLoading=null;throw e;});return tesseractLoading;
}
// Reconocer solo números auténticos. No convertir palabras mal leídas en números.
function numericTokens(source){
 const out=[];const raw=String(source||'');
 for(const m of raw.matchAll(/(?:^|[^A-Za-z0-9])([0-9]{5,12})(?=$|[^A-Za-z0-9])/g)){
  const value=m[1];const freq=[...'0123456789'].map(d=>value.split(d).length-1);
  if(Math.max(...freq)/value.length>.72)continue;
  out.push({value,converted:false});
 }
 return out;
}
function candidates(text,confidence=90){
 const out=[];for(const line of String(text||'').replace(/\r/g,'').split('\n')){
  const sol=/solicitud|\bsol\.?\b/i.test(line),res=/resoluci[oó]n|\bres\.?\b/i.test(line);
  for(const n of numericTokens(line))out.push({type:sol&&!res?'sol':res&&!sol?'res':'numero',value:n.value,confidence:Number(confidence)||0,priority:sol||res?3:1,uncertain:Number(confidence)<80});
  let m=line.match(/(?:solicitante|interesado|administrado|raz[oó]n social)\s*[:\-]\s*(.{4,80})/i);
  if(m)out.push({type:'nombre',value:m[1].trim(),confidence:Number(confidence)||0,priority:2,uncertain:true});
  m=line.match(/(?:sector|localidad|caser[ií]o|centro poblado|direcci[oó]n)\s*[:\-]\s*(.{4,80})/i);
  if(m)out.push({type:'sector',value:m[1].trim(),confidence:Number(confidence)||0,priority:2,uncertain:true});
 }
 return out;
}
function mergeCandidates(items){
 const m=new Map();for(const c of items){const k=c.type+':'+(['numero','sol','res'].includes(c.type)?canonical(c.value):key(c.value));if(!k||k.endsWith(':'))continue;
  const prev=m.get(k);if(!prev)m.set(k,{...c,checks:1});else{prev.checks++;prev.confidence=Math.max(prev.confidence||0,c.confidence||0);prev.uncertain=prev.uncertain&&c.uncertain;prev.priority=Math.max(prev.priority||0,c.priority||0);}}
 const arr=[...m.values()].sort((a,b)=>(b.priority||0)-(a.priority||0)||(b.checks||0)-(a.checks||0)||(b.confidence||0)-(a.confidence||0));
 const explicit=new Set(arr.filter(c=>c.type==='sol'||c.type==='res').map(c=>canonical(c.value)));
 let num=0;return arr.filter(c=>{if(c.type==='numero'&&explicit.has(canonical(c.value)))return false;if(['numero','sol','res'].includes(c.type))return ++num<=5;return true;}).slice(0,9)
 .map(c=>({...c,uncertain:c.uncertain||(c.confidence||0)<82||(c.checks<2&&c.priority<3)}));
}
// Selección opcional de una zona: evita que líneas, bordes y cifras ajenas distraigan al OCR.
let ocrImage=null,ocrImageUrl=null,ocrCrop=null,ocrDrag=null;
function resetCrop(){ocrCrop=null;drawCrop();}
function releaseOCRImage(){if(ocrImageUrl){URL.revokeObjectURL(ocrImageUrl);ocrImageUrl=null;}ocrImage=null;ocrCrop=null;}
function drawCrop(){
 const canvas=$('amplOCRCropCanvas');if(!canvas||!ocrImage)return;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(ocrImage,0,0,canvas.width,canvas.height);
 if(ocrCrop){const x=ocrCrop.x*canvas.width,y=ocrCrop.y*canvas.height,w=ocrCrop.w*canvas.width,h=ocrCrop.h*canvas.height;
  ctx.fillStyle='rgba(12,95,224,.10)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#0962e2';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);}
}
async function showOCRImage(){
 const f=$('amplOCRFile')?.files?.[0],panel=$('amplOCRCropPanel'),canvas=$('amplOCRCropCanvas');
 releaseOCRImage();if(!panel||!canvas)return;panel.hidden=true;
 if(!f||(!f.type.startsWith('image/')&&!/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name)))return;
 try{
  ocrImageUrl=URL.createObjectURL(f);const img=new Image();img.decoding='async';img.src=ocrImageUrl;await img.decode();ocrImage=img;
  const max=900,scale=Math.min(1,max/img.naturalWidth,1200/img.naturalHeight);
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  drawCrop();panel.hidden=false;
 }catch(e){ocrMessage('No se pudo mostrar la imagen: '+e.message);}
}
function cropPoint(event){const cv=$('amplOCRCropCanvas'),r=cv.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(event.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(event.clientY-r.top)/r.height))};}
function cropStart(e){if(!ocrImage)return;const cv=$('amplOCRCropCanvas');cv.setPointerCapture?.(e.pointerId);ocrDrag=cropPoint(e);ocrCrop=null;e.preventDefault();}
function cropEnd(e){if(!ocrDrag)return;const p=cropPoint(e);const x=Math.min(p.x,ocrDrag.x),y=Math.min(p.y,ocrDrag.y),w=Math.abs(p.x-ocrDrag.x),h=Math.abs(p.y-ocrDrag.y);ocrDrag=null;ocrCrop=w>.025&&h>.025?{x,y,w,h}:null;drawCrop();e.preventDefault();}
async function preparedOCRImage(){
 if(!ocrImage)return $('amplOCRFile').files[0];
 const img=ocrImage,box=ocrCrop||{x:0,y:0,w:1,h:1},sx=Math.round(box.x*img.naturalWidth),sy=Math.round(box.y*img.naturalHeight),sw=Math.max(1,Math.round(box.w*img.naturalWidth)),sh=Math.max(1,Math.round(box.h*img.naturalHeight));
 const maxSide=2500;const scale=Math.min(2, maxSide/Math.max(sw,sh));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
 c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);return c;
}
function ocrAddManual(){const value=$('amplOCRManualText')?.value.trim();if(!value)return ocrMessage('Escribe un número, nombre o lugar.');
 const type=$('amplOCRManualType')?.value||'numero';ocrCandidates.unshift({type,value,uncertain:false,confidence:100,checks:3,priority:4});renderCandidates();$('amplOCRManualText').value='';ocrMessage('Dato añadido; selecciónalo y pulsa Buscar.');}
async function recognize(){
 const f=$('amplOCRFile')?.files?.[0];if(!f)return ocrMessage('Selecciona una fotografía o PDF.');
 if(!navigator.onLine)return ocrMessage('Se requiere conexión para descargar el motor OCR.');
 ocrFile=f;ocrCanceled=false;ocrCandidates=[];$('amplOCRResults').textContent='';let run=$('amplOCRRun');run.disabled=true;
 try{
  const T=await tesseractReady();const worker=await T.createWorker('spa',1,{logger:m=>{if(m.status==='recognizing text')ocrMessage('Leyendo: '+Math.round((m.progress||0)*100)+'%');}});recognizer=worker;
  await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
  if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')){
   if(!window.pdfjsLib)throw Error('No está disponible el lector PDF.');
   const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
   try{for(let n=1;n<=pdf.numPages&&!ocrCanceled;n++){
    const p=await pdf.getPage(n);let txt='';try{txt=(await p.getTextContent()).items.map(x=>x.str||'').join('\n');}catch(_){}
    if(numericTokens(txt).length)ocrCandidates.push(...candidates(txt,99));
    else{const vp=p.getViewport({scale:1.6}),cn=document.createElement('canvas');cn.width=vp.width;cn.height=vp.height;
     await p.render({canvasContext:cn.getContext('2d'),viewport:vp}).promise;const r=await worker.recognize(cn);
     ocrCandidates.push(...candidates(r.data.text,r.data.confidence||0));cn.width=cn.height=0;}
    ocrMessage('Página '+n+' de '+pdf.numPages);}}
   finally{pdf.destroy?.();}
  }else{
   if(!ocrImage)await showOCRImage();
   const cn=await preparedOCRImage();ocrMessage('Reconociendo '+(ocrCrop?'zona seleccionada':'imagen completa')+'…');
   const r=await worker.recognize(cn);ocrCandidates.push(...candidates(r.data.text,r.data.confidence||0));
   // Segunda lectura solo si no hay candidatos numéricos, evitando inventar alternativas.
   if(!ocrCanceled&&!ocrCandidates.some(c=>['numero','sol','res'].includes(c.type))){
    await worker.setParameters({tessedit_pageseg_mode:'6'});const again=await worker.recognize(cn);
    ocrCandidates.push(...candidates(again.data.text,again.data.confidence||0));
   }
   if(cn instanceof HTMLCanvasElement){cn.width=cn.height=0;}
  }
  ocrCandidates=mergeCandidates(ocrCandidates);renderCandidates();
  if(ocrCanceled)ocrMessage('Lectura cancelada.');
  else if(!ocrCandidates.length)ocrMessage('No se reconoció ningún número fiable. En la fotografía, marca solo el número y vuelve a pulsar Reconocer; también puedes introducirlo manualmente.');
  else ocrMessage('Verifica las cifras antes de buscar. Para mejorar la lectura, selecciona con el dedo un rectángulo alrededor del número y pulsa Reconocer otra vez.');
 }catch(e){ocrMessage('Error del OCR: '+(e.message||e));}
 finally{if(recognizer){await recognizer.terminate().catch(()=>{});recognizer=null;}ocrFile=null;run.disabled=false;}
}
function ocrCancel(){ocrCanceled=true;ocrMessage('Cancelando…');}
function renderCandidates(){
 const list=$('amplCandidates');list.innerHTML=ocrCandidates.map((c,i)=>`<div class="hd-ampl-candidate"><label><input type="checkbox" data-ocr="${i}" ${c.uncertain?'':'checked'}><select data-type="${i}"><option value="numero" ${c.type==='numero'?'selected':''}>Número (solicitud o resolución)</option><option value="sol" ${c.type==='sol'?'selected':''}>Solicitud</option><option value="res" ${c.type==='res'?'selected':''}>Resolución</option><option value="nombre" ${c.type==='nombre'?'selected':''}>Solicitante</option><option value="sector" ${c.type==='sector'?'selected':''}>Pueblo/sector</option></select></label><input inputmode="numeric" data-value="${i}" value="${safe(c.value)}"><small>${c.uncertain?'Lectura no confirmada. Comprueba el número antes de seleccionarlo.':'Comprueba el número en la imagen.'}</small></div>`).join('');
}
function selectedCandidates(){return ocrCandidates.map((c,i)=>{let checkbox=document.querySelector(`[data-ocr="${i}"]`);return checkbox?.checked?{type:document.querySelector(`[data-type="${i}"]`).value,value:document.querySelector(`[data-value="${i}"]`).value.trim()}:null;}).filter(c=>c&&c.value);}
// Al elegir/tomar fotografía se muestra instantáneamente; no se espera a descargar Tesseract.
document.addEventListener('change',e=>{if(e.target.id==='amplOCRFile')showOCRImage();});
document.addEventListener('pointerdown',e=>{if(e.target.id==='amplOCRCropCanvas')cropStart(e);});
document.addEventListener('pointerup',e=>{if(e.target.id==='amplOCRCropCanvas')cropEnd(e);});
function sim(a,b){a=key(a);b=key(b);if(!a||!b)return 0;if(a===b)return 1;if(a.includes(b)||b.includes(a))return .86;let dist=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=dist[0];dist[0]=i;for(let j=1;j<=b.length;j++){let tmp=dist[j];dist[j]=Math.min(dist[j]+1,dist[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=tmp;}}return 1-dist[b.length]/Math.max(a.length,b.length);}
function matchDetail(row,mod,c){
 const h=sheet(mod).headers;
 if(['numero','sol','res'].includes(c.type)){
  const needle=canonical(c.value);if(!needle)return {score:0,where:''};
  const pools=[];
  if(c.type==='numero'||c.type==='sol')pools.push(['NroSolicitud',MODS[mod].sol,'Solicitud']);
  if((c.type==='numero'||c.type==='res')&&mod==='OM5')pools.push(['NroResolución',2,'Resolución']);
  for(const [prefix,limit,label] of pools)for(let i=1;i<=limit;i++){
   const col=field(h,prefix,i);if(col&&values(row[col]).includes(needle))return {score:1,where:label+' '+i};
  }
  return {score:0,where:''};
 }
 const s=c.type==='sector'?[get(row,h,'NombreSector','Direccion'),get(row,h,'Departamento'),get(row,h,'Provincia'),get(row,h,'Distrito')].join(' '):get(row,h,'Solicitante','Nombre');
 return {score:Math.max(sim(s,c.value),...s.split(/[,;]+/).map(v=>sim(v,c.value))),where:c.type==='sector'?'Sector / localidad':'Nombre'};
}
function match(row,mod,c){return matchDetail(row,mod,c).score;}
async function searchOCR(){let candidates=selectedCandidates();if(!candidates.length)return ocrMessage('Selecciona al menos un dato.');try{await Promise.all(['OM5','UIA'].filter(m=>!STORE[m]).map(async m=>{let d=await api('amplRead',{modulo:m});if(!d||!Array.isArray(d.registros))throw Error('No se pudieron consultar los registros de '+m);STORE[m]=d;}));let container=$('amplOCRResults');let html='';for(let mod of ['OM5','UIA']){let items=sheet(mod).registros.map(r=>{let matched=candidates.map(c=>({c,...matchDetail(r,mod,c)})).filter(x=>x.score>=.70);return {r,matched,score:Math.max(0,...matched.map(x=>x.score))};}).filter(x=>x.matched.length).sort((a,b)=>b.score-a.score);html+=`<h3>${mod} (${items.length})</h3>`+(items.length?'':'<p>No se encontraron coincidencias.</p>')+items.map(x=>`<div class="hd-ampl-result"><b>Ítem ${safe(get(x.r,sheet(mod).headers,'Item','Ítem'))}</b><p>${safe(get(x.r,sheet(mod).headers,'Solicitante','Nombre'))}</p><small>${x.matched.map(z=>safe(z.c.value)+' — '+safe(z.where)+' ('+(z.score===1?'exacta':'aproximada')+')').join(', ')}</small><div><button onclick="Ampliaciones.ocrOpen('${mod}','${safe(id(x.r))}')">Abrir ficha</button><button onclick="Ampliaciones.ocrLocate('${mod}','${safe(id(x.r))}')">Localizar en lista</button></div></div>`).join('');}container.innerHTML=html;ocrMessage('Búsqueda realizada en OM5 y UIA.');}catch(e){ocrMessage('Error: '+e.message)}}
function ocrOpen(mod,rid){curso=mod;let sec=$('tab-'+mod.toLowerCase());window.switchTab(mod.toLowerCase());NAV[mod].selected=rid;open(rid,0,false);}
function ocrLocate(mod,rid){window.switchTab(mod.toLowerCase());curso=mod;NAV[mod].filter='';NAV[mod].page=Math.floor(sheet(mod).registros.findIndex(r=>id(r)===rid)/30);NAV[mod].selected=rid;render(mod);}
// Corrección de arranque: no referenciar funciones inexistentes.
// Mantener intactas las funciones disponibles de OM5, UIA, guardado y adjuntos.
window.Ampliaciones={
  getData:mod=>STORE[mod],
  enter,refresh,select,page,search,open,close,save,
  addDoc,deleteDocField,upload,download,previewSaved,localPreview,closePreview,removeFile,removeExp,
  recognize,ocrCancel,searchOCR,ocrOpen,ocrLocate,ocrAddManual,showOCRImage,resetCrop,
  // Estas tres funciones no existen en REV12. No bloquear el arranque.
  excel:()=>update('La exportación de ampliaciones no está disponible en esta revisión.'),
  summary:()=>update('El reporte de ampliaciones no está disponible en esta revisión.'),
  share:()=>update('El envío por WhatsApp de ampliaciones no está disponible en esta revisión.'),
  reset:()=>{STORE.OM5=null;STORE.UIA=null;ocrCandidates=[];ocrFile=null;ocrCanceled=true;}
};
})();
