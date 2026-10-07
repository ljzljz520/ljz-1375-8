const $ = (id) => document.getElementById(id);
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': $('token').value, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  $('status').textContent = response.ok ? `OK ${body.releaseId || ''}` : `ERROR ${response.status}: ${body.error || ''}`;
  $('status').className = response.ok ? 'ok' : 'bad';
  if (!response.ok) throw new Error(body.error);
  return body;
}
function jsonOr(text) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } }
const set = (id, value) => { $(id).value = value ?? ''; };
async function loadPoints() {
  const rows = await api('/api/admin/observation-points'); window._points = rows;
  $('points').innerHTML = `<table><tr><th>ID</th><th>slug</th><th>公开几何</th><th>敏感几何</th><th>名称</th><th>操作</th></tr>${rows.map(p => `<tr>
    <td>${p.id}</td><td>${p.slug}<br>${p.administrative_area||''}</td><td><pre>${jsonOr(p.public_geometry||'')}</pre></td><td><pre>${jsonOr(p.sensitive_geometry||'')}</pre></td><td>${p.translations.zh?.name||''}<br>${p.translations.en?.name||''}</td><td><button onclick="fillPoint(${p.id})">填入编辑</button><button class="danger" onclick="deletePoint(${p.id})">删除</button></td></tr>`).join('')}</table>`;
}
function pointPayload() {
  return {
    slug:$('pSlug').value,
    administrativeArea:$('pArea').value,
    publicGeometry: JSON.parse($('pPublic').value),
    sensitiveGeometry: $('pSensitive').value ? JSON.parse($('pSensitive').value) : null,
    isSensitive:$('pSensitiveFlag').checked,
    translations:{ zh:{name:$('pNameZh').value,accessNote:$('pNoteZh').value,description:''}, en:{name:$('pNameEn').value,accessNote:$('pNoteEn').value,description:''}}
  };
}
async function createPoint() {
  const id=$('pId').value;
  const payload=pointPayload();
  await api(id ? '/api/admin/observation-points/'+id : '/api/admin/observation-points', { method: id?'PUT':'POST', body: JSON.stringify(payload) });
  await refresh();
}
window.fillPoint=(id)=>{const p=window._points.find(x=>x.id===id);set('pId',p.id);set('pSlug',p.slug);set('pArea',p.administrative_area);set('pPublic',p.public_geometry);set('pSensitive',p.sensitive_geometry);$('pSensitiveFlag').checked=!!p.is_sensitive;set('pNameZh',p.translations.zh?.name);set('pNameEn',p.translations.en?.name);set('pNoteZh',p.translations.zh?.access_note);set('pNoteEn',p.translations.en?.access_note);};
async function deletePoint(id) { await api('/api/admin/observation-points/'+id,{method:'DELETE'}); await refresh(); }
async function loadZones() {
  const rows = await api('/api/admin/restriction-zones'); window._zones = rows;
  $('zones').innerHTML = `<table><tr><th>ID</th><th>slug/区间</th><th>真实几何（管理端）</th><th>名称/原因</th><th>操作</th></tr>${rows.map(z => `<tr>
    <td>${z.id}</td><td>${z.slug}<br>${z.effective_start}<br>${z.effective_end}<br>received:${z.received_at}</td><td><pre>${jsonOr(z.geometry||'')}</pre></td><td>${z.translations.zh?.name||''}<br>${z.translations.en?.name||''}</td><td><button onclick="fillZone(${z.id})">填入编辑</button><button class="danger" onclick="deleteZone(${z.id})">删除</button></td></tr>`).join('')}</table>`;
}
function zonePayload() {
  return {
    slug:$('zSlug').value, geometry:JSON.parse($('zGeometry').value),
    effectiveStart:$('zStart').value, effectiveEnd:$('zEnd').value, receivedAt:$('zReceived').value || undefined,
    administrativeArea:$('zArea').value, source:$('zSource').value,
    translations:{zh:{name:$('zNameZh').value,reason:$('zReasonZh').value},en:{name:$('zNameEn').value,reason:$('zReasonEn').value}}
  };
}
async function createZone() {
  const id=$('zId').value;
  const payload=zonePayload();
  await api(id ? '/api/admin/restriction-zones/'+id : '/api/admin/restriction-zones',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
  await refresh();
}
window.fillZone=(id)=>{const z=window._zones.find(x=>x.id===id);set('zId',z.id);set('zSlug',z.slug);set('zArea',z.administrative_area);set('zGeometry',JSON.stringify(z.geometry,null,2));set('zStart',z.effective_start);set('zEnd',z.effective_end);set('zReceived',z.received_at);set('zSource',z.source);set('zNameZh',z.translations.zh?.name);set('zNameEn',z.translations.en?.name);set('zReasonZh',z.translations.zh?.reason);set('zReasonEn',z.translations.en?.reason);};
async function deleteZone(id) { await api('/api/admin/restriction-zones/'+id,{method:'DELETE'}); await refresh(); }
async function loadRecords() {
  const rows = await api('/api/admin/observation-records');
  $('records').innerHTML = rows.map(r => `<pre>ID ${r.id} species=${r.species_id} point=${r.point_id} exact=${jsonOr(r.exact_geometry||'null')} public=${jsonOr(r.public_geometry||'null')}</pre>`).join('');
}
async function correctSpecies() {
  await api(`/api/admin/bird-reports/${$('reportId').value}/correct-species`,{method:'POST',body:JSON.stringify({
    speciesSlug:$('speciesSlug').value, oldLabel:$('oldLabel').value, basis:$('basis').value, lang:'zh'
  })}); await refresh();
}
async function createImage() {
  await api('/api/admin/images',{method:'POST',body:JSON.stringify({
    url:$('iUrl').value,birdReportId:$('iReportId').value ? Number($('iReportId').value) : null,
    speciesIds:$('iSpeciesIds').value.split(',').map(Number).filter(Boolean),
    metadata:{camera:'manual',exposure:'unknown'},
    translations:{zh:{altText:$('iAltZh').value,caption:$('iAltZh').value},en:{altText:$('iAltEn').value,caption:$('iAltEn').value}}
  })}); await refresh();
}
async function reschedule() {
  await api(`/api/admin/events/${$('eId').value}/reschedule`,{method:'POST',body:JSON.stringify({startAt:$('eStart').value,endAt:$('eEnd').value,reason:$('eReason').value})}); await refresh();
}
async function refresh() { await Promise.all([loadPoints(),loadZones(),loadRecords()]); }
$('token').addEventListener('change', refresh);
refresh();
