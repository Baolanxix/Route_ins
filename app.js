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
let guideBuiltFromGps = false;

let userMarker, routeLayer, guideLayer, arrowLayer, traveledLayer, targetMarker, directionMarker, activeGuideLayer;

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


function nodeKey(p){ return `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`; }
function sameKey(a,b){ return a===b; }
function edgeKey(a,b){ return a < b ? `${a}|${b}` : `${b}|${a}`; }

function buildGraph(pos){
  const nodes = new Map();
  const adj = new Map();
  const edges = new Map();
  function addNode(p){
    const k = nodeKey(p);
    if(!nodes.has(k)) nodes.set(k, {lat:p.lat, lng:p.lng, key:k});
    if(!adj.has(k)) adj.set(k, []);
    return k;
  }
  function addEdge(a,b){
    const ka=addNode(a), kb=addNode(b);
    if(ka===kb) return;
    const ek=edgeKey(ka,kb);
    if(edges.has(ek)) return;
    const e={key:ek, a:ka, b:kb, len:dist(nodes.get(ka), nodes.get(kb))};
    edges.set(ek,e);
    adj.get(ka).push({to:kb, edge:ek});
    adj.get(kb).push({to:ka, edge:ek});
  }

  routeSegments.forEach(seg=>{
    for(let i=1;i<seg.length;i++) addEdge(seg[i-1], seg[i]);
  });

  // Tìm điểm gần GPS nhất trên chính các đoạn KMZ. Nếu điểm đó nằm giữa đoạn,
  // chèn nó thành 1 node mới bằng cách tách đoạn KMZ đó làm 2. Không tạo đường ngoài KMZ.
  let startKey = null;
  if(pos && edges.size){
    let best = {edge:null, point:null, t:0, distance:Infinity};
    for(const e of edges.values()){
      const a=nodes.get(e.a), b=nodes.get(e.b);
      const pr=projectPointOnSegment(pos,a,b);
      if(pr.distance < best.distance) best={edge:e, point:pr.point, t:pr.t, distance:pr.distance};
    }
    if(best.edge){
      if(best.t <= 0.02) startKey = best.edge.a;
      else if(best.t >= 0.98) startKey = best.edge.b;
      else{
        const old = best.edge;
        // xóa cạnh cũ
        edges.delete(old.key);
        adj.set(old.a, adj.get(old.a).filter(x=>x.edge!==old.key));
        adj.set(old.b, adj.get(old.b).filter(x=>x.edge!==old.key));
        startKey = addNode(best.point);
        addEdge(nodes.get(old.a), nodes.get(startKey));
        addEdge(nodes.get(startKey), nodes.get(old.b));
      }
    }
  }
  if(!startKey){
    const first = routeSegments[0] && routeSegments[0][0];
    startKey = first ? addNode(first) : null;
  }
  return {nodes, adj, edges, startKey};
}

function componentEdges(graph,startKey){
  const q=[startKey], seen=new Set([startKey]), edgeSet=new Set();
  while(q.length){
    const u=q.shift();
    for(const nb of graph.adj.get(u)||[]){
      edgeSet.add(nb.edge);
      if(!seen.has(nb.to)){ seen.add(nb.to); q.push(nb.to); }
    }
  }
  return edgeSet;
}

function shortestPathToUnvisited(graph, startKey, unvisitedEdges){
  const q=[startKey], prev=new Map(), seen=new Set([startKey]);
  let target=null;
  while(q.length){
    const u=q.shift();
    const hasTodo=(graph.adj.get(u)||[]).some(x=>unvisitedEdges.has(x.edge));
    if(hasTodo){ target=u; break; }
    for(const nb of graph.adj.get(u)||[]){
      if(!seen.has(nb.to)){
        seen.add(nb.to); prev.set(nb.to,u); q.push(nb.to);
      }
    }
  }
  if(!target || target===startKey) return [];
  const path=[];
  let cur=target;
  while(cur!==startKey){ path.push(cur); cur=prev.get(cur); }
  return path.reverse();
}

function buildKmzOnlyGuide(pos){
  const graph = buildGraph(pos);
  if(!graph.startKey) return [];

  const todo = componentEdges(graph, graph.startKey); // chỉ đi trong component có GPS gần nhất
  const pathKeys=[graph.startKey];
  let cur=graph.startKey;
  let guard=0;

  while(todo.size && guard++ < 20000){
    const neighbors = graph.adj.get(cur)||[];
    let nb = neighbors.find(x=>todo.has(x.edge));
    if(nb){
      todo.delete(nb.edge);
      cur=nb.to;
      pathKeys.push(cur);
      continue;
    }
    // đang ở ngõ cụt: quay lại trên đường KMZ có sẵn tới node còn cạnh chưa đi
    const hop = shortestPathToUnvisited(graph, cur, todo);
    if(!hop.length) break;
    for(const k of hop){ cur=k; pathKeys.push(cur); }
  }
  return pathKeys.map(k=>graph.nodes.get(k));
}

function mergeSegments(segs){
  // Chỉ dùng để hiển thị/tính tổng, tuyệt đối không nối các đoạn rời bằng đường thẳng mới.
  return segs.flat();
}
function totalLen(path){ return path.reduce((s,p,i)=>i?s+dist(path[i-1],p):0,0); }

function projectPointOnSegment(p,a,b){
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

function optimizePath(pos){
  return buildKmzOnlyGuide(pos);
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
function drawUpcomingGuide(pos){
  // Chỉ hiện mũi tên của đoạn SẮP ĐI, giống Google Maps.
  // Không vẽ mũi tên trên toàn bộ KMZ để tránh rối.
  if (arrowLayer) arrowLayer.remove();
  if (activeGuideLayer) activeGuideLayer.remove();
  arrowLayer = L.layerGroup().addTo(map);
  if (!guidePath || guidePath.length < 2 || !pos) return;

  const fromIndex = Math.max(1, nextIndex);
  const active = guidePath.slice(Math.max(0, fromIndex-1), Math.min(guidePath.length, fromIndex + 6));
  // Không vẽ đường từ GPS tới route. Chỉ vẽ đoạn có trong KMZ.
  activeGuideLayer = L.polyline(active, {color:'#facc15',weight:10,opacity:1}).addTo(map);

  // Mũi tên hiện trên đoạn ngay trước mặt + vài đoạn kế tiếp, không quá nhiều.
  for (let i=1;i<active.length;i++){
    const a = active[i-1], b = active[i];
    const segLen = dist(a,b);
    if (segLen < 5) continue;
    const br = bearing(a,b);
    const count = Math.min(3, Math.max(1, Math.floor(segLen / 120)));
    for (let k=1;k<=count;k++){
      const t = k/(count+1);
      L.marker(pointAt(a,b,t), {icon: arrowIcon(br), interactive:false, zIndexOffset:700}).addTo(arrowLayer);
    }
  }
}
function clearLayers(){ [routeLayer,guideLayer,arrowLayer,activeGuideLayer,traveledLayer,targetMarker,directionMarker].forEach(l=>l&&l.remove()); }
function drawAll(){
  clearLayers();
  routeLayer = L.layerGroup().addTo(map);
  routeSegments.forEach(s=>L.polyline(s,{color:'#38bdf8',weight:5,opacity:.55}).addTo(routeLayer));
  // Đường cần đi chỉ vẽ nét mỏng để biết tổng tuyến; mũi tên chỉ hiện gần vị trí hiện tại.
  if (guidePath.length){
    guideLayer = L.polyline(guidePath,{color:'#facc15',weight:4,opacity:.45,dashArray:'8 10'}).addTo(map);
  }
  traveledLayer = L.polyline(traveledPoints,{color:'#22c55e',weight:10,opacity:.95}).addTo(map);
  const all = routeSegments.flat();
  if (all.length && !currentUserPos) map.fitBounds(L.latLngBounds(all.map(p=>[p.lat,p.lng])),{padding:[25,25]});
}
function updateUser(pos){
  currentUserPos = pos;
  // Lần đầu lấy GPS: tạo lại tuyến bắt đầu tại điểm gần GPS nhất, không dùng đầu file KMZ.
  if (routeSegments.length && !guideBuiltFromGps){
    guidePath = optimizePath(pos);
    nextIndex = 1;
    guideBuiltFromGps = true;
    drawAll();
    setStatus('Đã chọn điểm gần GPS nhất trên chính đoạn KMZ. Không vẽ thêm đường ngoài KMZ.');
  }
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
    drawUpcomingGuide(pos);
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
    `Mũi tên vàng chỉ hiện trên đoạn KMZ sắp đi, không vẽ thêm đường ngoài file.`,
    `${turnText(br)} hướng ${Math.round(br)}°, còn ${fmt(dist(pos,target))} tới điểm đỏ tiếp theo.`,
    `Bạn đang cách tuyến đang dẫn khoảng ${fmt(offRoute)}. Đường màu xanh lá là đoạn đã đi. Còn lại khoảng ${fmt(remain)}.`
  ];
  rows.forEach(t=>{const li=document.createElement('li'); li.textContent=t; stepsEl.appendChild(li);});
  infoEl.textContent = `Đang theo dõi GPS. Đã ghi ${traveledPoints.length} điểm.`;
}

async function loadRoute(fileOrUrl){
  try{
    setStatus('Đang đọc file KMZ/KML...');
    routeSegments = await readFile(fileOrUrl);
    guidePath = currentUserPos ? optimizePath(currentUserPos) : mergeSegments(routeSegments);
    guideBuiltFromGps = !!currentUserPos;
    traveledPoints = [];
    nextIndex = guideBuiltFromGps ? 1 : 0;
    mapCenteredOnce = false;
    drawAll();
    setStatus('Đã tải route. Bấm “Lấy vị trí / Bắt đầu theo dõi”.');
    infoEl.textContent = `Route có ${routeSegments.length} đoạn, ${routeSegments.flat().length} điểm. Bấm GPS để chọn điểm bắt đầu gần nhất trên chính đường KMZ.`;
  }catch(e){ console.error(e); setStatus('Lỗi: '+e.message); }
}

function startLocate(){
  if(!navigator.geolocation){ setStatus('Trình duyệt không hỗ trợ GPS.'); return; }
  if(location.protocol !== 'https:' && location.hostname !== 'localhost') setStatus('GPS cần HTTPS. Hãy mở bằng link GitHub Pages https://...');
  setStatus('Đang xin quyền vị trí. Nếu trình duyệt hỏi, chọn Allow/Cho phép.');
  if(watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p=>{
    const pos = {lat:p.coords.latitude, lng:p.coords.longitude};
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
