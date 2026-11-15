/* HIDRANDINA_VENTAS REV47 — Memorandos masivos OM5 GC → GT.
   Interfaz aislada: no reemplaza los formularios ni el renderizado existentes. */
(function(){'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const api=(action,data={})=>window.postGateway({action,...data},110000);
let memos=[],items=[],selection=new Set(),modalOpen=false,editId='',busy=false,pdfUrl=null,localPdfUrl=null,serverReady=false;
const role=()=>{try{const u=(typeof currentUser!=='undefined'?currentUser:window.currentUser);return String(u?.tipo||u?.rol||'').trim()}catch(_){return ''}};
const mayEdit=()=>['Administrador','Administrador OM5','Asistente OM5','Operador OM5','Operador Documentos/OM5/UIA','Asistente Documentos/OM5/UIA'].includes(role());
// Revalidar los permisos al abrir el módulo: durante DOMContentLoaded la sesión puede no estar restaurada.
function syncNewButton(){const b=$('hdMemoNew');if(!b)return;const allowed=mayEdit();b.disabled=!allowed;b.title=allowed?'Preparar un memorando nuevo':'Tu perfil solo permite consultar memorandos';}

function alertBox(message,type='info'){
 const el=$('hdMemoStatus');if(!el)return;el.textContent=message;el.dataset.kind=type;
}
function setBusy(value){busy=value;const b=$('hdMemoSave');if(b){b.disabled=value;b.textContent=value?'Guardando memorando…':(editId?'Guardar cambios del memorando':'Grabar memorando para seleccionados');}const d=$('hdMemoDelete');if(d)d.disabled=value;}
function currentData(){return window.Ampliaciones?.getData?.('OM5');}
function serverError(e){const m=String(e?.message||e||'');return /acci[oó]n de ampliaciones desconocida|unknown action/i.test(m)?'El servidor Apps Script publicado no reconoce las operaciones de memorandos (REV43/REV44). Actualiza Codigo.gs, publica una NUEVA VERSIÓN de la implementación actual y comprueba la URL configurada. Las modalidades pueden consultarse, pero no se permite guardar memorandos hasta conectar el servidor actualizado.':m;}
function setServerReady(ready){serverReady=!!ready;const b=$('hdMemoSave');if(b){b.disabled=busy;b.title=serverReady?'Registrar o modificar el memorando':'El servidor no confirmó el módulo de memorandos: pulsa para ver el motivo';}const e=$('hdMemoExport');if(e)e.disabled=false;}
function selectModalidad(){const s=$('hdMemoModalidad');return s?.value||'';}
function associatedCount(id){const n=memos.filter(m=>m.expedientes.some(e=>String(e.id)===String(id))).length;const row=currentData()?.registros?.find(r=>String(r.__HD_ID)===String(id));return n||(!n&&String(row?.MemoEnvioGTmasivo||'').trim()?1:0);}
function renderModalities(){
 const data=currentData();if(!data){alertBox('No hay expedientes OM5 cargados. Actualiza los datos de OM5.','error');return;}
 const old=selectModalidad();const list=[...new Set((data.registros||[]).map(r=>String(r.Modalidad||r.modalidad||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
 $('hdMemoModalidad').innerHTML='<option value="">Selecciona una modalidad</option>'+list.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('');
 if(list.includes(old))$('hdMemoModalidad').value=old;
}
function renderItems(){
 const mod=selectModalidad(),data=currentData();items=mod&&data?data.registros.filter(r=>normalize(r.Modalidad)===normalize(mod)):[];
 selection=new Set([...selection].filter(id=>items.some(r=>String(r.__HD_ID)===id)));
 $('hdMemoTotal').textContent=items.length+' expedientes de la modalidad';
 $('hdMemoItems').innerHTML=items.map(r=>{
  const id=String(r.__HD_ID||''),n=associatedCount(id),full=n>=4;
  return '<tr><td><input type="checkbox" data-memo-pick="'+esc(id)+'" '+(selection.has(id)?'checked':'')+' '+(full?'disabled title="Ya tiene cuatro memorandos"':'')+'></td><td>'+esc(r['Ítem']??r.Item??'')+'</td><td>'+esc(r.Solicitante||'')+'</td><td>'+esc(r.NombreSector||'')+'</td><td>'+n+' / 4</td><td>'+esc(r.MemoEnvioGTmasivo||'')+'</td></tr>';
 }).join('')||'<tr><td colspan="6">Sin expedientes para esta modalidad.</td></tr>';
 $('hdMemoPicked').textContent=selection.size+' seleccionados';
 $('hdMemoItems').querySelectorAll('[data-memo-pick]').forEach(cb=>cb.addEventListener('change',()=>{cb.checked?selection.add(cb.dataset.memoPick):selection.delete(cb.dataset.memoPick);$('hdMemoPicked').textContent=selection.size+' seleccionados';}));
}
function renderMemos(){
 const mod=selectModalidad(),matched=memos.filter(m=>normalize(m.modalidad)===normalize(mod));
 $('hdMemoHistory').innerHTML=matched.map(m=>'<tr><td>'+esc(m.numero)+'</td><td>'+esc(m.fecha)+'</td><td>'+m.expedientes.length+'</td><td>'+esc(m.asunto)+'</td><td class="hd-memo-actions"><button data-memo-view="'+esc(m.id)+'">Consultar</button>'+(m.archivo?'<button data-memo-pdf="'+esc(m.id)+'">Ver archivo</button>':'')+(mayEdit()?'<button data-memo-edit="'+esc(m.id)+'">Editar</button><button data-memo-remove="'+esc(m.id)+'">Eliminar</button>':'')+'</td></tr>').join('')||'<tr><td colspan="5">Esta modalidad aún no tiene memorandos registrados.</td></tr>';
 $('hdMemoHistory').querySelectorAll('[data-memo-view]').forEach(b=>b.addEventListener('click',()=>viewMemo(b.dataset.memoView)));
 $('hdMemoHistory').querySelectorAll('[data-memo-pdf]').forEach(b=>b.addEventListener('click',()=>showPdf(b.dataset.memoPdf)));
 $('hdMemoHistory').querySelectorAll('[data-memo-edit]').forEach(b=>b.addEventListener('click',()=>editMemo(b.dataset.memoEdit)));
 $('hdMemoHistory').querySelectorAll('[data-memo-remove]').forEach(b=>b.addEventListener('click',()=>removeMemo(b.dataset.memoRemove)));
 $('hdMemoCount').textContent=matched.length+' memorandos de esta modalidad';
}
function resetForm(){closeLocalPdf();$('hdMemoCamera').value='';editId='';$('hdMemoNumber').value='';$('hdMemoDate').value=(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})();$('hdMemoSubject').value='';$('hdMemoPdf').value='';$('hdMemoSave').textContent='Grabar memorando para seleccionados';$('hdMemoEditNote').textContent='Para registrar un memorando selecciona primero los expedientes de la modalidad.';}
async function load(){const result=await api('amplMemoRead');if(!Array.isArray(result.memorandos))throw Error('Respuesta de memorandos incompleta.');memos=result.memorandos;setServerReady(true);}
async function reload(){
 if(busy)return;
 alertBox('Actualizando expedientes y memorandos…');
 try{
   await window.Ampliaciones.refresh('OM5');
   renderModalities();renderItems();renderMemos();
 }catch(e){alertBox('No se pudieron actualizar los expedientes OM5: '+e.message,'error');}
 try{
   await load();renderItems();renderMemos();
   alertBox('Expedientes y memorandos actualizados correctamente.','success');
 }catch(e){setServerReady(false);alertBox('Los expedientes OM5 pueden consultarse, pero no se recuperó el historial. '+serverError(e),'error');}
}
async function open(){
 syncNewButton();
 if(modalOpen)return;
 $('hdMemoModal').hidden=false;modalOpen=true;selection.clear();resetForm();memos=[];setServerReady(false);
 alertBox('Cargando las modalidades de OM5…');
 // La lista de modalidades NO depende del historial ni de la acción amplMemoRead.
 try{
   if(!currentData())await window.Ampliaciones.refresh('OM5');
   if(!currentData())throw Error('No fue posible cargar la base OM5.');
   renderModalities();renderItems();renderMemos();
 }catch(e){alertBox('No se pudieron cargar expedientes OM5: '+e.message,'error');return;}
 alertBox('Modalidades disponibles. Consultando historial de memorandos…');
 try{
   await load();renderItems();renderMemos();
   alertBox('Selecciona una modalidad y marca los expedientes para registrar el memorando.','success');
 }catch(e){setServerReady(false);alertBox('Las modalidades ya están disponibles, pero no se puede consultar ni guardar el historial: '+serverError(e),'error');}
}
function close(){if(busy){alertBox('El memorando se está guardando. Espera la confirmación antes de cerrar.','info');return;}modalOpen=false;$('hdMemoModal').hidden=true;closePdf();closeLocalPdf();}
function viewMemo(id){const m=memos.find(m=>m.id===id);if(!m)return;alertBox('Memorando '+m.numero+' · '+m.fecha+' · '+m.expedientes.length+' expedientes. Ítems: '+m.expedientes.map(x=>x.item).join(', ')+(m.asunto?' · '+m.asunto:''),'info');}
function pickedAttachment(){return $('hdMemoCamera')?.files?.[0]||$('hdMemoPdf')?.files?.[0]||null;}
function checkAttachment(f){if(!f)return;const ok=/\.(pdf|jpe?g|png|webp)$/i.test(f.name);if(!ok||!f.size||f.size>10*1024*1024)throw Error('Solo PDF, JPG, PNG o WEBP de hasta 10 MB.');}
function hdMemoFechaInput(fecha){
 if(!fecha)return '';
 const t=String(fecha).trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(t))return t;
 const es=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(es)return es[3]+'-'+es[2].padStart(2,'0')+'-'+es[1].padStart(2,'0');
 const d=new Date(t);
 if(Number.isNaN(d.getTime()))return '';
 // Solo compatibilidad con respuestas antiguas. REV49 normaliza desde Apps Script.
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 const byType=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return byType.year+'-'+byType.month+'-'+byType.day;
}
function editMemo(id){const m=memos.find(m=>m.id===id);if(!m)return;if(!mayEdit())return;
 editId=id;$('hdMemoModalidad').value=m.modalidad;renderItems();renderMemos();$('hdMemoNumber').value=m.numero;$('hdMemoDate').value=hdMemoFechaInput(m.fecha);$('hdMemoSubject').value=m.asunto;$('hdMemoPdf').value='';$('hdMemoCamera').value='';$('hdMemoSave').textContent='Guardar cambios del memorando';$('hdMemoEditNote').textContent='Editando memorando existente. Su relación con los expedientes no se modifica.';alertBox('Editando '+m.numero+'. Para cambiar sus expedientes elimina y registra nuevamente el memorando.');
}
async function uploadAttachment(id,file){
 if(!file)return null;checkAttachment(file);
 const base64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onerror=()=>reject(Error('No se pudo leer el archivo.'));fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.readAsDataURL(file);});
 return await api('amplMemoPdf',{operacion:'subir',memoId:id,nombre:file.name,base64});
}
async function save(){if(busy){alertBox('Ya se está procesando el memorando. Evita enviarlo dos veces.','info');return;}if(!mayEdit()){alertBox('No se puede registrar: tu sesión no tiene permisos de edición OM5. Rol detectado: '+(role()||'sin identificar')+'. Si eres Administrador, cierra sesión e ingresa nuevamente.','error');return;}if(!serverReady){alertBox('No se puede guardar: la conexión actual no confirmó las operaciones de memorandos. Pulsa Actualizar datos. Si sigue igual, publica la Revisión 45 de Codigo.gs sobre tu implementación actual.','error');return;}
 const numero=$('hdMemoNumber').value.trim(),fecha=$('hdMemoDate').value,asunto=$('hdMemoSubject').value.trim(),file=pickedAttachment();
 if(!selectModalidad()||!numero||!fecha){alertBox('Selecciona modalidad, número y fecha del memorando.','error');return;}
 if(!editId&&!selection.size){alertBox('Selecciona al menos un expediente.','error');return;}if(file){try{checkAttachment(file);}catch(e){alertBox(e.message+' No se ha registrado el memorando.','error');return;}}
 if(!confirm((editId?'¿Confirma que desea guardar los cambios del memorando?':'¿Confirma que desea grabar el memorando en los '+selection.size+' expedientes seleccionados?')))return;
 const cantidadSeleccionada=selection.size,esEdicion=!!editId;
 setBusy(true);let registered=false;
 try{const payload={operacion:editId?'editar':'agregar',memoId:editId,modalidad:selectModalidad(),numero,fecha,asunto,expedientes:JSON.stringify([...selection])};
  alertBox('Guardando memorando…');const result=await api('amplMemoWrite',payload);registered=true;
  if(file){alertBox('Memorando guardado. Adjuntando archivo…');await uploadAttachment(result.memoId,file);}
  // Recargar expedientes para reflejar el último memo y la nueva versión.
  await Promise.all([window.Ampliaciones.refresh('OM5'),load()]);renderModalities();renderItems();renderMemos();resetForm();selection.clear();renderItems();
  alertBox((esEdicion?'Cambios del memorando guardados correctamente.':'Memorando grabado correctamente en '+cantidadSeleccionada+' expedientes.')+(file?' Archivo adjunto guardado correctamente.':''),'success');
 }catch(e){alertBox((registered?'El memorando se guardó, pero quedó pendiente el archivo adjunto o la actualización visual. No vuelvas a registrarlo sin consultar el historial. ':'No se pudo guardar. ')+e.message,'error');}
 finally{setBusy(false);}
}
async function removeMemo(id){if(busy||!mayEdit()||!serverReady)return;const m=memos.find(x=>x.id===id);if(!m)return;
 if(!confirm('¿Confirma que desea eliminar el memorando '+m.numero+' de '+m.expedientes.length+' expedientes?'))return;
 setBusy(true);try{await api('amplMemoWrite',{operacion:'eliminar',memoId:id,confirmar:'ELIMINAR_MEMORANDO'});
 await Promise.all([window.Ampliaciones.refresh('OM5'),load()]);renderItems();renderMemos();if(editId===id)resetForm();alertBox('Memorando eliminado correctamente.','success');
 }catch(e){alertBox('No se pudo eliminar el memorando: '+e.message,'error');}finally{setBusy(false);}
}
// REV51: un único Excel profesional de la tabla visible "Historial de memorandos".
// No se crean reportes ni selectores adicionales. Se utiliza el exportador
// institucional existente (Tahoma 11, encabezados azules, bordes y pie de reporte).
function memoReportDate(value){
 const normalized=hdMemoFechaInput(value);
 return normalized?normalized.split('-').reverse().join('/'):String(value||'');
}
async function exportExcel(){
 if(busy){alertBox('Ya se está procesando otra operación.','info');return;}
 const button=$('hdMemoExport');
 const originalText='Descargar Excel';
 try{
  if(typeof hdExcelDescargar_!=='function')throw Error('No se cargó el exportador institucional de Excel.');
  if(!serverReady)throw Error('No se recuperó el historial. Pulsa Actualizar datos.');
  const modalidad=selectModalidad();
  if(!modalidad)throw Error('Selecciona una modalidad para descargar su historial.');
  const registros=memos.filter(m=>normalize(m.modalidad)===normalize(modalidad));
  if(!registros.length){alertBox('Esta modalidad todavía no tiene memorandos registrados.','info');return;}
  // Corresponde a la tabla en pantalla: Memorando, Fecha, Expedientes y Asunto.
  // La columna Acciones contiene botones; no es información exportable.
  const encabezados=['Memorando','Fecha','Expedientes','Asunto'];
  const filas=registros.map(m=>[
   m.numero||'',memoReportDate(m.fecha),Array.isArray(m.expedientes)?m.expedientes.length:0,m.asunto||''
  ]);
  button.disabled=true;
  button.textContent='Preparando Excel…';
  alertBox('Preparando el historial de memorandos en Excel…');
  const safe=modalidad.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,40);
  await hdExcelDescargar_(
   'Historial de memorandos masivos GC a GT — '+modalidad,
   'Ampliaciones OM5 / '+modalidad,
   encabezados,filas,
   'Historial_Memorandos_OM5_'+safe+'_'+new Date().toISOString().slice(0,10)+'.xlsx'
  );
  alertBox('Historial de memorandos descargado correctamente en Excel.','success');
 }catch(e){alertBox('No se pudo descargar el Excel: '+String(e?.message||e),'error');}
 finally{button.disabled=false;button.textContent=originalText;}
}
function closeLocalPdf(){
 const el=$('hdMemoLocalPreview');if(el)el.hidden=true;
 const im=$('hdMemoLocalImage');if(im){im.hidden=true;im.removeAttribute('src');}
 const frame=$('hdMemoLocalFrame');if(frame){frame.hidden=false;frame.src='about:blank';}
 if(localPdfUrl){URL.revokeObjectURL(localPdfUrl);localPdfUrl=null;}
}
function previewLocalPdf(){
 const file=pickedAttachment();if(!file){alertBox('Selecciona un PDF, una imagen o toma una foto primero.','error');return;}
 try{checkAttachment(file);}catch(e){alertBox(e.message,'error');return;}
 closeLocalPdf();localPdfUrl=URL.createObjectURL(file);
 const isImg=/\.(jpe?g|png|webp)$/i.test(file.name);
 $('hdMemoLocalFrame').hidden=isImg;$('hdMemoLocalImage').hidden=!isImg;
 if(isImg)$('hdMemoLocalImage').src=localPdfUrl;else $('hdMemoLocalFrame').src=localPdfUrl;
 $('hdMemoLocalPreview').hidden=false;
 $('hdMemoLocalDownload').href=localPdfUrl;$('hdMemoLocalDownload').download=file.name;
 alertBox('Vista previa local preparada. El archivo aún no ha sido guardado.','success');
 $('hdMemoLocalPreview').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closePdf(){const im=$('hdMemoServerImage');if(im){im.hidden=true;im.removeAttribute('src');}const frame=$('hdMemoPdfFrame');if(frame){frame.hidden=false;frame.src='about:blank';}if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}$('hdMemoPdfPreview').hidden=true;}
async function showPdf(id){try{
 alertBox('Recuperando archivo…');const first=await api('amplMemoPdf',{operacion:'ver',memoId:id,parte:0});if(!first.base64||!Number.isInteger(Number(first.total))||first.total>40)throw Error('Archivo demasiado grande o respuesta incompleta.');
 const chunks=new Array(Number(first.total));function decode(p,i){const raw=atob(p.base64),out=new Uint8Array(raw.length);for(let j=0;j<raw.length;j++)out[j]=raw.charCodeAt(j);chunks[i]=out;}
 decode(first,0);let cursor=1;await Promise.all(Array.from({length:Math.min(3,chunks.length-1)},async()=>{while(cursor<chunks.length){let i=cursor++;decode(await api('amplMemoPdf',{operacion:'ver',memoId:id,parte:i}),i);}}));
 closePdf();const mime=String(first.mime||'application/pdf');pdfUrl=URL.createObjectURL(new Blob(chunks,{type:mime}));const isImg=/^image\//.test(mime);$('hdMemoPdfFrame').hidden=isImg;$('hdMemoServerImage').hidden=!isImg;if(isImg)$('hdMemoServerImage').src=pdfUrl;else $('hdMemoPdfFrame').src=pdfUrl;$('hdMemoPdfDownload').href=pdfUrl;$('hdMemoPdfDownload').download=first.nombre||'memorando.pdf';$('hdMemoPdfPreview').hidden=false;alertBox('Archivo disponible para consulta o descarga.','success');
 }catch(e){alertBox('No se pudo abrir el archivo: '+e.message,'error');}}
// Solo mostrar la opción de cámara en teléfonos. No basta con un ancho de pantalla
// pequeño: una ventana estrecha de PC no debe revelar el control.
function configureMobileCamera(){
 const container=$('hdMemoCameraBox');if(!container)return;
 const ua=String(navigator.userAgent||'');
 const isMobile=Boolean(navigator.userAgentData?.mobile)||/iPhone|iPod|Windows Phone|Android[^)]*Mobile|Android.*Mobile|Mobile.*Android/i.test(ua);
 container.hidden=!isMobile;
 container.style.display=isMobile?'block':'none';
 if(!isMobile&&$('hdMemoCamera'))$('hdMemoCamera').value='';
 const help=$('hdMemoFileHelp');
 if(help)help.textContent=isMobile
  ?'Puedes adjuntar un PDF, elegir una imagen o tomar una fotografía. Solo se adjunta un archivo por memorando.'
  :'Puedes adjuntar un PDF o elegir una imagen. Solo se adjunta un archivo por memorando.';
}
function init(){
 const btn=$('hdMemoLaunch');if(!btn)return;
 configureMobileCamera();
 btn.addEventListener('click',()=>{if(!window.hdPuedeModulo_?.('OM5')){alertBox('No tienes permiso para acceder a OM5.','error');return;}open();});$('hdMemoClose').addEventListener('click',close);$('hdMemoRefresh').addEventListener('click',reload);
 $('hdMemoModalidad').addEventListener('change',()=>{selection.clear();resetForm();renderItems();renderMemos();});
 $('hdMemoAll').addEventListener('click',()=>{items.forEach(x=>{const id=String(x.__HD_ID);if(associatedCount(id)<4)selection.add(id);});renderItems();});
 $('hdMemoNone').addEventListener('click',()=>{selection.clear();renderItems();});
 $('hdMemoExport').addEventListener('click',exportExcel);$('hdMemoSave').addEventListener('click',()=>{save().catch(e=>alertBox('Error al registrar: '+String(e?.message||e),'error'));});$('hdMemoLocalOpen').addEventListener('click',previewLocalPdf);$('hdMemoLocalClose').addEventListener('click',closeLocalPdf);$('hdMemoPdf').addEventListener('change',()=>{closeLocalPdf();$('hdMemoCamera').value='';const f=pickedAttachment();if(f)alertBox('Archivo seleccionado: '+f.name+'. Puedes revisar su vista previa.','info');});$('hdMemoCamera').addEventListener('change',()=>{closeLocalPdf();$('hdMemoPdf').value='';const f=pickedAttachment();if(f)alertBox('Fotografía seleccionada: '+f.name+'. Puedes revisar su vista previa.','info');});$('hdMemoNew').addEventListener('click',()=>{syncNewButton();if(!mayEdit()){alertBox('Tu perfil no tiene permiso para crear memorandos.','error');return;}selection.clear();resetForm();renderItems();alertBox('Formulario listo para grabar un memorando nuevo. Selecciona los expedientes y completa los datos.','info');});$('hdMemoPdfClose').addEventListener('click',closePdf);
 $('hdMemoSave').disabled=false; syncNewButton();
}
// El botón se construye en un manejador DOMContentLoaded posterior a este script.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
window.HDMemoMasivos={open,close,reload};
})();
