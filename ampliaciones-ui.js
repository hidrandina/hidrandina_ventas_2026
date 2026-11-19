/* HIDRANDINA_VENTAS REV62 - Corrección de encabezados OM5 sobre REV61; no modifica backend. */
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
const asis=()=>['Asistente OM5','Asistente Documentos/OM5/UIA'].includes((typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : ''));
const oper=()=>['Operador OM5','Operador Documentos/OM5/UIA'].includes((typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : ''));
const view=()=>adm()||asis()||oper()||['Visitante OM5','Visitante Total'].includes((typeof currentUser !== 'undefined' && currentUser ? currentUser.tipo : ''));
const edit=()=>adm()||asis()||oper();
const update=(txt,type='info')=>{let e=$('amplStatus');if(e)e.textContent=txt;let m=$('amplFormStatus');if(m&&!$('amplModal')?.hidden&&registro?.editable){m.textContent=txt;m.dataset.type=type;m.hidden=!txt;}};
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
 if(mod==='OM5'&&isNew){
  const missing=om5MissingColumns_();
  if(missing.length)return {message:'No se permite guardar: faltan campos reales de la base OM5 ('+missing.slice(0,6).join(', ')+(missing.length>6?'…':'')+'). Revisa la versión publicada de Apps Script y la estructura de datos. No se ha modificado la base.',field:''};
 }
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
    if(dateField&&!date&&(!unchanged||!!String(previous[dateField]??'').trim()))return {message:'La '+label.toLowerCase()+' '+i+' necesita una fecha válida. Completa la fecha antes de guardar.',field:dateField};
   } else if(date){return {message:'Falta el número de '+label.toLowerCase()+' '+i+' para la fecha ingresada.',field:numberField};}
  }
 }
 if(isNew&&!documents)return {message:'Debes ingresar al menos una solicitud'+(mod==='OM5'?' o una resolución':'')+' con su fecha.',field:field(hs,'NroSolicitud',1)};
 return null;
}
const api=async(action,data={})=>{let res=await window.postGateway({action,...data},110000);return res;};
function sheet(mod){return STORE[mod]||{headers:[],registros:[],adjuntos:[],catalogos:{}};}
/* REV62. La respuesta de algunas implementaciones contiene los registros pero
   omite o entrega incompletos los encabezados. Recuperarlos de las CLAVES
   ORIGINALES de los registros, sin inventar ni renombrar columnas de Sheets. */
function normalizeReadData_(mod,data){
 if(!data||!Array.isArray(data.registros))return data;
 const supplied=Array.isArray(data.headers)?data.headers.filter(h=>typeof h==='string'&&h&&!h.startsWith('__')):[];
 const rows=data.registros;
 const discovered=[];
 const present=new Set();
 for(const row of rows.slice(0,Math.min(8,rows.length))){
  if(!row||typeof row!=='object')continue;
  for(const h of Object.keys(row)){
   if(h.startsWith('__')||!h||present.has(key(h)))continue;
   present.add(key(h));discovered.push(h);
  }
 }
 const actual=new Map(discovered.map(h=>[key(h),h]));
 // Priorizar los nombres que efectivamente aparecen en los registros: son los
 // mismos identificadores que acepta amplSave en el servidor.
 const normalized=supplied.map(h=>actual.get(key(h))||h);
 const seen=new Set(normalized.map(key));
 for(const h of discovered)if(!seen.has(key(h))){normalized.push(h);seen.add(key(h));}
 return {...data,headers:normalized,registros:rows};
}
function om5MissingColumns_(){
 const hs=sheet('OM5').headers;
 const required=['Solicitante','NombreSector','Suministro','TipoSuministro','IniciativaObra','ObservacionesObras','UUEE','Departamento','Provincia','Distrito','Alimentador','ClientesCaptar'];
 for(let i=1;i<=6;i++)required.push('NroSolicitud'+i,'FechaSolicitud'+i);
 for(let i=1;i<=2;i++)required.push('NroResolución'+i,'FechaResolucion'+i);
 return required.filter(name=>!head(hs,name));
}
function section(){return $('tab-'+curso.toLowerCase());}
function format(v){if(v===null||v===undefined)return '';if(typeof v==='object')return '';return String(v);}
function fieldsByStage(mod,stage){
 const hs=sheet(mod).headers;
 if(mod==='UIA')return hs.filter(h=>!h.startsWith('__')&&key(h)!=='tipo');
 if(stage===0){
  // Nunca depender de índices fijos si la hoja agregó o reordenó columnas.
  const names=['Solicitante','NombreSector','Suministro','TipoSuministro','IniciativaObra','ObservacionesObras','UUEE','Departamento','Provincia','Distrito','Alimentador','ClientesCaptar'];
  for(let i=1;i<=6;i++)names.push('NroSolicitud'+i,'FechaSolicitud'+i);
  for(let i=1;i<=2;i++)names.push('NroResolución'+i,'FechaResolucion'+i);
  return names.map(name=>head(hs,name)).filter(Boolean);
 }
 return hs.slice(ETAPAS[stage][1],ETAPAS[stage][2]).filter(h=>!h.startsWith('__'));
}
function rolesReady(){return typeof currentUser !== 'undefined' && !!currentUser && view();}
function activeAmplModule(){const parent=$('amplWorkspace')?.parentElement?.id;return parent==='tab-uia'?'UIA':parent==='tab-om5'?'OM5':null;}
async function enter(mod){
 curso=mod;
 if(!rolesReady()){update('No tienes acceso a este módulo.');return;}
 if(!STORE[mod]){
  // Evitar que se vea un listado OM5 mientras carga UIA, o viceversa.
  if(activeAmplModule()===mod){$('amplTableHead').innerHTML='';$('amplTableBody').innerHTML='<tr><td>Consultando expedientes '+mod+'...</td></tr>';$('amplStages').innerHTML='';$('amplCount').textContent='';}
  await refresh(mod);
 }else if(activeAmplModule()===mod)render(mod);
}

async function refresh(mod){
 if(activeAmplModule()===mod){curso=mod;update('Cargando '+mod+'...');}
 try{
  const data=await api('amplRead',{modulo:mod});
  if(!data||!Array.isArray(data.registros))throw Error('Respuesta de '+mod+' sin registros válidos.');
  STORE[mod]=normalizeReadData_(mod,data);
  // Una consulta atrasada NO puede sobrescribir la vista del otro módulo.
  if(activeAmplModule()!==mod)return;
  curso=mod;render(mod);
  update(mod+': '+data.registros.length+' expedientes disponibles.');
 }catch(e){if(activeAmplModule()===mod)update('No se pudo cargar '+mod+': '+e.message);}
}

function numDocs(row,mod){let h=sheet(mod).headers,n=MODS[mod].sol;let s=[];for(let i=1;i<=n;i++){let x=field(h,'NroSolicitud',i),f=field(h,'FechaSolicitud',i);if(x&&row[x])s.push(String(row[x])+(f&&row[f]?' · '+format(row[f]):''));}return s.join('\n');}
function numRes(row,mod){let h=sheet(mod).headers,n=MODS[mod].res;let s=[];for(let i=1;i<=n;i++){let x=field(h,'NroResolución',i),f=field(h,'FechaResolucion',i);if(x&&row[x])s.push(String(row[x])+(f&&row[f]?' · '+format(row[f]):''));}return s.join('\n');}
function estadoColor(value){let v=key(value);return !v?'#8c96a6':/terminado|conforme|atendido/.test(v)?'#1e67d2':/proceso/.test(v)?'#e59624':/pendiente|observado/.test(v)?'#d64545':'#8c96a6';}
function filt(row,mod){let n=NAV[mod],h=sheet(mod).headers,q=key(n.filter);if(q){let val=n.col==='todos'?h.filter(k=>mod!=='UIA'||key(k)!=='tipo').map(k=>format(row[k])).join(' '):n.col==='sol'?numDocs(row,mod):n.col==='res'?numRes(row,mod):format(row[head(h,n.col)]);if(!key(val).includes(q))return false;}
 if(n.start||n.end){let dates=h.filter(x=>/^fecha(solicitud|resoluc)/i.test(key(x))).map(k=>format(row[k]).slice(0,10)).filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v));if(!dates.some(d=>(!n.start||d>=n.start)&&(!n.end||d<=n.end)))return false;}
 return true;}
function visible(mod){return sheet(mod).registros.filter(r=>filt(r,mod));}

/* REV17 — Modelo de 40 campos tomado exclusivamente de Reporte_OM5.
   Solo presentación: la base de 60 columnas, sus IDs y operaciones no cambian. */
const OM5_REPORT_HEADERS = ["Ítem", "Solicitante", "NombreSector", "Solcitudes", "Fechas", "Resoluciones", "Fechas Resoluciones", "Suministro", "TipoSuministro", "IniciativaObra", "ObservacionesObras", "UUEE", "Departamento", "Provincia", "Distrito", "Alimentador", "ClientesCaptar", "ObsExpedientes", "Memorandos Expedientes", "EstadoExpVentas", "ObsInspecciones", "MemoObsInspGC", "RedesMT", "PostesMT", "SED", "PostesBT", "RedesBT", "MemoRespGC", "EstadoInspeccionVentas", "MemoEnvioIndividualGT", "MemoEnvioGTmasivo", "Modalidad", "FechaProgramadaEjecuciónUMD", "TipoOM", "NroOM", "FechaEjecutacionUMD", "EstadoUMD", "ClientesCaptados", "ObsCaptacionClientes", "EstadoCaptacionClientes"];
const OM5_REPORT_GROUPS = {"Solcitudes": ["NroSolicitud1", "NroSolicitud2", "NroSolicitud3", "NroSolicitud4", "NroSolicitud5", "NroSolicitud6"], "Fechas": ["FechaSolicitud1", "FechaSolicitud2", "FechaSolicitud3", "FechaSolicitud4", "FechaSolicitud5", "FechaSolicitud6"], "Resoluciones": ["NroResolución1", "NroResolución2"], "Fechas Resoluciones": ["FechaResolucion1", "FechaResolucion2"], "ObsExpedientes": ["ObsExpediente1", "ObsExpediente2", "ObsExpediente3"], "Memorandos Expedientes": ["MemoObsGC1", "MemoObsGC2", "MemoObsGC3"], "ObsInspecciones": ["ObsInspecciones1", "ObsInspecciones2", "ObsInspecciones3"], "MemoObsInspGC": ["MemoObsInspGC1", "MemoObsInspGC2", "MemoObsInspGC3"]};
const OM5_REPORT_PAIRS = [['Solcitudes','Fechas'],['Resoluciones','Fechas Resoluciones'],['ObsExpedientes','Memorandos Expedientes'],['ObsInspecciones','MemoObsInspGC']];
function om5ReportColumn(row,header,hs){
  const group=OM5_REPORT_GROUPS[header];
  if(!group){const col=head(hs,header);return col?format(row[col]):'';}
  const pair=OM5_REPORT_PAIRS.find(x=>x.includes(header));
  const a=OM5_REPORT_GROUPS[pair?pair[0]:header]||group,b=OM5_REPORT_GROUPS[pair?pair[1]:header]||[];
  const indexes=group.map((_,i)=>i).filter(i=>{
    const x=head(hs,a[i]||''),y=head(hs,b[i]||'');
    return (x&&String(row[x]??'').trim())||(y&&String(row[y]??'').trim());
  });
  return indexes.map(i=>{const col=head(hs,group[i]);return col?om5ReportDate(header,format(row[col])):'';}).join('\n');
}
function om5ReportDate(header,value){
  if(!/fecha/i.test(header))return value;
  const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?m[3]+'/'+m[2]+'/'+m[1]:value;
}
function om5ReportRows(data){const hs=data.headers||[];return (data.registros||[]).map(row=>{
 const result={};for(const header of OM5_REPORT_HEADERS)result[header]=om5ReportColumn(row,header,hs);
 result.__HD_ID=row.__HD_ID||'';return result;
});}
window.HDReporteOM5={headers:OM5_REPORT_HEADERS,convert:om5ReportRows};


/* REV19 — Exclusivamente UIA: se omite el campo duplicado Tipo de los 27 campos originales; 18 columnas del
   archivo Reporte_UIA. No altera la base, el modelo aprobado de OM5 ni sus 40 columnas. */
const UIA_REPORT_HEADERS = ["Item", "Nombre", "Direcciòn", "NroSolicitudes", "Fechasolicitudes", "Departamento", "Provincia", "Distrito", "SED Referencia", "N° Clientes", "MemorandosGC", "Tipo de OM", "Nro OM", "FechaEjecutadoUMD", "Estado Actual", "Clentes Captados", "Estado Captación Clientes", "Observación Captación Clientes"];
const UIA_REPORT_GROUPS = {
 'NroSolicitudes':['NroSolicitud1','NroSolicitud2','NroSolicitud3'],
 'Fechasolicitudes':['Fechasolicitud1','Fechasolicitud2','Fechasolicitud3'],
 'MemorandosGC':['MemorandoGC1','MemorandoGC2','MemorandoGC3','MemorandoGC4','MemorandoGC5']
};
function uiaReportColumn(row,header,hs){
 if(header==='NroSolicitudes'||header==='Fechasolicitudes'){
  const isDate=header==='Fechasolicitudes';
  const numbers=UIA_REPORT_GROUPS.NroSolicitudes,dates=UIA_REPORT_GROUPS.Fechasolicitudes;
  // Correspondencia por posición: una fecha nunca se desplaza a otra solicitud.
  const positions=numbers.map((_,i)=>i).filter(i=>{
   const n=head(hs,numbers[i]),d=head(hs,dates[i]);
   return (n&&String(row[n]??'').trim())||(d&&String(row[d]??'').trim());
  });
  return positions.map(i=>{
   const col=head(hs,isDate?dates[i]:numbers[i]);
   const v=col?format(row[col]):'';
   return isDate?om5ReportDate('Fecha',v):v;
  }).join('\n');
 }
 if(header==='MemorandosGC'){
  return UIA_REPORT_GROUPS.MemorandosGC.map(f=>{
   const col=head(hs,f);return col?format(row[col]):'';
  }).filter(v=>String(v).trim()).join('\n');
 }
 if(key(header)==='tipo')return ''; // Campo duplicado UIA excluido del reporte.
 const col=head(hs,header);return col?(/fecha/i.test(header)?om5ReportDate('Fecha',format(row[col])):format(row[col])):'';
}
function uiaReportRows(data){
 const hs=data.headers||[];
 return (data.registros||[]).map(row=>{
  const result={};
  for(const header of UIA_REPORT_HEADERS)result[header]=uiaReportColumn(row,header,hs);
  result.__HD_ID=row.__HD_ID||'';
  return result;
 });
}
window.HDReporteUIA={headers:UIA_REPORT_HEADERS,convert:uiaReportRows};

function render(mod){
 curso=mod;
 const n=NAV[mod], source=visible(mod), sub=source.slice(n.page*30,(n.page+1)*30), h=sheet(mod).headers;
 const body=$('amplTableBody'),theader=$('amplTableHead');if(!body||!theader)return;
 if(mod==='OM5'){
  const columns=OM5_REPORT_HEADERS, report=om5ReportRows({headers:h,registros:sub});
  theader.innerHTML='<tr><th class="hd-choose" title="Seleccionar expediente" aria-label="Seleccionar expediente"><i class="fa-solid fa-xmark" aria-hidden="true"></i></th><th class="hd-report-actions" title="Consultar / Editar" aria-label="Consultar / Editar"><i class="fa-regular fa-eye" aria-hidden="true"></i> <i class="fa-solid fa-pen" aria-hidden="true"></i></th>'+columns.map(k=>'<th>'+safe(k)+'</th>').join('')+'</tr>';
  body.innerHTML=report.map((row,i)=>{const original=sub[i],uid=id(original),chosen=n.selected===uid;
    return '<tr data-id="'+safe(uid)+'" class="'+(chosen?'hd-ampl-selected':'')+'"><td class="hd-choose"><input type="radio" name="amplElegido" '+(chosen?'checked':'')+' aria-label="Seleccionar ítem '+safe(row['Ítem'])+'" onchange="Ampliaciones.select(\''+safe(uid)+'\')"></td>'+
    '<td class="hd-report-actions"><button type="button" class="hd-om5-eye" title="Consultar expediente" aria-label="Consultar expediente" onclick="Ampliaciones.open(\''+safe(uid)+'\',0,false)"><i class="fa-regular fa-eye" aria-hidden="true"></i></button>'+(edit()?'<button type="button" class="hd-om5-pencil" title="Editar expediente" aria-label="Editar expediente" onclick="Ampliaciones.open(\''+safe(uid)+'\',0,true)"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>':'')+'</td>'+
    columns.map(k=>'<td title="'+safe(row[k]).replace(/\n/g,' / ')+'" class="'+(OM5_REPORT_GROUPS[k]?'hd-report-multiline':'')+'">'+safe(row[k])+'</td>').join('')+'</tr>';
  }).join('')||'<tr><td colspan="42">No se encontraron expedientes</td></tr>';
 }else{
  // UIA: 18 campos sin la columna duplicada Tipo; Elegir y Acción se conservan.
  const columns=UIA_REPORT_HEADERS,report=uiaReportRows({headers:h,registros:sub});
  theader.innerHTML='<tr><th class="hd-choose" title="Seleccionar expediente" aria-label="Seleccionar expediente"><i class="fa-solid fa-xmark" aria-hidden="true"></i></th><th class="hd-report-actions" title="Consultar / Editar" aria-label="Consultar / Editar"><i class="fa-regular fa-eye" aria-hidden="true"></i> <i class="fa-solid fa-pen" aria-hidden="true"></i></th>'+columns.map(k=>'<th>'+safe(k)+'</th>').join('')+'</tr>';
  body.innerHTML=report.map((r,i)=>{
   const original=sub[i],uid=id(original),chosen=n.selected===uid;
   return '<tr data-id="'+safe(uid)+'" class="'+(chosen?'hd-ampl-selected':'')+'"><td class="hd-choose"><input type="radio" name="amplElegido" '+(chosen?'checked':'')+' aria-label="Seleccionar ítem '+safe(r['Item'])+'" onchange="Ampliaciones.select(\''+safe(uid)+'\')"></td>'+
    '<td class="hd-report-actions"><button type="button" class="hd-uia-eye" title="Consultar expediente" aria-label="Consultar expediente" onclick="Ampliaciones.open(\''+safe(uid)+'\',0,false)"><i class="fa-regular fa-eye" aria-hidden="true"></i></button>'+(edit()?'<button type="button" class="hd-uia-pencil" title="Editar expediente" aria-label="Editar expediente" onclick="Ampliaciones.open(\''+safe(uid)+'\',0,true)"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>':'')+'</td>'+
    columns.map(k=>'<td title="'+safe(r[k]).replace(/\n/g,' / ')+'" class="'+(UIA_REPORT_GROUPS[k]?'hd-report-multiline':'')+'">'+safe(r[k])+'</td>').join('')+'</tr>';
  }).join('')||'<tr><td colspan="20">No se encontraron expedientes UIA</td></tr>';
 }
 $('amplCount').textContent=source.length+' expedientes; página '+(n.page+1)+' de '+Math.max(1,Math.ceil(source.length/30));
 $('amplPrev').disabled=n.page===0;$('amplNext').disabled=(n.page+1)*30>=source.length;
 const buttons=$('amplStages');
 if(buttons){
  const selected=mod==='OM5'?sheet(mod).registros.find(r=>id(r)===n.selected):null;
  const stateFields=[null,'EstadoExpVentas','EstadoInspeccionVentas','EstadoUMD','EstadoCaptacionClientes'];
  buttons.innerHTML=mod==='OM5'?ETAPAS.map((et,i)=>{
   const stateField=stateFields[i];
   // El registro existe y está completo si el usuario ha seleccionado un expediente.
   // Sin selección, todas las etapas se muestran en plomo.
   const state=selected&&stateField?get(selected,h,stateField):'';
   const color=i===0?(selected?'#1e67d2':'#8c96a6'):estadoColor(state);
   const label=i===0?(selected?'Terminado':'Sin información'):(String(state||'').trim()||'Sin información');
   return '<button type="button" style="background:'+color+'" title="'+safe(et[0]+': '+label)+'" '+(selected?'':'disabled')+' onclick="Ampliaciones.open(\''+safe(n.selected)+'\','+i+',false)">'+safe(et[0])+'</button>';
  }).join(''):'<span class="hd-ampl-muted">UIA no utiliza etapas</span>';
 }
 $('amplNew').hidden=!edit();$('amplDelete').hidden=!edit()||!(adm()||asis()||oper());
}

function select(idValue){NAV[curso].selected=idValue;render(curso);}
function page(delta){let n=NAV[curso];n.page=Math.max(0,n.page+delta);render(curso);}
function search(){let n=NAV[curso];n.filter=$('amplSearch').value;n.col=$('amplField').value;n.start=$('amplStart').value;n.end=$('amplEnd').value;n.page=0;render(curso);}
function valuesOptions(c){let catalog=sheet(curso).catalogos||{},map={Modalidad:'A',TipoSuministro:'B',Departamento:'C',Provincia:'D',Distrito:'E',EstadoExpVentas:'F',EstadoInspeccionVentas:'G',EstadoUMD:'H',EstadoCaptacionClientes:'I',UUEE:'J'};let col=map[Object.keys(map).find(x=>key(x)===key(c))];return col?catalog[col]||[]:[];}
function fieldInput(h,value,editable){let date=/^fecha/i.test(key(h)),text=/observac|obs|memo/i.test(key(h)),opts=valuesOptions(h);if(curso==='OM5'&&/^memo(envio|obs)/.test(key(h)))text=false;if(key(h)==='estadoactual'&&curso==='UIA')opts=['Pendiente','Atendido'];let disabled=editable?'':'disabled';let val=format(value);
 if(date&&/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)){
  const [dd,mm,yyyy]=val.split('/');val=yyyy+'-'+mm.padStart(2,'0')+'-'+dd.padStart(2,'0');
 }
 if(opts.length)return `<select data-k="${safe(h)}" ${disabled}><option value="">Seleccionar...</option>${[...new Set([...opts,val].filter(Boolean))].map(v=>`<option ${v===val?'selected':''} value="${safe(v)}">${safe(v)}</option>`).join('')}</select>`;
 if(text)return `<textarea ${disabled} rows="3" data-k="${safe(h)}">${safe(val)}</textarea>`;
 return `<input ${disabled} data-k="${safe(h)}" type="${date?'date':/^clientes|^redes|^postes/i.test(key(h))?'number':'text'}" ${/^clientes|^redes|^postes/i.test(key(h))?'min="0"':''} value="${safe(date?val.slice(0,10):val)}">`;
}
/* REV39: Navegación de cinco etapas. Los cambios escritos y los archivos seleccionados
   quedan en memoria hasta Guardar; cambiar de pestaña no los descarta. */
function captureStage(){
 if(!registro||!registro.editable)return;
 const form=$('amplFormBody');if(!form)return;
 // REV89: recordar las filas que el usuario desplegó, incluso si están vacías.
 // Se conserva también al rechazar un guardado o al cambiar de etapa.
 if(registro.mod==='OM5'&&registro.stage===0){
  registro.expandedDocs=registro.expandedDocs||{};
  for(const kind of ['sol','res']){
   const rows=[...form.querySelectorAll('[data-doc="'+kind+'"]')];
   if(rows.length)registro.expandedDocs[kind]=Math.max(0,...rows.filter(el=>!el.hidden).map(el=>Number(el.dataset.num)||0));
  }
 }
 const changes={};
 form.querySelectorAll('[data-k]').forEach(el=>{
  if(el.closest('[data-doc]')?.hidden)return;
  const k=el.getAttribute('data-k');if(k)changes[k]=String(el.value??'').trim();
 });
 registro.drafts[registro.stage]=changes;
 const selected=[];
 form.querySelectorAll('input[data-ampl-upload]').forEach(input=>{
  if(input.closest('[data-doc]')?.hidden)return;
  [...(input.files||[])].forEach(file=>selected.push({campo:input.getAttribute('data-ampl-upload'),file}));
 });
 // Los adjuntos elegidos en otras visitas a esta etapa permanecen pendientes.
 // Una nueva selección del mismo campo reemplaza la pendiente anterior de ese campo.
 const previous=registro.pendingFiles[registro.stage]||[];
 const replaced=new Set(selected.map(x=>key(x.campo)));
 registro.pendingFiles[registro.stage]=previous.filter(x=>!replaced.has(key(x.campo))).concat(selected);
}
/* REV60: comparar contra el estado ORIGINAL VISIBLE de cada etapa.
   Los valores nulos, las fechas y los selectores pueden normalizarse durante
   el render; eso no constituye un cambio hecho por el usuario. */
function snapshotStage_(){
 const data={};
 const form=$('amplFormBody');
 if(!form)return data;
 form.querySelectorAll('[data-k]').forEach(el=>{
  if(el.closest('[data-doc]')?.hidden)return;
  const k=el.getAttribute('data-k');
  if(k)data[k]=String(el.value??'').trim();
 });
 return data;
}
function hasUnsavedChanges_(){
 if(!registro?.editable)return false;
 const modified=Object.entries(registro.drafts||{}).some(([stage,values])=>
  Object.entries(values||{}).some(([k,v])=>{
   const baseline=registro.baselines?.[stage]||{};
   // Si el campo estaba oculto al abrir la etapa, su estado base era vacío
   // salvo que el dato histórico existiera en la base.
   const original=Object.prototype.hasOwnProperty.call(baseline,k)
    ?baseline[k]:String(registro.originalRow?.[k]??'').trim();
   return String(v??'').trim()!==String(original??'').trim();
  })
 );
 return modified||Object.values(registro.pendingFiles||{}).some(a=>Array.isArray(a)&&a.length>0);
}
function switchStage(next){
 if(!registro||registro.mod!=='OM5'||saving)return;
 if(!Number.isInteger(next)||next<0||next>=ETAPAS.length||next===registro.stage)return;
 const old=registro;
 captureStage();
 const scrollPanel=$('amplModal')?.querySelector('.hd-ampl-panel');
 open(old.id,next,old.editable,old.drafts,old.pendingFiles,old.baselines,old.expandedDocs,old.postSaveNew);
 if(scrollPanel)scrollPanel.scrollTop=0;
}
function renderStageTabs(){
 const nav=$('amplStageTabs');if(!nav)return;
 if(curso!=='OM5'){nav.hidden=true;nav.innerHTML='';return;}
 nav.hidden=false;
 nav.innerHTML=ETAPAS.map(([title],i)=>'<button type="button" class="hd-ampl-stage-tab '+(i===registro.stage?'is-active':'')+'" '+(i===registro.stage?'aria-current="step"':'')+' onclick="Ampliaciones.switchStage('+i+')">'+(i+1)+'. '+safe(title)+'</button>').join('');
}

/* REV08: formularios compactos según estructura real de Google Sheets. */
function open(rid,stage=0,editable=false,carriedDrafts=null,carriedFiles=null,carriedBaselines=null,carriedExpandedDocs=null,carriedPostSaveNew=false){
 let row=rid?sheet(curso).registros.find(r=>id(r)===rid):null;
 if(rid&&!row){update('Expediente no disponible.');return;}
 if(editable&&!edit()){update('Sin permisos de edición.');return;}
 const drafts=carriedDrafts||{},pendingFiles=carriedFiles||{},baselines=carriedBaselines||{};
 const expandedDocs=carriedExpandedDocs||{};
 const displayRow={...(row||{}),...Object.assign({},...Object.values(drafts))};
 registro={id:rid||'',version:row?row.__HD_VERSION:0,editable:!!editable,stage,row:displayRow,originalRow:row||{},mod:curso,drafts,pendingFiles,baselines,expandedDocs,postSaveNew:!!carriedPostSaveNew};
 const isNewOM5Entry=curso==='OM5'&&stage===0&&(!rid||!editable);
 const isOM5Consulta=curso==='OM5'&&!!rid&&!editable;
 const isOM5Registro=curso==='OM5'&&stage===0;
 $('amplModal')?.classList.toggle('hd-om5-entry',isNewOM5Entry);
 $('amplModal')?.classList.toggle('hd-om5-consulta',isOM5Consulta);
 $('amplModal')?.classList.toggle('hd-om5-postsave-new',curso==='OM5'&&registro.postSaveNew);
 $('amplModal')?.classList.toggle('hd-om5-consolidated',curso==='OM5');
 // REV101: diseño únicamente del formulario Nuevo expediente UIA.
 $('amplModal')?.classList.toggle('hd-uia-new-entry',curso==='UIA'&&(!rid||registro.postSaveNew));
 // REV66: identificar la etapa para compactar únicamente el formulario OM5.
 for(let i=0;i<5;i++)$('amplModal')?.classList.toggle('hd-om5-stage-'+i,curso==='OM5'&&stage===i);
 const hs=fieldsByStage(curso,stage),all=sheet(curso).headers,ui=$('amplFormBody');
 renderStageTabs();
 $('amplFormTitle').textContent=curso==='UIA'&&registro.postSaveNew?'Nuevo expediente':rid?(editable?'Editar expediente':'Consultar expediente'):'Nuevo expediente';
 // Etiquetas legibles incluso cuando la hoja opcional EtiquetasOM5 no está disponible.
 const uiLabels={
  solicitante:'Solicitante',nombresector:'Nombre del sector',suministro:'Suministro',
  tiposuministro:'Tipo de suministro',iniciativaobra:'N.º de iniciativa de obras',
  observacionesobras:'Observaciones de obras',uuee:'Unidad empresarial (UUEE)',
  departamento:'Departamento',provincia:'Provincia',distrito:'Distrito',
  alimentador:'Alimentador',
  clientescaptar:'Clientes a captar',memoenviogtmasivo:'Memorando masivo de envío a Gerencia Técnica',
  modalidad:'Modalidad',fechaprogramadaejecucionumd:'Fecha programada',
  tipoom:'Tipo de orden de montaje',nroom:'N.º de orden de montaje',
  fechaejecucionumd:'Fecha de ejecución UMD',fechaejecutacionumd:'Fecha de ejecución UMD',estadoumd:'Estado UMD',
  clientescaptados:'Clientes captados',obscaptacionclientes:'Observaciones de captación de clientes',
  estadocaptacionclientes:'Estado de captación de clientes',
  estadoexpventas:'Estado del expediente',estadoinspeccionventas:'Estado de la inspección',
  memoenvioindividualgt:'Memorando individual de envío a Gerencia Técnica'
 };
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
 // El memorando individual pertenece a Montaje, no a Inspección.
 const memoIndividual=curso==='OM5'&&stage===3?head(all,'MemoEnvioIndividualGT'):null;
 if(memoIndividual)grouped.add(memoIndividual);
 const out=[];
 hs.forEach(h=>{
  if(key(h)==='item'||grouped.has(h))return;
  let value=displayRow[h]??'';
  if(curso==='UIA'&&!rid&&key(h)==='estadoactual')value='Pendiente';
  const readonlyMemo=curso==='OM5'&&key(h)==='memoenviogtmasivo';
  out.push(`<label class="hd-ampl-label"><span>${safe(uiLabels[key(h)]||sheet(curso).etiquetas?.[key(h)]||h)}</span>${fieldInput(h,value,editable)}</label>`);
 });
 if(stage===0||curso==='UIA'){
  out.push('<section class="hd-ampl-doc-group"><h4>Solicitudes</h4><div class="hd-ampl-doc-list" id="amplRequests"></div></section>');
  if(curso==='OM5')out.push('<section class="hd-ampl-doc-group hd-om5-resolutions"><div class="hd-om5-section-head"><h4>Resoluciones</h4></div><div class="hd-ampl-doc-list" id="amplResolutions"></div></section>');
 }
 if(curso==='UIA')out.push('<section class="hd-ampl-doc-group"><h4>Memorandos GC — sin fecha</h4><div class="hd-ampl-doc-list" id="amplMemosGC"></div></section>');
 if(curso==='OM5'&&stage===1)out.push('<section class="hd-ampl-doc-group"><h4>Observaciones al Expediente</h4><div class="hd-ampl-doc-list" id="amplObsExp"></div></section>');
 if(curso==='OM5'&&stage===2)out.push('<section class="hd-ampl-doc-group"><h4>Observaciones de inspección de campo</h4><div class="hd-ampl-doc-list" id="amplObsInsp"></div></section>');
 if(memoIndividual){
  out.push('<section class="hd-ampl-doc-group hd-ampl-memo-individual"><h4>Memorando de envío individual a la Gerencia Técnica</h4><div class="hd-ampl-doc-list"><div class="hd-ampl-doc hd-ampl-single-doc"><label class="hd-ampl-doc-cell"><span>Número de memorando</span>'+fieldInput(memoIndividual,displayRow[memoIndividual]??'',editable)+'</label>'+inlineUpload(memoIndividual,editable)+'</div></div></section>');
 }
 ui.innerHTML=out.join('');
 // REV61: ingreso OM5: agrupar los campos ya existentes sin clonar inputs,
 // sin cambiar nombres de columna, datos, validaciones ni guardado.
 if(isOM5Registro){
  const groups=[
   {title:'Datos generales del expediente',icon:'fa-clipboard-list',fields:['Solicitante','NombreSector','Suministro','TipoSuministro','IniciativaObra','ObservacionesObras']},
   {title:'Ubicación y datos comerciales',icon:'fa-location-dot',fields:['UUEE','Departamento','Provincia','Distrito','Alimentador','ClientesCaptar']}
  ];
  const firstLabel=ui.querySelector('.hd-ampl-label');
  for(const group of groups){
   const sectionEl=document.createElement('section');sectionEl.className='hd-om5-form-section';
   sectionEl.innerHTML='<h3><i class="fa-solid '+group.icon+'" aria-hidden="true"></i> '+group.title+'</h3><div class="hd-om5-field-grid"></div>';
   const dest=sectionEl.querySelector('.hd-om5-field-grid');
   for(const wanted of group.fields){
    const label=[...ui.querySelectorAll(':scope > .hd-ampl-label')].find(el=>key(el.querySelector('[data-k]')?.dataset.k)===key(wanted));
    if(label)dest.appendChild(label);
   }
   if(dest.children.length){
    if(group===groups[0])ui.insertBefore(sectionEl,ui.firstElementChild);
    else{const requests=ui.querySelector('#amplRequests')?.closest('.hd-ampl-doc-group');if(requests)ui.insertBefore(sectionEl,requests);else ui.appendChild(sectionEl);}
   }
  }
 }


 // REV76: orden visual aprobado para etapas 2-5, sin alterar el campo
 // real data-k, el orden de las columnas de Sheets ni la lógica de guardado.
 // Los controles se MUEVEN (no se clonan); cada campo sigue siendo único.
 if(curso==='OM5' && stage>0){
  const originalLabels=[...ui.querySelectorAll(':scope > .hd-ampl-label')];
  const remaining=new Set(originalLabels);
  const originalDocs=[...ui.querySelectorAll(':scope > .hd-ampl-doc-group')];
  const rendered=[];
  function section(title,icon,labels,columns=3){
   if(!labels.length)return;
   const node=document.createElement('section');
   node.className='hd-om5-form-section hd-om5-stage-section hd-om5-ordered-section';
   const heading=document.createElement('h3');
   const i=document.createElement('i');i.className='fa-solid '+icon;i.setAttribute('aria-hidden','true');
   heading.append(i,document.createTextNode(' '+title));
   const grid=document.createElement('div');grid.className='hd-om5-field-grid';
   grid.style.setProperty('--hd-om5-stage-cols',String(columns));
   labels.forEach(label=>{remaining.delete(label);grid.appendChild(label);});
   node.append(heading,grid);rendered.push(node);
  }
  function take(...names){
   const wanted=new Set(names.map(key));
   return originalLabels.filter(label=>remaining.has(label)&&wanted.has(key(label.querySelector('[data-k]')?.dataset.k)));
  }
  function matches(re){
   return originalLabels.filter(label=>remaining.has(label)&&re.test(key(label.querySelector('[data-k]')?.dataset.k||'')));
  }
  function group(name){const el=originalDocs.find(node=>!!node.querySelector('#'+name));if(el)rendered.push(el);}
  if(stage===1){
   // Observaciones GC 1-3 aparecen antes del estado de expediente.
   group('amplObsExp');
   section('Estado del expediente','fa-clipboard-check',take('EstadoExpVentas'),1);
  }else if(stage===2){
   // Observaciones, infraestructura y por último respuesta/estado.
   group('amplObsInsp');
   section('Metrado de redes a implementar','fa-network-wired',matches(/^(redes|postes|sed)/),3);
   section('Memorando de respuesta al solicitante','fa-clipboard-check',
    [...take('MemoRespuestaGC','MemoRespGC','MemoInspeccionRespuestaGC','MemoRespuestaInspeccionGC'),
     ...take('EstadoInspeccionVentas')],2);
  }else if(stage===3){
   // Memorando individual con su archivo, masivo, modalidad, fechas, OM y estado.
   const individual=originalDocs.find(node=>node.classList.contains('hd-ampl-memo-individual'));
   if(individual)rendered.push(individual);
   section('Memorandos a Gerencia Técnica','fa-envelope',
    take('MemoEnvioGTmasivo','Modalidad'),3);
   // Etapa 4: cuatro campos en una sola fila, conservando sus columnas reales.
   // La base vigente usa 'FechaEjecutacionUMD' (ortografía histórica).
   // Se aceptan ambas denominaciones sin cambiar los datos de Sheets.
   const programa=take('FechaProgramadaEjecucionUMD','TipoOM','NroOM');
   const ejecucion=take('FechaEjecutacionUMD','FechaEjecucionUMD');
   section('Programación y orden de montaje','fa-calendar-days',
    [...programa,...ejecucion],4);
   section('Ejecución y estado UMD','fa-screwdriver-wrench',
    take('EstadoUMD'),1);
  }else if(stage===4){
   section('Captación de clientes','fa-users',take('ClientesCaptados'),1);
   section('Observaciones de captación','fa-pen-to-square',take('ObsCaptacionClientes'),1);
   section('Estado de captación','fa-clipboard-check',take('EstadoCaptacionClientes'),1);
  }
  // No descartar jamás campos nuevos/desconocidos procedentes de la base.
  // Se mantienen en su orden original y en una última sección complementaria.
  if(remaining.size)section('Otros datos de la etapa','fa-list-check',
   originalLabels.filter(label=>remaining.has(label)),3);
  for(const doc of originalDocs)if(!rendered.includes(doc))rendered.push(doc);
  ui.replaceChildren(...rendered);
 }

 if(curso==='OM5'){
  const ay=[...ui.querySelectorAll('[data-k]')].find(el=>key(el.dataset.k)==='memoenviogtmasivo');
  if(ay){ay.readOnly=true;ay.title='Este memorando se actualiza al cambiar de modalidad y guardar el expediente';}
 }

 // REV59: Vista previa del memorando AY al cambiar la modalidad en Montaje.
 // La selección definitiva se vuelve a calcular en el servidor al guardar.
 if(curso==='OM5'&&editable&&rid&&stage===3){
  const fields=[...ui.querySelectorAll('[data-k]')];
  const modalidad=fields.find(el=>key(el.dataset.k)==='modalidad');
  const memo=fields.find(el=>key(el.dataset.k)==='memoenviogtmasivo');
  if(modalidad&&memo)modalidad.addEventListener('change',async()=>{
   const active=registro,chosen=modalidad.value,original=String(active.originalRow[modalidad.dataset.k]||'');
   if(key(chosen)===key(original)){
    memo.value=String(active.originalRow[memo.dataset.k]||'');
    return;
   }
   memo.value='';
   if(!chosen){formAlert('Modalidad sin seleccionar. El memorando masivo quedará vacío al guardar.','info');return;}
   try{
    const r=await api('amplMemoRead');
    if(registro!==active||modalidad.value!==chosen||!ui.contains(memo))return;
    const memos=(r&&r.memorandos)||[];
    const latest=memos.find(m=>key(m.modalidad)===key(chosen));
    memo.value=latest?String(latest.numero||''):'';
    formAlert(latest?'Memorando masivo de la nueva modalidad: '+memo.value+'. Se actualizará al guardar.':
      'La nueva modalidad no tiene memorandos masivos vigentes. La columna AY quedará vacía al guardar.','info');
   }catch(e){
    if(registro===active)formAlert('No se pudo consultar el último memorando. El servidor verificará la modalidad al guardar: '+e.message,'info');
   }
  });
 }
 if(stage===0||curso==='UIA'){docs('sol',editable);if(curso==='OM5')docs('res',editable);}
 if(isNewOM5Entry&&editable){
  const missing=om5MissingColumns_();
  if(missing.length){
   const warning=document.createElement('div');
   warning.className='hd-ampl-schema-warning';warning.setAttribute('role','alert');
   warning.textContent='No se puede registrar todavía: la respuesta de Apps Script no incluye los campos necesarios ('+missing.slice(0,8).join(', ')+(missing.length>8?'…':'')+'). Se ha bloqueado Guardar para proteger los expedientes. No cambies nombres de columnas en Google Sheets.';
   ui.prepend(warning);
  }
 }
 if(curso==='UIA')docs('memo',editable);
 // REV101: ordenar el formulario NUEVO UIA como los 18 campos del reporte.
 // Reubica los controles originales, nunca los clona; conserva data-k, adjuntos y guardado.
 // Item/Ítem es un identificador interno: no se muestra en el formulario.
 if(curso==='UIA'&&!rid){
  const labels=[...ui.querySelectorAll(':scope > .hd-ampl-label')];
  const pending=new Set(labels);
  const groups=[];
  const norm=s=>key(s);
  function pick(...aliases){
   const wanted=new Set(aliases.map(norm));
   const found=labels.find(el=>pending.has(el)&&wanted.has(norm(el.querySelector('[data-k]')?.dataset.k)));
   if(found)pending.delete(found);
   return found||null;
  }
  function namedGroup(title,icon,items,colCount=2){
   const content=items.filter(Boolean);
   if(!content.length)return;
   const el=document.createElement('section');
   el.className='hd-uia-new-section';
   const h=document.createElement('h3');
   const i=document.createElement('i');i.className='fa-solid '+icon;i.setAttribute('aria-hidden','true');
   h.append(i,document.createTextNode(' '+title));
   const grid=document.createElement('div');grid.className='hd-uia-new-grid';
   grid.style.setProperty('--uia-columns',colCount);
   content.forEach(node=>grid.appendChild(node));
   el.append(h,grid);groups.push(el);
  }
  function docGroupNode(id){return ui.querySelector('#'+id)?.closest('.hd-ampl-doc-group');}
  namedGroup('Datos generales del expediente','fa-clipboard-list',[
   pick('Nombre'),pick('Direccion','Dirección','Direcciòn')
  ]);
  const solicitudes=docGroupNode('amplRequests');if(solicitudes)groups.push(solicitudes);
  namedGroup('Ubicación y datos técnicos','fa-location-dot',[
   pick('Departamento'),pick('Provincia'),pick('Distrito'),
   pick('SED Referencia','SEDReferencia'),pick('N° Clientes','Nº Clientes','N Clientes','NroClientes')
  ],3);
  const memos=docGroupNode('amplMemosGC');if(memos)groups.push(memos);
  namedGroup('Montaje y estado','fa-screwdriver-wrench',[
   pick('Tipo de OM','TipoOM'),pick('Nro OM','NroOM','N° OM'),
   pick('FechaEjecutadoUMD','Fecha Ejecutado UMD','FechaEjecutacionUMD'),
   pick('Estado Actual','EstadoActual')
  ]);
  namedGroup('Captación de clientes','fa-users',[
   pick('Clentes Captados','Clientes Captados','ClientesCaptados'),
   pick('Estado Captación Clientes','EstadoCaptacionClientes'),
   pick('Observación Captación Clientes','ObservacionCaptacionClientes','ObsCaptacionClientes')
  ]);
  // Si la hoja posee columnas extra, conservarlas y evitar pérdida silenciosa.
  if(pending.size)namedGroup('Otros datos del expediente','fa-list-check',labels.filter(el=>pending.has(el)));
  ui.replaceChildren(...groups);
 }

 if(curso==='OM5'&&stage===1)docs('obsExp',editable);
 if(curso==='OM5'&&stage===2)docs('obsInsp',editable);
 // Los archivos de cada solicitud/resolución/memorando se muestran junto a su campo.
 // La sección inferior solo conserva archivos que no tienen ubicación en las etapas
 // y la carga adicional para usuarios con permiso de edición.
 renderAttachments();
 if(editable)queueMicrotask(refreshInlinePreviews);
 // Primera apertura de la etapa: capturar los valores reales del formulario.
 // Al volver a una etapa, NO se sobrescribe su referencia inicial.
 if(editable&&!Object.prototype.hasOwnProperty.call(registro.baselines,String(stage)))
  registro.baselines[String(stage)]=snapshotStage_();
 // REV92: la misma ficha de cinco etapas para consultas desde OM5 y Búsqueda Inteligente.
 // Los campos se generan deshabilitados en fieldInput/compactNumberInput; no hay
 // Guardar, Agregar, Eliminar, Adjuntar ni llamadas de escritura en esta ruta.
 // Mantener únicamente las vistas previas y descargas de documentos guardados.
 const panel=$('amplModal')?.querySelector('.hd-ampl-panel');
 const footer=panel?.querySelector(':scope > .hd-ampl-controls:last-child');
 const closeButton=footer?.querySelector('.hd-ampl-cancel');
 const saveButton=$('amplSave');
 if(closeButton){
  closeButton.innerHTML=editable?'<i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancelar':'<i class="fa-solid fa-xmark" aria-hidden="true"></i> Salir';
  closeButton.setAttribute('aria-label',editable?'Cancelar edición':'Salir de la consulta');
 }
 if(saveButton){
  saveButton.hidden=!editable;
  saveButton.style.setProperty('display',editable?'':'none',editable?'':'important');
  saveButton.disabled=!!(editable&&isNewOM5Entry&&om5MissingColumns_().length);
  saveButton.textContent='Guardar';
 }
 if(footer)footer.classList.toggle('hd-om5-readonly-footer',isOM5Consulta);
 $('amplModal').hidden=false;
 const note=$('amplFormStatus');if(note){note.textContent='';note.hidden=true;note.dataset.type='info';}

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
/* REV53: adjuntos dentro de su etapa y campo, sin alterar la hoja OM5.
   La asociación se hace por el nombre REAL de columna (no por posición visual). */
function attachmentsFor(fieldName){
 if(!registro?.id)return [];
 return (sheet(registro.mod).adjuntos||[]).filter(x=>String(x.expedienteId)===String(registro.id)&&key(x.campo)===key(fieldName));
}
function isPhoneCamera(){
 const ua=navigator.userAgent||'';
 return /Android.*Mobile|iPhone|iPod|Windows Phone|Mobile.*Firefox/i.test(ua);
}
function inlineUpload(fieldName,editable){
 const files=attachmentsFor(fieldName);
 const pending=Object.values(registro?.pendingFiles||{}).flat().filter(x=>key(x.campo)===key(fieldName));
 const pendingHtml=pending.length?'<div class="hd-ampl-pending">Pendiente de guardar: '+pending.map(x=>safe(x.file.name)).join(', ')+'</div>':'';
 const isNewUIA=curso==='UIA'&&editable&&(!registro?.id||registro.postSaveNew);
 const isUIAPostSave=curso==='UIA'&&editable&&!!registro?.id&&!!registro.postSaveNew;
 const isExec=curso==='OM5'||isNewUIA;
 // REV94: solo el editor de un expediente OM5 existente. Nuevo/Consulta/UIA intactos.
 const isOM5Edit=isExec&&editable&&!!registro?.id&&!registro.postSaveNew;
 let saved=files.length?'<div class="hd-ampl-attached-files"><strong>Archivos guardados ('+files.length+')</strong>'+files.map(x=>
  '<div class="hd-ampl-file-line"><span title="'+safe(x.nombre)+'">'+safe(x.nombre)+'</span><div class="hd-ampl-file-actions">'+(isExec?
  '<button type="button" aria-label="Ver '+safe(x.nombre)+'" title="Ver archivo" onclick="Ampliaciones.previewSaved(\''+safe(x.id)+'\')"><i class="fa-regular fa-eye" aria-hidden="true"></i></button><button type="button" aria-label="Descargar '+safe(x.nombre)+'" title="Descargar archivo" onclick="Ampliaciones.download(\''+safe(x.id)+'\')"><i class="fa-solid fa-download" aria-hidden="true"></i></button>'+(editable?'<button type="button" class="hd-ampl-delete-file" aria-label="Eliminar '+safe(x.nombre)+'" title="Eliminar archivo" onclick="Ampliaciones.removeFile(\''+safe(x.id)+'\')"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>':''):
  '<button type="button" onclick="Ampliaciones.previewSaved(\''+safe(x.id)+'\')">Ver</button><button type="button" onclick="Ampliaciones.download(\''+safe(x.id)+'\')">Descargar</button>'+(editable?'<button type="button" class="hd-ampl-delete-file" onclick="Ampliaciones.removeFile(\''+safe(x.id)+'\')">Eliminar</button>':''))+'</div></div>').join('')+'</div>':'<span class="hd-ampl-no-attachment">Sin archivo guardado</span>';
 if(!editable)return '<div class="hd-ampl-inline-attachment">'+saved+'</div>';
 if(isOM5Edit||isUIAPostSave)saved=''; // mantener una sola fila compacta al terminar Nuevo expediente UIA
 const camera=isPhoneCamera()? (isExec?'<label class="hd-ampl-camera-label" title="Tomar fotografía" aria-label="Tomar fotografía"><i class="fa-solid fa-camera" aria-hidden="true"></i><input type="file" accept="image/*" capture="environment" data-ampl-upload="'+safe(fieldName)+'" aria-label="Fotografiar documento de '+safe(fieldName)+'"></label>':'<label class="hd-ampl-camera-label">Tomar fotografía (celular)<input type="file" accept="image/*" capture="environment" data-ampl-upload="'+safe(fieldName)+'" aria-label="Fotografiar documento de '+safe(fieldName)+'"></label>'):'';
 const chooser=isExec?'<label class="hd-ampl-choose-file" title="Adjuntar PDF o imagen"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" data-ampl-upload="'+safe(fieldName)+'" aria-label="Adjuntar PDF o imagen a '+safe(fieldName)+'"></label>':'<label class="hd-ampl-choose-file">Adjuntar PDF o imagen<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" data-ampl-upload="'+safe(fieldName)+'" aria-label="Adjuntar archivo a '+safe(fieldName)+'"></label>';
 const button=isExec?'<button type="button" class="hd-ampl-view-selected" '+((isOM5Edit||isUIAPostSave)&&files.length?'data-hd-saved-id="'+safe(files[0].id)+'" ':'')+'data-hd-view-field="'+safe(fieldName)+'" '+((isOM5Edit||isUIAPostSave)&&files.length?'':'disabled ')+'aria-label="Vista previa del archivo seleccionado" title="Selecciona un archivo para visualizarlo"><i class="fa-regular fa-eye" aria-hidden="true"></i></button>':'<button type="button" class="hd-ampl-view-selected" data-hd-view-field="'+safe(fieldName)+'" disabled title="Selecciona un archivo para visualizarlo" aria-label="Ver archivo seleccionado">👁</button>';
 const editChooser=isOM5Edit&&files.length?chooser.replace('title="Adjuntar PDF o imagen"','title="Actualizar archivo (reemplazar el actual)"').replace('fa-file-arrow-up','fa-arrows-rotate').replace('Adjuntar PDF o imagen a ','Reemplazar archivo de '):chooser;
 // REV95: en Editar OM5, nada de nombres ni lista aparte. El tacho elimina SOLO adjuntos.
 // Si un campo tiene varios archivos, cada uno recibe su ojo y tacho, sin mostrar nombres.
 const editTrash=isOM5Edit?files.map(x=>'<button type="button" class="hd-ampl-edit-trash" title="Eliminar archivo adjunto" aria-label="Eliminar adjunto '+safe(x.nombre)+'" onclick="Ampliaciones.removeFile(\''+safe(x.id)+'\')"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>').join(''):'';
 const otherSaved=isOM5Edit?files.slice(1).map(x=>'<button type="button" class="hd-ampl-edit-extra-eye" title="Ver archivo adjunto" aria-label="Ver adjunto '+safe(x.nombre)+'" onclick="Ampliaciones.previewSaved(\''+safe(x.id)+'\')"><i class="fa-regular fa-eye" aria-hidden="true"></i></button>').join(''):'';
 const shownName='Sin archivo';
 return '<div class="hd-ampl-inline-attachment'+(isOM5Edit?' hd-ampl-edit-compact':'')+'">'+saved+editChooser+camera+button+otherSaved+editTrash+(isExec&&!isOM5Edit?'<span class="hd-ampl-local-name" aria-live="polite">'+shownName+'</span>':'')+(isOM5Edit?'':pendingHtml)+'<span class="hd-ampl-local-actions" data-preview-files></span></div>';
}

function docs(kind,editable){
 const g=docGroup(kind),container=g?$(g.id):null;if(!g||!container)return;
 if(!g.rows.length){container.innerHTML='<p class="hd-ampl-schema-warning">La estructura de columnas recibida no contiene los campos esperados para '+safe(g.label)+'. No se ha cambiado ni borrado información. Comprueba que la aplicación lea la base correcta.</p>';return;}
 // En un expediente nuevo OM5 no se solicita una resolución por defecto.
 // En edición se muestran las resoluciones ya existentes; no se pierden datos.
 // REV89: las resoluciones son opcionales SOLO antes de introducirlas.
 // Si hay valores en borradores, no deben volver a ocultarse al reconstruir el formulario.
 const populated=Math.max(0,...g.rows.filter(x=>x.v||x.f||x.obs||attachmentsFor(x.num).length).map(x=>x.i));
 const expanded=(curso==='OM5'&&!registro.id&&registro.stage===0)?Number(registro.expandedDocs?.[kind]||0):0;
 const optionalEmptyRes=kind==='res'&&curso==='OM5'&&!registro.id&&registro.stage===0&&!populated&&!expanded;
 const maxShown=optionalEmptyRes?0:Math.min(g.rows.length,Math.max(1,populated,expanded));
 const rows=g.rows.map(r=>{
  // REV67: numerar el campo, sin repetir un título encima de cada documento.
  // Se conserva el botón de eliminación para documentos ya registrados.
  const numberLabel=(kind==='obsExp'||kind==='obsInsp')
   ?'N.º de memorando GC '+r.i
   :'Número de '+g.label.toLowerCase()+' '+r.i;
  const noteCell=r.note?`<label class="hd-ampl-doc-cell hd-ampl-note"><span>Observación ${r.i}</span>${fieldInput(r.note,r.obs,editable)}</label>`:'';
  const dateCell=r.date?`<label class="hd-ampl-doc-cell hd-ampl-date"><span>Fecha</span>${fieldInput(r.date,r.f,editable)}</label>`:'';
  const remove=registro.id&&editable&&!registro.postSaveNew&&!(curso==='OM5')&&r.v&&['sol','res'].includes(kind)?`<button type="button" class="hd-ampl-remove" onclick="Ampliaciones.deleteDocField('${safe(r.num)}')">Eliminar documento y adjuntos</button>`:'';
  return `<div class="hd-ampl-doc" data-doc="${safe(kind)}" data-num="${r.i}" ${r.i>maxShown?'hidden':''}>
   ${noteCell}
   <label class="hd-ampl-doc-cell"><span>${safe(numberLabel)}</span>${compactNumberInput(r.num,r.v,editable)}</label>
   ${dateCell}
   ${inlineUpload(r.num,editable)}
   ${remove?'<div class="hd-ampl-doc-heading hd-ampl-doc-remove-only">'+remove+'</div>':''}
  </div>`;
 }).join('');
 const visibleCount=Math.min(maxShown,g.rows.length);
 const emptyHint=optionalEmptyRes?'<p class="hd-om5-optional-note" id="amplResEmptyHint">No es necesario registrar resoluciones. Utiliza «Agregar resolución» solo cuando corresponda.</p>':'';
 container.innerHTML=emptyHint+rows+(editable?`<div class="hd-ampl-doc-footer"><button type="button" class="hd-ampl-add" onclick="Ampliaciones.addDoc('${safe(kind)}')" ${visibleCount>=g.max?'disabled':''}>+ Agregar ${safe(g.label.toLowerCase())}</button></div>`:'');
 if(editable)container.querySelectorAll('.hd-ampl-inline-attachment').forEach(syncInlinePreview);
}
function addDoc(kind){
 let rows=[...document.querySelectorAll('[data-doc="'+kind+'"]')],next=rows.find(e=>e.hidden);
 if(!next){update('Se alcanzó el máximo permitido para este tipo.');return;}
 next.hidden=false;
 if(curso==='OM5'&&!registro.id&&registro.stage===0){
  registro.expandedDocs=registro.expandedDocs||{};
  registro.expandedDocs[kind]=Math.max(Number(registro.expandedDocs[kind]||0),Number(next.dataset.num)||0);
 }
 if(kind==='res'){$('amplResEmptyHint')?.remove();}
 const btn=next.parentElement.querySelector('.hd-ampl-add');if(btn)btn.disabled=!rows.some(e=>e.hidden);
 next.querySelector('input[data-k],textarea[data-k]')?.focus();
}
async function deleteDocField(campo){if(!registro?.id||!registro.editable)return;if(!confirm('¿Eliminar '+campo+' y enviar a la papelera TODOS sus adjuntos?'))return;try{let r=await api('amplDeleteDocument',{modulo:curso,expedienteId:registro.id,campo,confirmar:'ELIMINAR_DOCUMENTO'});let rid=registro.id;await refresh(curso);open(rid,registro.stage,true);formAlert('Documento eliminado correctamente; '+r.adjuntos+' adjunto(s) enviados a papelera.','info');}catch(e){formAlert('No se pudo eliminar el documento: '+e.message,'error')}}
function close(){
 if(saving){formAlert('El guardado todavía está en curso. No cierres el formulario.','info');return;}
 if(registro?.editable){
  captureStage();
  if(hasUnsavedChanges_()&&!confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))return;
 }
 $('amplModal').hidden=true;registro=null;
}
function collect(){let result={};$('amplFormBody').querySelectorAll('[data-k]').forEach(e=>{if(e.closest('[data-doc]')?.hidden)return;const fieldName=e.getAttribute('data-k');if(registro?.mod==='UIA'&&key(fieldName)==='tipo')return;result[fieldName]=e.value.trim();});return result;}
/* REV41: guardar conserva abierto el editor y actualiza su versión antes de otro guardado. */
async function save(){
 if(saving)return;
 if(!registro?.editable)return; // Consulta de solo lectura: no ejecutar guardado ni mostrar errores de edición.
 const button=$('amplSave');
 let savedOnServer=false,serverResult=null;
 try{
  $('amplFormBody').querySelectorAll('.hd-ampl-invalid').forEach(el=>{el.classList.remove('hd-ampl-invalid');el.removeAttribute('aria-invalid');});
  captureStage();
  const payload={...Object.assign({},...Object.values(registro.drafts))},mod=registro.mod,isNew=!registro.id;
  const validation=validateBeforeSave(payload,mod,isNew);
  if(validation){formAlert(validation.message,'error',validation.field);return;}
  const currentStage=registro.stage;
  const fileGroups=Object.entries(registro.pendingFiles).flatMap(([stage,arr])=>(arr||[]).map(item=>({...item,stage:Number(stage)})));
  // REV94: registrar adjuntos anteriores ANTES de subir los nuevos, solo en Editar OM5.
  const replaceIds=(mod==='OM5'&&!isNew&&!registro.postSaveNew)?new Map(fileGroups.map(({campo})=>[key(campo),(sheet(mod).adjuntos||[]).filter(a=>String(a.expedienteId)===String(registro.id)&&key(a.campo)===key(campo)).map(a=>String(a.id))])):new Map();
  for(const {file} of fileGroups)if(file.size>10*1024*1024)throw Error('Archivo mayor de 10 MB: '+file.name);
  saving=true;if(button){button.disabled=true;button.textContent='Guardando…';}
  update('Guardando expediente. Permanece en este formulario.');
  const r=await api('amplSave',{modulo:mod,expedienteId:registro.id,version:registro.version,datos:JSON.stringify(payload)});
  if(!r||!r.expedienteId)throw Error('El servidor no confirmó el ID del expediente. Consulta la lista antes de reintentar.');
  savedOnServer=true;serverResult=r;
  // Actualizar el token de control de concurrencia antes de otra edición.
  registro.id=r.expedienteId;registro.version=r.version;
  const failed=[],replaceWarnings=[];
  const replacedFields=new Set();
  for(let i=0;i<fileGroups.length;i++){
   const {campo,file,stage}=fileGroups[i];update('Guardado confirmado. Subiendo archivo '+(i+1)+' de '+fileGroups.length+': '+file.name);
   try{
    await api('amplUpload',{modulo:mod,expedienteId:r.expedienteId,campo,nombre:file.name,base64:await fileToBase64(file)});
    // Retirar el adjunto anterior SOLO tras confirmación de la subida.
    if(!replacedFields.has(key(campo))){
     replacedFields.add(key(campo));
     for(const oldId of (replaceIds.get(key(campo))||[])){
      try{await api('amplDeleteAdj',{adjuntoId:oldId,confirmar:'SI'});}
      catch(e){replaceWarnings.push('No se pudo retirar el archivo anterior de '+campo+': '+e.message);}
     }
    }
   }catch(e){failed.push({campo,file,stage,error:e.message});}
  }
  const note=mod==='UIA'?'GRABACIÓN SATISFACTORIA':'Expediente guardado correctamente.'+(fileGroups.length?' '+(fileGroups.length-failed.length)+' archivo(s) adjuntados.':'');
  // Leer datos frescos sin cerrar la ventana; la versión y los adjuntos quedan actualizados.
  let refreshed=false;
  try{
   const fresh=await api('amplRead',{modulo:mod});
   if(!fresh||!Array.isArray(fresh.registros))throw Error('No se pudo actualizar la lista.');
   STORE[mod]=normalizeReadData_(mod,fresh);refreshed=true;
   NAV[mod].selected=r.expedienteId;
   if(activeAmplModule()===mod){curso=mod;render(mod);}
  }catch(e){
   // El guardado ya está confirmado: nunca reenviarlo automáticamente.
   update(note+' No se pudo refrescar la lista: '+e.message);
  }
  if(refreshed){
   curso=mod;
   open(r.expedienteId,currentStage,true,null,null,null,null,isNew||registro.postSaveNew);
  }else{
   // Mantener el editor activo y su versión; descartar los cambios ya guardados.
   registro.row={...registro.row,...payload};registro.originalRow={...registro.row};registro.drafts={};
   registro.pendingFiles={};
  }
  if(failed.length||replaceWarnings.length){
   const detail=failed.map(x=>x.file.name+': '+x.error).concat(replaceWarnings).join('\n');
   formAlert((mod==='UIA'?'Expediente registrado, pero faltan archivos por adjuntar.':note)+' Revisa los archivos indicados antes de volver a guardar; no repitas una subida confirmada:\n'+detail,'error');
  }else{
   formAlert(mod==='UIA'?'GRABACIÓN SATISFACTORIA':note+' Puedes continuar editando cualquier etapa o pulsar Cerrar.','info');
  }
  if(r.advertencias?.length)formAlert(note+'\nAdvertencias: '+r.advertencias.join(' | '),'info');
 }catch(e){
  const msg=(e&&e.message)||String(e);
  formAlert((savedOnServer?'El expediente se guardó, pero ocurrió un problema adicional; no repitas el guardado sin verificarlo. ':'No se pudo guardar. ')+msg,'error');
 }finally{saving=false;if(button){button.disabled=false;button.textContent='Guardar';}}
}
/* Los adjuntos mostrados en las fichas de cada etapa NO se vuelven a listar abajo.
   Se conserva acceso a adjuntos de otros campos y la carga adicional en edición. */
function inlineAttachmentFields(mod){
 const hs=sheet(mod).headers;
 const names=new Set();
 const add=(prefix,count)=>{for(let i=1;i<=count;i++){const h=field(hs,prefix,i);if(h)names.add(key(h));}};
 add('NroSolicitud',MODS[mod].sol);
 if(mod==='OM5'){
  add('NroResolución',2);
  add('MemoObsGC',3);
  add('MemoObsInspGC',3);
  const individual=head(hs,'MemoEnvioIndividualGT');if(individual)names.add(key(individual));
 }else add('MemorandoGC',5);
 return names;
}
function renderAttachments(){
 const box=$('amplExistingAttachments'),divider=$('amplAttachmentsDivider');
 if(!box||!registro)return;
 const attachments=registro.id?(sheet(registro.mod).adjuntos||[]).filter(x=>String(x.expedienteId)===String(registro.id)):[];
 const inline=inlineAttachmentFields(registro.mod);
 const other=attachments.filter(x=>!inline.has(key(x.campo)));
 const otherHtml=other.length?'<h4>Otros archivos vinculados al expediente</h4>'+other.map(x=>
  '<div class="hd-ampl-attach"><span title="'+safe(x.nombre)+'">'+safe(x.nombre)+' ('+safe(x.campo)+')</span><button type="button" onclick="Ampliaciones.previewSaved(\''+safe(x.id)+'\')">Vista previa</button><button type="button" onclick="Ampliaciones.download(\''+safe(x.id)+'\')">Descargar</button>'+
  (registro.editable?'<button type="button" onclick="Ampliaciones.removeFile(\''+safe(x.id)+'\')">Eliminar</button>':'')+'</div>'
 ).join(''):'';
 // No mostrar una segunda lista de Solicitudes, Resoluciones o Memorandos:
 // su consulta, descarga y eliminación ya están disponibles junto al campo.
 // Adjuntar documentos se realiza desde el campo correspondiente.
 // El listado inferior solo se utiliza para archivos heredados u otros campos.
 box.innerHTML=otherHtml;
 const show=Boolean(otherHtml);
 box.hidden=!show;
 if(divider)divider.hidden=!show;
}

async function upload(){if(!registro?.id)return;let input=$('amplUploadInput'),campo=$('amplAttachmentField').value;if(!input?.files?.length)return;try{for(let file of input.files){if(file.size>10*1024*1024)throw Error('Archivo mayor de 10 MB: '+file.name);let b64=await fileToBase64(file);await api('amplUpload',{modulo:curso,expedienteId:registro.id,campo,nombre:file.name,base64:b64});}await refresh(curso);registro.row=sheet(curso).registros.find(r=>id(r)===registro.id);renderAttachments();formAlert('Archivos subidos correctamente.','info');}catch(e){formAlert('Error al subir archivo: '+e.message,'error')}}
function fileToBase64(file){return new Promise((resolve,reject)=>{let r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('No se pudo leer archivo'));r.readAsDataURL(file)});}
async function download(aid){try{let parts=[],r;for(let i=0;;i++){r=await api('amplPreview',{adjuntoId:aid,parte:i});let bin=atob(r.base64),ar=new Uint8Array(bin.length);for(let j=0;j<bin.length;j++)ar[j]=bin.charCodeAt(j);parts.push(ar);if(i+1>=r.total)break;}let blob=new Blob(parts,{type:r.mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.nombre;a.target='_blank';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){update('No se pudo recuperar el adjunto: '+e.message)}}
async function removeFile(aid){if(!confirm('¿Enviar este archivo a papelera de Google Drive?'))return;try{await api('amplDeleteAdj',{adjuntoId:aid,confirmar:'SI'});captureStage();const activeStage=registro.stage,activeId=registro.id,canEdit=registro.editable,drafts=registro.drafts,pending=registro.pendingFiles;await refresh(curso);open(activeId,activeStage,canEdit,drafts,pending);formAlert('Archivo adjunto eliminado correctamente.','info')}catch(e){formAlert('No se pudo eliminar el archivo: '+e.message,'error')}}
async function removeExp(){let mod=curso,row=sheet(mod).registros.find(r=>id(r)===NAV[mod].selected);if(!row)return update('Selecciona un expediente.');if(!confirm('¿Eliminar expediente Ítem '+get(row,sheet(mod).headers,'Item')+' y enviar sus archivos a papelera?'))return;try{await api('amplDelete',{modulo:mod,expedienteId:id(row),confirmar:'ELIMINAR'});NAV[mod].selected='';await refresh(mod);update('Expediente eliminado correctamente.');alert('Expediente eliminado correctamente.');}catch(e){update('No se pudo eliminar el expediente: '+e.message);alert('No se pudo eliminar el expediente: '+e.message)}}

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
  const first=await api('amplPreview',{adjuntoId:aid,parte:0});
  if(t!==previewGeneration)return;
  if(!first?.base64)throw Error('Respuesta incompleta del archivo.');
  const total=Number(first.total||1);if(!Number.isInteger(total)||total<1||total>100)throw Error('Número de fragmentos inválido.');
  const parts=new Array(total);let info=first,done=0;
  function collect(p,i){
   if(!p?.base64||Number(p.parte)!==i)throw Error('Fragmento incompleto: '+i);
   const b=atob(p.base64),a=new Uint8Array(b.length);for(let j=0;j<b.length;j++)a[j]=b.charCodeAt(j);parts[i]=a;done++;
   const status=$('hdAmplPreviewBody');if(status&&t===previewGeneration)status.textContent='Descargando archivo: '+Math.round(done*100/total)+' %';
  }
  collect(first,0);let next=1;
  // Descarga de tres fragmentos a la vez: reduce las esperas sin saturar Drive.
  await Promise.all(Array.from({length:Math.min(3,total-1)},async()=>{
   while(next<total){const i=next++;const p=await api('amplPreview',{adjuntoId:aid,parte:i});if(t!==previewGeneration)return;collect(p,i);}
  }));
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
  const img=document.createElement('img');img.alt='Vista previa: '+name;img.decoding='async';img.src=url;img.className='hd-ampl-preview-image';body.appendChild(img);return;
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
/* REV71: vista previa visible del archivo elegido ANTES de guardar.
   Funciona en cualquier etapa; también recupera selecciones pendientes al volver
   a una etapa, sin confundirlas con los adjuntos ya guardados. */
function selectedFileFor(fieldName,container){
 const inputs=[...(container?.querySelectorAll('input[data-ampl-upload]')||[])];
 for(const input of inputs){if(input.files?.length)return input.files[0];}
 const pending=(registro?.pendingFiles?.[registro.stage]||[]).find(x=>key(x.campo)===key(fieldName));
 return pending?.file||null;
}
function syncInlinePreview(container){
 if(!container)return;
 const button=container.querySelector('.hd-ampl-view-selected');if(!button)return;
 const fieldName=button.getAttribute('data-hd-view-field');
 const file=selectedFileFor(fieldName,container);
 const savedId=button.getAttribute('data-hd-saved-id');
 button.disabled=!file&&!savedId;
 if(!button.querySelector('i'))button.textContent='👁';
 button.setAttribute('aria-label',file?'Ver archivo seleccionado: '+file.name:savedId?'Ver archivo guardado':'Ver archivo seleccionado');
 button.title=file?'Ver archivo seleccionado: '+file.name:savedId?'Ver archivo guardado':'Selecciona un PDF o imagen para visualizarlo';
 const name=container.querySelector('.hd-ampl-local-name');
 if(name){const existing=name.getAttribute('data-hd-existing-name')||name.textContent; if(!name.hasAttribute('data-hd-existing-name'))name.setAttribute('data-hd-existing-name',existing);name.textContent=file?file.name:existing;name.title=name.textContent;}
}
function renderPendingFilePreviews(input){
 const parent=input.closest('.hd-ampl-inline-attachment');
 if(parent){syncInlinePreview(parent);return;}
 const target=input.id==='amplUploadInput'?$('amplExtraPreviews'):null;
 if(!target)return;
 target.replaceChildren();
 for(const file of [...(input.files||[])]){
  const button=document.createElement('button');button.type='button';button.className='hd-ampl-file-preview-btn';
  button.textContent='👁';
  button.setAttribute('aria-label','Ver archivo seleccionado: '+file.name);
  button.title='Ver archivo seleccionado: '+file.name;
  button.onclick=()=>localPreview(file);target.appendChild(button);
 }
}
function refreshInlinePreviews(){
 $('amplFormBody')?.querySelectorAll('.hd-ampl-inline-attachment').forEach(syncInlinePreview);
}
document.addEventListener('change',e=>{
 if(e.target.matches('input[data-ampl-upload],#amplUploadInput'))renderPendingFilePreviews(e.target);
});
document.addEventListener('click',e=>{
 const button=e.target.closest('button[data-hd-view-field]');if(!button)return;
 const file=selectedFileFor(button.getAttribute('data-hd-view-field'),button.closest('.hd-ampl-inline-attachment'));
 if(file)localPreview(file);
 else {const savedId=button.getAttribute('data-hd-saved-id');if(savedId)previewSaved(savedId);}
});
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
async function searchOCR(){let candidates=selectedCandidates();if(!candidates.length)return ocrMessage('Selecciona al menos un dato.');try{await Promise.all(['OM5','UIA'].filter(m=>!STORE[m]).map(async m=>{let d=await api('amplRead',{modulo:m});if(!d||!Array.isArray(d.registros))throw Error('No se pudieron consultar los registros de '+m);STORE[m]=normalizeReadData_(m,d);}));let container=$('amplOCRResults');let html='';for(let mod of ['OM5','UIA']){let items=sheet(mod).registros.map(r=>{let matched=candidates.map(c=>({c,...matchDetail(r,mod,c)})).filter(x=>x.score>=.70);return {r,matched,score:Math.max(0,...matched.map(x=>x.score))};}).filter(x=>x.matched.length).sort((a,b)=>b.score-a.score);html+=`<h3>${mod} (${items.length})</h3>`+(items.length?'':'<p>No se encontraron coincidencias.</p>')+items.map(x=>`<div class="hd-ampl-result"><b>Ítem ${safe(get(x.r,sheet(mod).headers,'Item','Ítem'))}</b><p>${safe(get(x.r,sheet(mod).headers,'Solicitante','Nombre'))}</p><small>${x.matched.map(z=>safe(z.c.value)+' — '+safe(z.where)+' ('+(z.score===1?'exacta':'aproximada')+')').join(', ')}</small><div><button onclick="Ampliaciones.ocrOpen('${mod}','${safe(id(x.r))}')">Abrir ficha</button><button onclick="Ampliaciones.ocrLocate('${mod}','${safe(id(x.r))}')">Localizar en lista</button></div></div>`).join('');}container.innerHTML=html;ocrMessage('Búsqueda realizada en OM5 y UIA.');}catch(e){ocrMessage('Error: '+e.message)}}
function ocrOpen(mod,rid){curso=mod;let sec=$('tab-'+mod.toLowerCase());window.switchTab(mod.toLowerCase());NAV[mod].selected=rid;open(rid,0,false);}
function ocrLocate(mod,rid){window.switchTab(mod.toLowerCase());curso=mod;NAV[mod].filter='';NAV[mod].page=Math.floor(sheet(mod).registros.findIndex(r=>id(r)===rid)/30);NAV[mod].selected=rid;render(mod);}
// Corrección de arranque: no referenciar funciones inexistentes.
// Mantener intactas las funciones disponibles de OM5, UIA, guardado y adjuntos.
window.Ampliaciones={
  getData:mod=>STORE[mod],
  enter,refresh,select,page,search,open,close,save,switchStage,
  addDoc,deleteDocField,upload,download,previewSaved,localPreview,closePreview,removeFile,removeExp,
  recognize,ocrCancel,searchOCR,ocrOpen,ocrLocate,ocrAddManual,showOCRImage,resetCrop,
  // Estas tres funciones no existen en REV12. No bloquear el arranque.
  excel:()=>{if(typeof window.hdReporteExcel!=='function')return update('El reporte no está disponible.');document.getElementById('hdRepModulo').value=curso;window.hdReporteExcel();},
  summary:()=>{document.getElementById('hdRepModulo').value=curso;window.switchTab('reportes');},
  share:()=>update('El envío por WhatsApp de ampliaciones no está disponible en esta revisión.'),
  reset:()=>{STORE.OM5=null;STORE.UIA=null;ocrCandidates=[];ocrFile=null;ocrCanceled=true;}
};
})();
