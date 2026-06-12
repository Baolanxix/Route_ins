const DEFAULT_FILE = 'Route.kmz';
const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const stepsEl = document.getElementById('steps');
const bigArrowEl = document.getElementById('bigArrow');
const navTextEl = document.getElementById('navText');

let routeSegments = [];
let guidePath = [];
let currentUserPos = null;
let watchId = null;
let traveledPoints = [];
let nextIndex = 0;
let mapCenteredOnce = false;

let userMarker, routeLayer, guideLayer, arrowLayer, traveledLayer, targetMarker, directionMarker;

function setStatus(t){ statusEl.textContent = t; }
function toRad(d){ return d * Math.PI / 180; }
function dist(a,b){
  const R=6371000, dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const s=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function fmt(m){ return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`; }
function bearing(a,b){
  const y=Math.sin(toRad(b.lng-a.lng))*Math.cos(toRad(b.lat));
  const x=Math.cos(toRad(a.lat))*Math.sin(toRad(b.lat))-Math.sin(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.cos(toRad(b.lng-a.lng));
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function turnText(deg){
  if (deg < 22.5 || deg >= 337.5) return 'đi thẳng';
  if (deg < 67.5) return 'chếch phải';
  if (deg < 112.5) return 'rẽ phải';
  if (deg < 157.5) return 'quay phải nhiều';
  if (deg < 202.5) return 'quay lại';
  if (deg < 247.5) return 'quay trái nhiều';
  if (deg < 292.5) return 'rẽ trái';
  return 'chếch trái';
}
function pointAt(a,b,t){ return {lat:a.lat+(b.lat-a.lat)*t, lng:a.lng+(b.lng-a.lng)*t}; }
function mid(a,b){ return pointAt(a,b,0.5); }

const map = L.map('map', { zoomControl:true }).setView([16.047,108.206], 6);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20,
  attribution: 'Ảnh vệ tinh © Esri'
}).addTo(map);
L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20,
  attribution: 'Nhãn © Esri'
}).addTo(map);

function parseCoords(text){
  return text.trim().split(/\s+/).map(x=>{
    const parts=x.split(',').map(Number);
    return {lng:parts[0], lat:parts[1]};
  }).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
}
function parseKml(kml){
  const xml = new DOMParser().parseFromString(kml, 'text/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('File KML bị lỗi, không đọc được.');
  const nodes = [...xml.getElementsByTagName('coordinates')];
  const segs = nodes.map(n=>parseCoords(n.textContent)).filter(s=>s.length>=2);
  if (!segs.length) throw new Error('Không tìm thấy đường LineString trong file KMZ/KML.');
  return segs;
}
async function readFile(fileOrUrl){
  const name = typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.name;
  let buf;
  if (typeof fileOrUrl === 'string') {
    const res = await fetch(fileOrUrl + '?v=' + Date.now());
    if (!res.ok) throw new Error('Không tải được Route.kmz. Kiểm tra file có nằm cùng thư mục index.html không.');
    buf = await res.arrayBuffer();
  } else {
    buf = await fileOrUrl.arrayBuffer();
  }
  if (name.toLowerCase().endsWith('.kmz')) {
    if (!window.JSZip) throw new Error('Thiếu thư viện JSZip, hãy kiểm tra mạng/CDN.');
    const zip = await JSZip.loadAsync(buf);
    const kmlName = Object.keys(zip.files).find(n=>n.toLowerCase().endsWith('.kml'));
    if (!kmlName) throw new Error('KMZ không có file .kml bên trong.');
    return parseKml(await zip.file(kmlName).async('text'));
  }
  return parseKml(new TextDecoder('utf-8').decode(buf));
}

function mergeSegments(segs){
  let unused = segs.map(s=>s.slice());
  let path = unused.shift() || [];
  while(unused.length){
    const end = path[path.length-1];
    let best = {i:0, rev:false, d:Infinity};
    unused.forEach((s,i)=>{
      const d0=dist(end,s[0]), d1=dist(end,s[s.length-1]);
      if(d0<best.d) best={i,rev:false,d:d0};
      if(d1<best.d) best={i,rev:true,d:d1};
    });
    const nxt = unused.splice(best.i,1)[0];
    if(best.rev) nxt.reverse();
    path = path.concat(nxt);
  }
  return path;
}
function totalLen(path){ return path.reduce((s,p,i)=>i?s+dist(path[i-1],p):0,0); }

function projectPointOnSegment(p,a,b){
  // Chiếu GPS lên từng đoạn route để tìm điểm xuất phát thật sự gần nhất,
  // không chỉ tìm đỉnh gần nhất. Dùng hệ tọa độ phẳng cục bộ, đủ chính xác ở phạm vi vài km.
  const lat0 = toRad((a.lat + b.lat + p.lat) / 3);
  const ax = a.lng * Math.cos(lat0), ay = a.lat;
  const bx = b.lng * Math.cos(lat0), by = b.lat;
  const px = p.lng * Math.cos(lat0), py = p.lat;
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const vv = vx*vx + vy*vy;
  const t = vv ? Math.max(0, Math.min(1, (wx*vx + wy*vy) / vv)) : 0;
  const q = pointAt(a,b,t);
  return {point:q, t, distance:dist(p,q)};
}

function buildPathFromNearestPoint(path,pos){
  if (!pos || path.length < 2) return path;
  let best = {seg:1, t:0, point:path[0], distance:Infinity};
  for (let i=1;i<path.length;i++){
    const pr = projectPointOnSegment(pos,path[i-1],path[i]);
    if (pr.distance < best.distance) best = {seg:i, t:pr.t, point:pr.point, distance:pr.distance};
  }

  const before = path.slice(0,best.seg);       // P0 ... P(i-1)
  const after  = path.slice(best.seg);         // Pi ... Pend
  const startPoint = best.point;
  const left = before.concat([startPoint]);
  const right = [startPoint].concat(after);
  const leftLen = totalLen(left);
  const rightLen = totalLen(right);

  // Để đi hết toàn bộ route từ điểm gần GPS nhất với quãng đường lặp nhỏ nhất:
  // đi về phía ngắn hơn trước, rồi quay lại đi hết phía dài hơn.
  // Tổng = chiều dài route + min(khoảng cách tới đầu, khoảng cách tới cuối).
  if (leftLen <= rightLen) {
    return [startPoint].concat(before.slice().reverse(), before, [startPoint], after);
  }
  return [startPoint].concat(after, after.slice(0,-1).reverse(), [startPoint], before.slice().reverse());
}

function optimizePath(pos){
  const p = mergeSegments(routeSegments);
  if (!p.length) return [];
  return buildPathFromNearestPoint(p,pos);
}

function closestIndex(path, pos){
  let best=0, d=Infinity;
  path.forEach((p,i)=>{const x=dist(pos,p); if(x<d){d=x; best=i;}});
  return {index:best, distance:d};
}

function arrowIcon(deg, big=false){
  const size = big ? 58 : 38;
  // SVG arrow mặc định hướng lên Bắc. Bearing GPS: 0=Bắc, 90=Đông, 180=Nam, 270=Tây.
  // Vì vậy rotate(deg) sẽ làm mũi tên nằm đúng dọc theo route trên bản đồ.
  const html = `
    <div class="arrowShape" style="width:${size}px;height:${size}px;transform: rotate(${deg}deg)">
      <svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">
        <path d="M20 2 L34 35 L20 27 L6 35 Z" fill="#facc15" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>
      </svg>
    </div>`;
  return L.divIcon({
    className: big ? 'directionArrowIcon' : 'pathArrowIcon',
    html,
    iconSize: [size,size],
    iconAnchor: [size/2,size/2]
  });
}
function clearLayers(){ [routeLayer,guideLayer,arrowLayer,traveledLayer,targetMarker,directionMarker].forEach(l=>l&&l.remove()); }
function drawRouteArrows(path){
  arrowLayer = L.layerGroup().addTo(map);
  if (!path || path.length < 2) return;

  // Vẽ mũi tên THEO TỪNG ĐOẠN của route, không dùng icon ngang cố định.
  // Mỗi đoạn dài sẽ có nhiều mũi tên, đoạn ngắn có 1 mũi tên ở giữa.
  for (let i=1;i<path.length;i++){
    const a = path[i-1], b = path[i];
    const segLen = dist(a,b);
    if (segLen < 3) continue;
    const br = bearing(a,b);
    const count = Math.max(1, Math.floor(segLen / 90));
    for (let k=1;k<=count;k++){
      const t = (k)/(count+1);
      L.marker(pointAt(a,b,t), {icon: arrowIcon(br), interactive:false, zIndexOffset:600}).addTo(arrowLayer);
    }
  }
}
function drawAll(){
  clearLayers();
  routeLayer = L.layerGroup().addTo(map);
  routeSegments.forEach(s=>L.polyline(s,{color:'#38bdf8',weight:5,opacity:.65}).addTo(routeLayer));
  if (guidePath.length){
    guideLayer = L.polyline(guidePath,{color:'#facc15',weight:7,opacity:.95}).addTo(map);
    drawRouteArrows(guidePath);
  }
  traveledLayer = L.polyline(traveledPoints,{color:'#22c55e',weight:10,opacity:.95}).addTo(map);
  const all = routeSegments.flat();
  if (all.length && !currentUserPos) map.fitBounds(L.latLngBounds(all.map(p=>[p.lat,p.lng])),{padding:[25,25]});
}
function updateUser(pos){
  currentUserPos = pos;
  if(!userMarker){ userMarker = L.marker(pos).addTo(map).bindPopup('Vị trí của bạn'); }
  else userMarker.setLatLng(pos);
  traveledPoints.push(pos);
  if (traveledLayer) traveledLayer.setLatLngs(traveledPoints);
  if (guidePath.length) {
    const c = closestIndex(guidePath,pos);
    nextIndex = Math.min(guidePath.length-1, Math.max(nextIndex, c.index+1));
    const target = guidePath[nextIndex];
    const br = bearing(pos,target);
    if (targetMarker) targetMarker.remove();
    targetMarker = L.circleMarker(target,{radius:8,color:'#ef4444',weight:3,fillOpacity:.8}).addTo(map).bindPopup('Điểm cần tới tiếp theo');
    if (directionMarker) directionMarker.remove();
    directionMarker = L.marker(pos, {icon: arrowIcon(br,true), interactive:false, zIndexOffset:1000}).addTo(map);
    bigArrowEl.style.transform = `rotate(${br}deg)`;
    navTextEl.textContent = `${turnText(br).toUpperCase()} • ${fmt(dist(pos,target))}`;
    updateSteps(pos,target,c.distance,br);
    if (!mapCenteredOnce){ map.setView(pos, 18); mapCenteredOnce = true; }
    else map.panTo(pos, {animate:true, duration:.4});
  }
}
function updateSteps(pos,target,offRoute,br){
  stepsEl.innerHTML='';
  const remain = guidePath.slice(Math.max(0,nextIndex-1)).reduce((s,p,i,a)=>i?s+dist(a[i-1],p):0,0);
  const rows = [
    `Mũi tên vàng lớn trên vị trí của bạn là hướng cần đi ngay bây giờ.`,
    `Các mũi tên nhỏ màu vàng nằm dọc theo tuyến, hãy đi theo chiều các mũi tên đó.`,
    `${turnText(br)} hướng ${Math.round(br)}°, còn ${fmt(dist(pos,target))} tới điểm đỏ tiếp theo.`,
    `Bạn đang cách đường KMZ khoảng ${fmt(offRoute)}. Đường màu xanh lá là đoạn đã đi. Còn lại khoảng ${fmt(remain)}.`
  ];
  rows.forEach(t=>{const li=document.createElement('li'); li.textContent=t; stepsEl.appendChild(li);});
  infoEl.textContent = `Đang theo dõi GPS. Đã ghi ${traveledPoints.length} điểm.`;
}

async function loadRoute(fileOrUrl){
  try{
    setStatus('Đang đọc file KMZ/KML...');
    routeSegments = await readFile(fileOrUrl);
    guidePath = optimizePath(currentUserPos);
    traveledPoints = [];
    nextIndex = 0;
    mapCenteredOnce = false;
    drawAll();
    setStatus('Đã tải route. Bấm “Lấy vị trí / Bắt đầu theo dõi”.');
    infoEl.textContent = `Route có ${routeSegments.length} đoạn, ${routeSegments.flat().length} điểm, dài khoảng ${fmt(totalLen(mergeSegments(routeSegments)))}.`;
  }catch(e){ console.error(e); setStatus('Lỗi: '+e.message); }
}

function startLocate(){
  if(!navigator.geolocation){ setStatus('Trình duyệt không hỗ trợ GPS.'); return; }
  if(location.protocol !== 'https:' && location.hostname !== 'localhost') setStatus('GPS cần HTTPS. Hãy mở bằng link GitHub Pages https://...');
  setStatus('Đang xin quyền vị trí. Nếu trình duyệt hỏi, chọn Allow/Cho phép.');
  if(watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p=>{
    const pos = {lat:p.coords.latitude, lng:p.coords.longitude};
    if(!guidePath.length && routeSegments.length){ guidePath = optimizePath(pos); drawAll(); }
    updateUser(pos);
    setStatus(`GPS OK. Độ chính xác khoảng ${fmt(p.coords.accuracy || 0)}.`);
  }, err=>{
    setStatus('Không lấy được vị trí: '+err.message+'. Hãy bật Location/GPS và cho phép quyền vị trí cho trình duyệt.');
  }, {enableHighAccuracy:true, maximumAge:1000, timeout:20000});
}
function stopLocate(){
  if(watchId) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  setStatus('Đã dừng theo dõi GPS.');
}

document.getElementById('locateBtn').onclick = startLocate;
document.getElementById('stopBtn').onclick = stopLocate;
document.getElementById('fileInput').addEventListener('change', e=>{
  const f=e.target.files && e.target.files[0];
  if(f) loadRoute(f);
});

window.addEventListener('load', ()=>loadRoute(DEFAULT_FILE));
