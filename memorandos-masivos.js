/* HIDRANDINA_VENTAS REV43 — Memorandos masivos OM5 GC → GT.
   Interfaz aislada: no reemplaza los formularios ni el renderizado existentes. */
(function(){'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const api=(action,data={})=>window.postGateway({action,...data},110000);
let memos=[],items=[],selection=new Set(),modalOpen=false,editId='',busy=false,pdfUrl=null;
const role=()=>{try{return String(currentUser?.tipo||'')}catch(_){return ''}};
const mayEdit=()=>['Administrador','Administrador OM5','Asistente OM5','Operador OM5','Operador Documentos/OM5/UIA','Asistente Documentos/OM5/UIA'].includes(role());
function alertBox(message,type='info'){
 const el=$('hdMemoStatus');if(!el)return;el.textContent=message;el.dataset.kind=type;
}
function setBusy(value){busy=value;const b=$('hdMemoSave');if(b)b.disabled=value;const d=$('hdMemoDelete');if(d)d.disabled=value;}
function currentData(){return window.Ampliaciones?.getData?.('OM5');}
function selectModalidad(){const s=$('hdMemoModalidad');return s?.value||'';}
function associatedCount(id){const n=memos.filter(m=>m.expedientes.some(e=>String(e.id)===String(id))).length;const row=currentData()?.registros?.find(r=>String(r.__HD_ID)===String(id));return n||(!n&&String(row?.MemoEnvioGTmasivo||'').trim()?1:0);}
function renderModalities(){
 const data=currentData();if(!data){alertBox('Primero carga la base OM5.','error');return;}
 const old=selectModalidad();const list=[...new Set(data.registros.map(r=>String(r.Modalidad||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
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
 $('hdMemoHistory').innerHTML=matched.map(m=>'<tr><td>'+esc(m.numero)+'</td><td>'+esc(m.fecha)+'</td><td>'+m.expedientes.length+'</td><td>'+esc(m.asunto)+'</td><td class="hd-memo-actions"><button data-memo-view="'+esc(m.id)+'">Consultar</button>'+(m.archivo?'<button data-memo-pdf="'+esc(m.id)+'">Ver PDF</button>':'')+(mayEdit()?'<button data-memo-edit="'+esc(m.id)+'">Editar</button><button data-memo-remove="'+esc(m.id)+'">Eliminar</button>':'')+'</td></tr>').join('')||'<tr><td colspan="5">Esta modalidad aún no tiene memorandos registrados.</td></tr>';
 $('hdMemoHistory').querySelectorAll('[data-memo-view]').forEach(b=>b.addEventListener('click',()=>viewMemo(b.dataset.memoView)));
 $('hdMemoHistory').querySelectorAll('[data-memo-pdf]').forEach(b=>b.addEventListener('click',()=>showPdf(b.dataset.memoPdf)));
 $('hdMemoHistory').querySelectorAll('[data-memo-edit]').forEach(b=>b.addEventListener('click',()=>editMemo(b.dataset.memoEdit)));
 $('hdMemoHistory').querySelectorAll('[data-memo-remove]').forEach(b=>b.addEventListener('click',()=>removeMemo(b.dataset.memoRemove)));
 $('hdMemoCount').textContent=matched.length+' memorandos de esta modalidad';
}
function resetForm(){editId='';$('hdMemoNumber').value='';$('hdMemoDate').value=(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})();$('hdMemoSubject').value='';$('hdMemoPdf').value='';$('hdMemoSave').textContent='Registrar memorando para seleccionados';$('hdMemoEditNote').textContent='Para registrar un memorando selecciona primero los expedientes de la modalidad.';}
async function load(){const result=await api('amplMemoRead');if(!Array.isArray(result.memorandos))throw Error('Respuesta de memorandos incompleta.');memos=result.memorandos;}
async function reload(){if(busy)return;alertBox('Actualizando memorandos…');try{await load();const current=selectModalidad();renderModalities();if(current)$('hdMemoModalidad').value=current;renderItems();renderMemos();alertBox('Memorandos actualizados correctamente.','success');}catch(e){alertBox('No se pudieron consultar los memorandos: '+e.message,'error');}}
async function open(){
 if(modalOpen)return;
 $('hdMemoModal').hidden=false;modalOpen=true;selection.clear();resetForm();alertBox('Cargando expedientes y memorandos…');
 try{if(!currentData())await window.Ampliaciones.refresh('OM5');await load();renderModalities();renderItems();renderMemos();alertBox('Selecciona la modalidad y los expedientes para registrar un memorando.');}
 catch(e){alertBox('Error al cargar el control: '+e.message,'error');}
}
function close(){if(busy)return;modalOpen=false;$('hdMemoModal').hidden=true;closePdf();}
function viewMemo(id){const m=memos.find(m=>m.id===id);if(!m)return;alertBox('Memorando '+m.numero+' · '+m.fecha+' · '+m.expedientes.length+' expedientes. Ítems: '+m.expedientes.map(x=>x.item).join(', ')+(m.asunto?' · '+m.asunto:''),'info');}
function editMemo(id){const m=memos.find(m=>m.id===id);if(!m)return;if(!mayEdit())return;
 editId=id;$('hdMemoModalidad').value=m.modalidad;renderItems();renderMemos();$('hdMemoNumber').value=m.numero;$('hdMemoDate').value=m.fecha;$('hdMemoSubject').value=m.asunto;$('hdMemoPdf').value='';$('hdMemoSave').textContent='Guardar cambios del memorando';$('hdMemoEditNote').textContent='Editando memorando existente. Su relación con los expedientes no se modifica.';alertBox('Editando '+m.numero+'. Para cambiar sus expedientes elimina y registra nuevamente el memorando.');
}
async function uploadPdf(id,file){
 if(!file)return null;if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw Error('Solo se permite PDF.');if(file.size>10*1024*1024)throw Error('El PDF supera 10 MB.');
 const base64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onerror=()=>reject(Error('No se pudo leer el PDF.'));fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.readAsDataURL(file);});
 return await api('amplMemoPdf',{operacion:'subir',memoId:id,nombre:file.name,base64});
}
async function save(){if(busy||!mayEdit())return;
 const numero=$('hdMemoNumber').value.trim(),fecha=$('hdMemoDate').value,asunto=$('hdMemoSubject').value.trim(),file=$('hdMemoPdf').files[0];
 if(!selectModalidad()||!numero||!fecha){alertBox('Selecciona modalidad, número y fecha del memorando.','error');return;}
 if(!editId&&!selection.size){alertBox('Selecciona al menos un expediente.','error');return;}
 if(!confirm((editId?'¿Guardar los cambios del memorando?':'¿Registrar el memorando y actualizar la columna AY en '+selection.size+' expedientes?')))return;
 setBusy(true);let registered=false;
 try{const payload={operacion:editId?'editar':'agregar',memoId:editId,modalidad:selectModalidad(),numero,fecha,asunto,expedientes:JSON.stringify([...selection])};
  alertBox('Guardando memorando…');const result=await api('amplMemoWrite',payload);registered=true;
  if(file){alertBox('Memorando guardado. Adjuntando PDF…');await uploadPdf(result.memoId,file);}
  // Recargar expedientes para reflejar el último memo y la nueva versión.
  await Promise.all([window.Ampliaciones.refresh('OM5'),load()]);renderModalities();renderItems();renderMemos();resetForm();selection.clear();renderItems();
  alertBox((file?'Memorando guardado y PDF adjuntado correctamente.':'Memorando guardado correctamente.')+(result.antecedentesConservados?' Se conservaron '+result.antecedentesConservados+' memorandos anteriores de la columna AY.':''),'success');
 }catch(e){alertBox((registered?'El memorando se guardó, pero quedó pendiente el PDF o la actualización visual. No vuelvas a registrarlo sin consultar el historial. ':'No se pudo guardar. ')+e.message,'error');}
 finally{setBusy(false);}
}
async function removeMemo(id){if(busy||!mayEdit())return;const m=memos.find(x=>x.id===id);if(!m)return;
 if(!confirm('¿Eliminar el memorando '+m.numero+' de '+m.expedientes.length+' expedientes? La columna AY recuperará el memorando anterior cuando corresponda.'))return;
 setBusy(true);try{await api('amplMemoWrite',{operacion:'eliminar',memoId:id,confirmar:'ELIMINAR_MEMORANDO'});
 await Promise.all([window.Ampliaciones.refresh('OM5'),load()]);renderItems();renderMemos();if(editId===id)resetForm();alertBox('Memorando eliminado correctamente. Se actualizó la columna AY de sus expedientes.','success');
 }catch(e){alertBox('No se pudo eliminar el memorando: '+e.message,'error');}finally{setBusy(false);}
}
function exportExcel(){
 if(!window.XLSX){alertBox('No se cargó la biblioteca de Excel.','error');return;}
 const mod=selectModalidad();if(!mod){alertBox('Selecciona una modalidad para exportar su control.','error');return;}
 const list=memos.filter(m=>normalize(m.modalidad)===normalize(mod));
 const h1=['Memorando GC → GT','Fecha de envío','Modalidad','Asunto','N.º de expedientes','Ítems incluidos','PDF adjunto','Usuario'];
 const rows1=[h1,...list.map(m=>[m.numero,m.fecha,m.modalidad,m.asunto,m.expedientes.length,m.expedientes.map(e=>e.item).join(', '),m.archivo?'Sí':'No',m.usuario])];
 const h2=['Ítem','Solicitante','Nombre del sector','Cantidad memorandos','Último memorando (AY)','Historial completo'];
 const rows2=[h2,...items.map(r=>{const id=String(r.__HD_ID),history=memos.filter(m=>m.expedientes.some(e=>String(e.id)===id));return [r['Ítem']||r.Item||'',r.Solicitante||'',r.NombreSector||'',history.length,r.MemoEnvioGTmasivo||'',history.map(m=>m.numero).join(' / ')];})];
 const wb=window.XLSX.utils.book_new();
 const sh1=window.XLSX.utils.aoa_to_sheet(rows1),sh2=window.XLSX.utils.aoa_to_sheet(rows2);
 sh1['!cols']=[{wch:30},{wch:16},{wch:24},{wch:48},{wch:19},{wch:45},{wch:16},{wch:24}];
 sh2['!cols']=[{wch:12},{wch:29},{wch:43},{wch:20},{wch:31},{wch:65}];
 window.XLSX.utils.book_append_sheet(wb,sh1,'Memorandos');window.XLSX.utils.book_append_sheet(wb,sh2,'Expedientes');
 const file='Control_Memorandos_OM5_'+new Date().toISOString().slice(0,10)+'.xlsx';window.XLSX.writeFile(wb,file);
 alertBox('Se inició la descarga del control de memorandos en Excel.','success');
}
function closePdf(){const frame=$('hdMemoPdfFrame');if(frame)frame.src='about:blank';if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}$('hdMemoPdfPreview').hidden=true;}
async function showPdf(id){try{
 alertBox('Recuperando PDF…');const first=await api('amplMemoPdf',{operacion:'ver',memoId:id,parte:0});if(!first.base64||!Number.isInteger(Number(first.total))||first.total>40)throw Error('PDF demasiado grande o respuesta incompleta.');
 const chunks=new Array(Number(first.total));function decode(p,i){const raw=atob(p.base64),out=new Uint8Array(raw.length);for(let j=0;j<raw.length;j++)out[j]=raw.charCodeAt(j);chunks[i]=out;}
 decode(first,0);let cursor=1;await Promise.all(Array.from({length:Math.min(3,chunks.length-1)},async()=>{while(cursor<chunks.length){let i=cursor++;decode(await api('amplMemoPdf',{operacion:'ver',memoId:id,parte:i}),i);}}));
 closePdf();pdfUrl=URL.createObjectURL(new Blob(chunks,{type:'application/pdf'}));$('hdMemoPdfFrame').src=pdfUrl;$('hdMemoPdfDownload').href=pdfUrl;$('hdMemoPdfDownload').download=first.nombre||'memorando.pdf';$('hdMemoPdfPreview').hidden=false;alertBox('PDF disponible para consulta o descarga.','success');
 }catch(e){alertBox('No se pudo abrir el PDF: '+e.message,'error');}}
function init(){
 const btn=$('hdMemoLaunch');if(!btn)return;
 btn.addEventListener('click',open);$('hdMemoClose').addEventListener('click',close);$('hdMemoRefresh').addEventListener('click',reload);
 $('hdMemoModalidad').addEventListener('change',()=>{selection.clear();resetForm();renderItems();renderMemos();});
 $('hdMemoAll').addEventListener('click',()=>{items.forEach(x=>{const id=String(x.__HD_ID);if(associatedCount(id)<4)selection.add(id);});renderItems();});
 $('hdMemoNone').addEventListener('click',()=>{selection.clear();renderItems();});
 $('hdMemoExport').addEventListener('click',exportExcel);$('hdMemoSave').addEventListener('click',save);$('hdMemoNew').addEventListener('click',()=>{selection.clear();resetForm();renderItems();});$('hdMemoPdfClose').addEventListener('click',closePdf);
 btn.hidden=false; $('hdMemoSave').disabled=!mayEdit(); $('hdMemoNew').disabled=!mayEdit();
}
// El botón se construye en un manejador DOMContentLoaded posterior a este script.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
window.HDMemoMasivos={open,close,reload};
})();
