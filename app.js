// Field Route Navigator v20-osm-smart-route
// Chinese Postman style planner: đi qua tất cả đoạn KMZ, ít lặp nhất có thể, chỉ đi trên đoạn có trong KMZ.

const VISITED_BUFFER_M = 12;     // GPS lệch <= 12m vẫn tính là đã đi ngoài đường lớn
const SEGMENT_MAX_M = 25;        // chia line dài thành đoạn nhỏ để tô xanh sớm
const GUIDE_LOOKAHEAD_M = 300;   // chỉ dẫn trước 300m
const NODE_PREC = 7;
const STORAGE_KEY = "field-route-v20-osm-smart-route-state";
const FOLLOW_ZOOM = 16;
const SNAP_TOL_M = 3; // v13: tự nối/split các line giao nhau hoặc lệch rất nhỏ
let hasInitialGpsFix = false;

let map = L.map("map", { zoomControl: false }).setView([10.8, 106.7], 17);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }).addTo(map);

let rawLines = [];
let graph = null;
let currentPos = null;
let lastPos = null;
let currentAccuracy = null;
let userMarker = null;
let displayedPos = null;
let markerAnim = null;
let markerAnimStart = 0;
let markerAnimFrom = null;
let markerAnimTo = null;
let displayedBearing = 0;
let planned = [];
let planCursor = 0;
let layers = { base: L.layerGroup().addTo(map), done: L.layerGroup().addTo(map), active: L.layerGroup().addTo(map), arrows: L.layerGroup().addTo(map), skipped: L.layerGroup().addTo(map), road: L.layerGroup().addTo(map) };

// v20: chế độ thông minh dùng OSRM/OpenStreetMap để vẽ đường đi thực tế.
// Khi bật, mũi tên/đường dẫn sẽ đi theo đường thật và tuân thủ one-way nếu dữ liệu OSM có.
// Nếu OSRM lỗi hoặc không có mạng, app tự fallback về chỉ dẫn theo KMZ như v19.
let realRoadMode = true;
let osrmCache = new Map();
let osrmRequestId = 0;
let lastOsrmKey = "";
let edgeStatus = new Map(); // edgeKey -> unvisited/done/skipped

const fileInput = document.getElementById("fileInput");
fileInput.onchange = async e => { const f = e.target.files[0]; if (f) await loadFile(f); };
document.getElementById("resetBtn").onclick = () => { localStorage.removeItem(STORAGE_KEY); edgeStatus.clear(); planCursor = 0; if (graph && currentPos) rebuildFromGps(); drawAll(); };
document.getElementById("skipBtn").onclick = () => skipCurrentEdge();
document.getElementById("skip300Btn").onclick = () => skipAhead(300);
document.getElementById("exportBtn").onclick = () => exportGPX();
const roadModeBtn = document.getElementById("roadModeBtn");
if (roadModeBtn) roadModeBtn.onclick = () => { realRoadMode = !realRoadMode; updateRoadModeBtn(); drawAll(); };
const remainingText = document.getElementById("remainingText");
updateRoadModeBtn();

init();
async function init(){
  // v15: Không tự fetch Route.kmz nữa. Người dùng tự import KMZ/KML bằng nút Chọn KMZ/KML.
  startGPS();
}

async function loadFile(file){
  const name = (file.name || "import.kmz").toLowerCase();
  let kmlText = "";
  if (name.endsWith(".kmz") || file.type.includes("zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlName = Object.keys(zip.files).find(n => n.toLowerCase().endsWith(".kml"));
    if (!kmlName) return alert("KMZ không có file KML bên trong");
    kmlText = await zip.files[kmlName].async("text");
  } else {
    kmlText = await file.text();
  }
  rawLines = parseKmlToLines(kmlText).filter(l => l.length >= 2);
  if (!rawLines.length) return alert("Không đọc được route trong file");
  edgeStatus.clear();
  planned = [];
  planCursor = 0;
  buildGraphFromLines();
  restoreState();
  if (currentPos) rebuildFromGps();
  drawAll(true);
  updateRemainingUI();
}

function parseKmlToLines(kmlText){
  const xml = new DOMParser().parseFromString(kmlText, "text/xml");
  const gj = toGeoJSON.kml(xml);
  const lines = [];
  function addGeom(g){
    if (!g) return;
    if (g.type === "LineString") lines.push(g.coordinates.map(c => [c[1], c[0]]));
    if (g.type === "MultiLineString") g.coordinates.forEach(line => lines.push(line.map(c => [c[1], c[0]])));
    if (g.type === "GeometryCollection") g.geometries.forEach(addGeom);
  }
  gj.features.forEach(f => addGeom(f.geometry));
  return lines;
}

function keyOf(p){ return p[0].toFixed(NODE_PREC)+","+p[1].toFixed(NODE_PREC); }
function dist(a,b){ return map.distance(L.latLng(a[0],a[1]), L.latLng(b[0],b[1])); }
function bearing(a,b){
  const φ1=a[0]*Math.PI/180, φ2=b[0]*Math.PI/180, Δλ=(b[1]-a[1])*Math.PI/180;
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function ekey(a,b){ return [a,b].sort().join("|"); }

function buildGraphFromLines(){
  // v13: tạo graph bằng cách tự phát hiện giao cắt thật + snap sai số nhỏ.
  // Nếu một line AB liền mạch bị line khác cắt tại D nhưng trong KMZ không có điểm D,
  // app sẽ tự chèn D và tách AB thành A-D + D-B trước khi tối ưu tuyến.
  const segments = [];
  rawLines.forEach((line, li) => {
    for (let i=0; i<line.length-1; i++) {
      if (dist(line[i], line[i+1]) > 0.05) segments.push({ id: segments.length, line: li, idx: i, a: line[i], b: line[i+1], splits: [] });
    }
  });
  segments.forEach(s => {
    s.splits.push({t:0, p:s.a});
    s.splits.push({t:1, p:s.b});
  });

  // 1) Giao cắt hình học thật sự: xử lý đúng cả góc vuông, góc nhọn, góc tù.
  for (let i=0; i<segments.length; i++) {
    for (let j=i+1; j<segments.length; j++) {
      const s1=segments[i], s2=segments[j];
      if (s1.line === s2.line && Math.abs(s1.idx-s2.idx)<=1) continue;
      const hit = segmentIntersection(s1.a, s1.b, s2.a, s2.b);
      if (hit) {
        s1.splits.push({t:hit.t, p:hit.p});
        s2.splits.push({t:hit.u, p:hit.p});
      }
    }
  }

  // 2) Snap sai số nhỏ: nếu đầu/cuối line lệch khỏi line khác <= 3m thì tự kéo vào điểm gần nhất.
  for (const s of segments) {
    [{t:0,p:s.a},{t:1,p:s.b}].forEach(ep => {
      let best=null;
      for (const other of segments) {
        if (other.id === s.id) continue;
        if (other.line === s.line && Math.abs(other.idx-s.idx)<=1) continue;
        const pr = projectPointToSegment(ep.p, other.a, other.b);
        if (pr.t <= 0.00001 || pr.t >= 0.99999) continue;
        if (!best || pr.d < best.d) best = {seg: other, ...pr};
      }
      if (best && best.d <= SNAP_TOL_M) {
        s.splits.push({t:ep.t, p:best.point});      // đầu/cuối line nhánh được nối vào D
        best.seg.splits.push({t:best.t, p:best.point}); // line chính bị tách tại D
      }
    });
  }

  const nodes = new Map(), adj = new Map(), edges = new Map();
  function addNode(p){ const k=keyOf(p); if(!nodes.has(k)) nodes.set(k,{key:k,p}); if(!adj.has(k)) adj.set(k,[]); return k; }
  function addEdgeByPoint(pa,pb){
    const total = dist(pa,pb);
    if (total < 0.05) return;
    const parts = Math.max(1, Math.ceil(total / SEGMENT_MAX_M));
    let prev = pa;
    for (let i=1; i<=parts; i++) {
      const t = i / parts;
      const cur = [pa[0] + (pb[0]-pa[0])*t, pa[1] + (pb[1]-pa[1])*t];
      const a=addNode(prev), b=addNode(cur); if (a===b) { prev = cur; continue; }
      const k=ekey(a,b); if (!edges.has(k)) {
        const len=dist(prev,cur);
        const edge={key:k,a,b,len,geom:[nodes.get(a).p,nodes.get(b).p]}; edges.set(k,edge);
        adj.get(a).push({to:b,key:k,w:len}); adj.get(b).push({to:a,key:k,w:len});
        if(!edgeStatus.has(k)) edgeStatus.set(k,"unvisited");
      }
      prev = cur;
    }
  }

  for (const s of segments) {
    const pts = cleanSplits(s.splits);
    for (let i=0; i<pts.length-1; i++) addEdgeByPoint(pts[i].p, pts[i+1].p);
  }
  graph = {nodes, adj, edges};
}

function cleanSplits(splits){
  splits.sort((a,b)=>a.t-b.t);
  const out=[];
  for (const x of splits) {
    const last=out[out.length-1];
    if (!last || Math.abs(x.t-last.t)>1e-7 || dist(x.p,last.p)>0.15) out.push(x);
    else last.p = [(last.p[0]+x.p[0])/2, (last.p[1]+x.p[1])/2];
  }
  return out;
}

function segmentIntersection(a,b,c,d){
  // Tính giao điểm 2 đoạn bằng hệ tọa độ phẳng cục bộ quanh a.
  const R=6371000, lat0=a[0]*Math.PI/180;
  function xy(q){ return [R*(q[1]-a[1])*Math.PI/180*Math.cos(lat0), R*(q[0]-a[0])*Math.PI/180]; }
  function ll(xy){ return [a[0]+xy[1]/R*180/Math.PI, a[1]+xy[0]/(R*Math.cos(lat0))*180/Math.PI]; }
  const A=xy(a), B=xy(b), C=xy(c), D=xy(d);
  const r=[B[0]-A[0], B[1]-A[1]], s=[D[0]-C[0], D[1]-C[1]];
  const den = cross(r,s);
  if (Math.abs(den) < 1e-9) return null; // song song/trùng nhau: không tạo giao cắt ảo
  const qp=[C[0]-A[0], C[1]-A[1]];
  const t = cross(qp,s)/den, u = cross(qp,r)/den;
  if (t >= -1e-9 && t <= 1+1e-9 && u >= -1e-9 && u <= 1+1e-9) {
    const p = ll([A[0]+t*r[0], A[1]+t*r[1]]);
    return {t:Math.max(0,Math.min(1,t)), u:Math.max(0,Math.min(1,u)), p};
  }
  return null;
}
function cross(a,b){ return a[0]*b[1]-a[1]*b[0]; }

function startGPS(){
  if (!navigator.geolocation) return alert("Thiết bị không hỗ trợ GPS");
  navigator.geolocation.watchPosition(pos => {
    lastPos = currentPos;
    currentPos = [pos.coords.latitude, pos.coords.longitude];
    currentAccuracy = pos.coords.accuracy || null;
    updateUserMarker();
    if (!planned.length && graph) rebuildFromGps();
    updateProgress();
    drawAll();
  }, err => alert("Không lấy được GPS. Hãy mở bằng HTTPS và cho phép vị trí."), { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
}

function updateUserMarker(){
  const targetBearing = lastPos ? bearing(lastPos, currentPos) : displayedBearing;
  const start = displayedPos || currentPos;
  const end = currentPos;

  // v19: mũi tên GPS trượt mượt tới vị trí mới thay vì nhảy từng lần GPS update.
  markerAnimFrom = start;
  markerAnimTo = end;
  markerAnimStart = performance.now();
  displayedBearing = smoothBearing(displayedBearing, targetBearing, 0.35);

  if (!userMarker) {
    displayedPos = currentPos;
    userMarker = L.marker(currentPos,{icon:userIcon(displayedBearing)}).addTo(map);
  }
  if (markerAnim) cancelAnimationFrame(markerAnim);
  animateUserMarker();

  // Chỉ zoom một lần khi lấy GPS đầu tiên; các lần sau pan nhẹ, giữ nguyên mức zoom.
  if (!hasInitialGpsFix) {
    map.setView(currentPos, FOLLOW_ZOOM, { animate: false });
    hasInitialGpsFix = true;
  } else {
    map.panTo(currentPos, { animate: true, duration: 0.35 });
  }
}

function userIcon(deg){
  return L.divIcon({className:"", html:`<div class="user-arrow" style="transform:rotate(${deg}deg)"></div>`, iconSize:[28,32], iconAnchor:[14,18]});
}

function animateUserMarker(){
  if (!userMarker || !markerAnimFrom || !markerAnimTo) return;
  const duration = 850;
  const now = performance.now();
  const t = Math.min(1, (now - markerAnimStart) / duration);
  const eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
  displayedPos = [
    markerAnimFrom[0] + (markerAnimTo[0]-markerAnimFrom[0]) * eased,
    markerAnimFrom[1] + (markerAnimTo[1]-markerAnimFrom[1]) * eased
  ];
  userMarker.setLatLng(displayedPos);
  userMarker.setIcon(userIcon(displayedBearing));
  if (t < 1) markerAnim = requestAnimationFrame(animateUserMarker);
}

function smoothBearing(from, to, factor){
  let diff = ((to - from + 540) % 360) - 180;
  return (from + diff * factor + 360) % 360;
}

function projectPointToSegment(p,a,b){
  // local equirectangular projection around p
  const R=6371000, lat0=p[0]*Math.PI/180;
  function xy(q){ return [R*(q[1]-p[1])*Math.PI/180*Math.cos(lat0), R*(q[0]-p[0])*Math.PI/180]; }
  const P=[0,0], A=xy(a), B=xy(b), AB=[B[0]-A[0],B[1]-A[1]];
  const ab2=AB[0]*AB[0]+AB[1]*AB[1];
  let t=ab2? -((A[0])*AB[0]+(A[1])*AB[1])/ab2 : 0;
  t=Math.max(0,Math.min(1,t));
  const proj=[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
  return {point:proj,t,d:dist(p,proj)};
}

function findNearestEdgePoint(p, onlyRemaining=false){
  let best=null;
  for (const edge of graph.edges.values()) {
    if (onlyRemaining && edgeStatus.get(edge.key)!=="unvisited") continue;
    const pr=projectPointToSegment(p, edge.geom[0], edge.geom[1]);
    if(!best || pr.d<best.d) best={edge, ...pr};
  }
  return best;
}

function cloneRemainingGraphWithStart(){
  buildGraphFromLines(); // clean graph, statuses preserved by same keys
  const nearest = findNearestEdgePoint(currentPos, true) || findNearestEdgePoint(currentPos, false);
  if (!nearest) return null;
  const {edge, point, t} = nearest;
  const startKey = keyOf(point);
  if (!graph.nodes.has(startKey)) graph.nodes.set(startKey,{key:startKey,p:point});
  if (!graph.adj.has(startKey)) graph.adj.set(startKey,[]);
  // split edge if start lies inside it and edge is unvisited. No outside route is added.
  if (t>0.00001 && t<0.99999 && edgeStatus.get(edge.key)==="unvisited") {
    graph.edges.delete(edge.key);
    graph.adj.set(edge.a, graph.adj.get(edge.a).filter(x=>x.key!==edge.key));
    graph.adj.set(edge.b, graph.adj.get(edge.b).filter(x=>x.key!==edge.key));
    edgeStatus.delete(edge.key);
    addGraphEdge(edge.a,startKey);
    addGraphEdge(startKey,edge.b);
  }
  return startKey;
}
function addGraphEdge(a,b){
  const ea=graph.nodes.get(a).p, eb=graph.nodes.get(b).p, k=ekey(a,b), len=dist(ea,eb);
  graph.edges.set(k,{key:k,a,b,len,geom:[ea,eb]});
  graph.adj.get(a).push({to:b,key:k,w:len}); graph.adj.get(b).push({to:a,key:k,w:len});
  if(!edgeStatus.has(k)) edgeStatus.set(k,"unvisited");
}

function rebuildFromGps(){
  if (!graph || !currentPos) return;
  const start = cloneRemainingGraphWithStart();
  planned = planOpenCPP(start);
  planCursor = 0;
  saveState();
  updateRemainingUI();
}

function dijkstra(src){
  const D=new Map(), prev=new Map(), used=new Set();
  for (const k of graph.nodes.keys()) D.set(k, Infinity); D.set(src,0);
  while(true){
    let u=null, best=Infinity;
    for (const [k,d] of D) if(!used.has(k) && d<best){best=d;u=k;}
    if(u===null) break; used.add(u);
    for(const e of graph.adj.get(u)||[]){
      if(edgeStatus.get(e.key)==="skipped") continue;
      const nd=best+e.w; if(nd<D.get(e.to)){D.set(e.to,nd); prev.set(e.to,{from:u,key:e.key});}
    }
  }
  return {D,prev};
}
function pathKeys(src,dst){
  const {prev}=dijkstra(src); const path=[]; let u=dst;
  while(u!==src){ const p=prev.get(u); if(!p) return []; path.push({from:p.from,to:u,key:p.key}); u=p.from; }
  return path.reverse();
}
function minMatching(nodes){
  const memo=new Map();
  function rec(arr){
    if(!arr.length) return {cost:0,pairs:[]};
    const k=arr.join("|"); if(memo.has(k)) return memo.get(k);
    const first=arr[0]; let best={cost:Infinity,pairs:[]};
    const dj=dijkstra(first);
    for(let i=1;i<arr.length;i++){
      const second=arr[i], rest=arr.slice(1,i).concat(arr.slice(i+1));
      const sub=rec(rest), c=(dj.D.get(second)||Infinity)+sub.cost;
      if(c<best.cost) best={cost:c,pairs:[[first,second],...sub.pairs]};
    }
    memo.set(k,best); return best;
  }
  if(nodes.length>16) { // fallback greedy for very complex files
    const arr=[...nodes], pairs=[];
    while(arr.length){ const a=arr.shift(); const dj=dijkstra(a); let bi=0, bd=Infinity; arr.forEach((b,i)=>{const d=dj.D.get(b); if(d<bd){bd=d;bi=i;}}); pairs.push([a,arr.splice(bi,1)[0]]); }
    return {pairs};
  }
  return rec(nodes);
}
function planOpenCPP(start){
  const required = [...graph.edges.values()].filter(e => edgeStatus.get(e.key)==="unvisited");
  if(!required.length) return [];
  const degree=new Map(); for(const e of required){ degree.set(e.a,(degree.get(e.a)||0)+1); degree.set(e.b,(degree.get(e.b)||0)+1); }
  const odd=[...degree].filter(([k,d])=>d%2===1).map(([k])=>k);
  let bestEnd=null,bestPairs=null,bestCost=Infinity;
  const candidates=[...new Set([...odd, ...required.flatMap(e=>[e.a,e.b])])];
  for(const end of candidates){
    let set=[...odd];
    function toggle(x){ const i=set.indexOf(x); if(i>=0) set.splice(i,1); else set.push(x); }
    toggle(start); toggle(end);
    if(set.length%2) continue;
    const m=minMatching(set); const cost=(m.cost ?? 0);
    if(cost<bestCost){ bestCost=cost; bestEnd=end; bestPairs=m.pairs; }
  }
  const multi=[];
  required.forEach(e=>multi.push({from:e.a,to:e.b,key:e.key}));
  (bestPairs||[]).forEach(([a,b]) => pathKeys(a,b).forEach(p=>multi.push(p)));
  return eulerTrail(start, multi);
}
function eulerTrail(start, edgeList){
  const adj=new Map();
  edgeList.forEach((e,i)=>{ if(!adj.has(e.from))adj.set(e.from,[]); if(!adj.has(e.to))adj.set(e.to,[]); adj.get(e.from).push({to:e.to,i}); adj.get(e.to).push({to:e.from,i}); });
  const used=new Set(), stack=[start], out=[];
  while(stack.length){
    const v=stack[stack.length-1]; let arr=adj.get(v)||[];
    while(arr.length && used.has(arr[arr.length-1].i)) arr.pop();
    if(arr.length){ const e=arr.pop(); used.add(e.i); stack.push(e.to); }
    else out.push(stack.pop());
  }
  const nodes=out.reverse(), steps=[];
  for(let i=0;i<nodes.length-1;i++){ const a=nodes[i], b=nodes[i+1], k=ekey(a,b); if(graph.edges.has(k)) steps.push({a,b,key:k}); }
  return steps;
}

function updateProgress(){
  if(!planned.length || !currentPos) return;

  // v18: sửa lỗi ngoài đường không tô xanh.
  // v17 quá bảo thủ: chỉ chờ GPS đi gần cuối đúng planCursor nên khi GPS nhảy, cập nhật thưa,
  // hoặc xe chạy nhanh qua segment 25m thì segment không được chuyển xanh.
  // v18 vẫn không quét xa toàn tuyến; chỉ xét current + vài segment kế tiếp để tránh tự xanh sai.
  if (currentAccuracy && currentAccuracy > 60) return; // GPS quá nhiễu thì không tự đánh dấu

  let changed = false;

  // Bỏ qua các bước skipped trong kế hoạch.
  while (planned[planCursor] && edgeStatus.get(planned[planCursor].key)==="skipped") {
    planCursor++;
    changed = true;
  }

  // Tìm segment gần GPS nhất trong cửa sổ nhỏ phía trước.
  const MAX_AHEAD_STEPS = 6;
  let best = null;
  for (let i = planCursor; i < Math.min(planned.length, planCursor + MAX_AHEAD_STEPS); i++) {
    const st = planned[i];
    if (!st || edgeStatus.get(st.key)==="skipped") continue;
    const a = graph.nodes.get(st.a).p, b = graph.nodes.get(st.b).p;
    const pr = projectPointToSegment(currentPos, a, b);
    if (pr.d <= VISITED_BUFFER_M && (!best || pr.d < best.pr.d)) best = {i, st, a, b, pr};
  }
  if (!best) { if (changed) saveState(); return; }

  // Nếu GPS đang ở segment phía sau vài bước thì đánh dấu các segment trước đó là đã đi.
  // Chỉ làm trong cửa sổ nhỏ nên không tự tô xanh hàng loạt đoạn xa.
  if (best.i > planCursor) {
    for (let i = planCursor; i < best.i; i++) {
      const st = planned[i];
      if (st && edgeStatus.get(st.key)==="unvisited") edgeStatus.set(st.key,"done");
    }
    planCursor = best.i;
    changed = true;
  }

  const st = planned[planCursor];
  if (!st || edgeStatus.get(st.key)==="skipped") { if (changed) saveState(); return; }

  const a = graph.nodes.get(st.a).p, b = graph.nodes.get(st.b).p;
  const nowPr = projectPointToSegment(currentPos, a, b);
  let shouldAdvance = false;

  // 1) GPS đã đi tới gần cuối segment hiện tại.
  if (nowPr.d <= VISITED_BUFFER_M && nowPr.t >= 0.60) shouldAdvance = true;

  // 2) Nếu có GPS trước đó, xe di chuyển đúng chiều qua segment.
  if (!shouldAdvance && lastPos) {
    const lastPr = projectPointToSegment(lastPos, a, b);
    const movedForward = nowPr.t > lastPr.t + 0.12;
    const bothNear = nowPr.d <= VISITED_BUFFER_M && lastPr.d <= VISITED_BUFFER_M;
    if (bothNear && movedForward && nowPr.t >= 0.45) shouldAdvance = true;

    // 3) Trường hợp chạy nhanh qua segment ngắn giữa 2 lần cập nhật GPS:
    // đoạn chuyển động GPS cắt/đi rất gần segment đang dẫn thì coi là đã đi qua.
    const travelNear = movementCrossesSegment(lastPos, currentPos, a, b, VISITED_BUFFER_M);
    if (travelNear && nowPr.t >= 0.35) shouldAdvance = true;
  }

  if (shouldAdvance) {
    if (edgeStatus.get(st.key)==="unvisited") edgeStatus.set(st.key,"done");
    planCursor++;
    changed = true;
  }

  if(planCursor>=planned.length) rebuildFromGps();
  if (changed) saveState();
  updateRemainingUI();
}

function movementCrossesSegment(p1, p2, a, b, tol){
  // Kiểm tra đường di chuyển giữa 2 GPS update có đi gần segment route không.
  // Dùng nhiều điểm mẫu để tránh bỏ sót khi xe chạy nhanh qua segment ngắn.
  const samples = 6;
  for (let i=0; i<=samples; i++) {
    const t = i / samples;
    const p = [p1[0] + (p2[0]-p1[0])*t, p1[1] + (p2[1]-p1[1])*t];
    const pr = projectPointToSegment(p, a, b);
    if (pr.d <= tol && pr.t >= 0.05 && pr.t <= 0.98) return true;
  }
  return false;
}
function skipCurrentEdge(){
  const step=planned[planCursor]; if(!step) return;
  edgeStatus.set(step.key,"skipped");
  rebuildFromGps(); drawAll(); saveState(); updateRemainingUI();
}
function skipAhead(meters){
  if(!planned.length) return;
  let sum = 0, i = planCursor, skipped = 0;
  while (i < planned.length && sum < meters) {
    const st = planned[i];
    if (st && edgeStatus.get(st.key)==="unvisited") {
      const e = graph.edges.get(st.key);
      if (e) sum += e.len;
      edgeStatus.set(st.key,"skipped");
      skipped++;
    }
    i++;
  }
  rebuildFromGps(); drawAll(); saveState(); updateRemainingUI();
}

function drawAll(fit=false){
  Object.values(layers).forEach(g=>g.clearLayers());
  if(!graph) { updateRemainingUI(); return; }
  const bounds=[];
  for(const e of graph.edges.values()){
    const st=edgeStatus.get(e.key)||"unvisited"; const geom=e.geom; bounds.push(...geom);
    if(st==="done") L.polyline(geom,{color:"#00d26a",weight:8,opacity:.95}).addTo(layers.done);
    else if(st==="skipped") L.polyline(geom,{color:"#ff8c00",weight:7,opacity:.95}).addTo(layers.skipped);
    else L.polyline(geom,{color:"#b9c0c9",weight:5,opacity:.55}).addTo(layers.base);
  }
  drawActiveLookahead();
  updateRemainingUI();
  if(fit && bounds.length) map.fitBounds(bounds,{padding:[30,30]});
}
function drawActiveLookahead(){
  if(!planned.length) return;
  const preview = getLookaheadPoints(GUIDE_LOOKAHEAD_M);
  if (!preview || preview.points.length < 2) return;

  // v20 smart mode: vẽ đường thật bằng OSRM để tránh đi ngược chiều đường 1 chiều.
  // KMZ vẫn là danh sách đoạn cần kiểm tra; OSRM chỉ dùng để tìm đường chạy thực tế giữa các điểm kế hoạch.
  if (realRoadMode) drawRealRoadLookahead(preview.points);
  else drawKmzLookahead(preview.steps);
}

function drawKmzLookahead(steps){
  for (const item of steps) {
    const {a,b,status} = item;
    // Nếu đây là đoạn đã đi rồi nhưng phải chạy lại để tới đoạn chưa đi,
    // chỉ hiện mũi tên, KHÔNG tô vàng đường nữa để tránh nhầm với đoạn chưa kiểm tra.
    if (status !== "done") L.polyline([a,b],{color:"#ffd400",weight:9,opacity:1}).addTo(layers.active);
    drawArrowsOnSegment(a,b);
  }
}

function getLookaheadPoints(maxMeters){
  let remain = maxMeters;
  const points = [];
  const steps = [];
  for(let i=planCursor; i<planned.length && remain>0; i++){
    const st = planned[i];
    if(!st) continue;
    const status = edgeStatus.get(st.key) || "unvisited";
    if(status === "skipped") continue;

    const a=graph.nodes.get(st.a).p, b=graph.nodes.get(st.b).p;
    const len=dist(a,b);
    const use = Math.min(len, remain);
    const end = use >= len ? b : [a[0]+(b[0]-a[0])*(use/len), a[1]+(b[1]-a[1])*(use/len)];
    if (!points.length) points.push(a);
    points.push(end);
    steps.push({a,b:end,status});
    remain -= use;
  }
  return {points, steps};
}

function drawRealRoadLookahead(points){
  const simplified = simplifyWaypointsForOsrm(points, 18);
  if (simplified.length < 2) { drawKmzLookahead(getLookaheadPoints(GUIDE_LOOKAHEAD_M).steps); return; }
  const key = simplified.map(p => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(";");

  if (osrmCache.has(key)) {
    drawOsrmGeometry(osrmCache.get(key));
    return;
  }

  // Vẽ tạm theo KMZ ngay để không bị trống khi đang chờ OSRM.
  drawKmzLookahead(getLookaheadPoints(GUIDE_LOOKAHEAD_M).steps);
  if (key === lastOsrmKey) return;
  lastOsrmKey = key;
  const reqId = ++osrmRequestId;
  const url = `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson&continue_straight=false`;
  fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error("OSRM HTTP " + r.status)))
    .then(data => {
      if (reqId !== osrmRequestId) return;
      const route = data && data.routes && data.routes[0];
      if (!route || !route.geometry || !route.geometry.coordinates) throw new Error("Không có route OSRM");
      const geom = route.geometry.coordinates.map(c => [c[1], c[0]]);
      osrmCache.set(key, {geom, distance: route.distance || 0});
      layers.active.clearLayers();
      layers.arrows.clearLayers();
      drawOsrmGeometry(osrmCache.get(key));
    })
    .catch(() => {
      // Không có mạng / OSRM lỗi / khu vực chưa có OSM: giữ fallback theo KMZ.
    });
}

function drawOsrmGeometry(route){
  const geom = route.geom || [];
  if (geom.length < 2) return;
  L.polyline(geom,{color:"#ffd400",weight:9,opacity:1}).addTo(layers.active);
  for (let i=0; i<geom.length-1; i++) {
    if (dist(geom[i], geom[i+1]) > 5) drawArrowsOnSegment(geom[i], geom[i+1]);
  }
}

function simplifyWaypointsForOsrm(points, maxPoints){
  const clean=[];
  for (const p of points) {
    const last=clean[clean.length-1];
    if (!last || dist(last,p)>6) clean.push(p);
  }
  if (clean.length <= maxPoints) return clean;
  const out=[];
  for (let i=0; i<maxPoints; i++) {
    out.push(clean[Math.round(i*(clean.length-1)/(maxPoints-1))]);
  }
  return out;
}

function updateRoadModeBtn(){
  if (!roadModeBtn) return;
  roadModeBtn.textContent = realRoadMode ? "OSM: Bật" : "OSM: Tắt";
  roadModeBtn.classList.toggle("on", realRoadMode);
}
function drawArrowsOnSegment(a,b){
  const len=dist(a,b); if(len < 3) return;
  // v15: Mũi tên nhỏ có đuôi kiểu "-->" và luôn đặt lệch về bên phải theo chiều đi.
  // Như vậy nếu route phải quay đầu trên cùng một đường, hai chiều sẽ nằm hai bên khác nhau, không bị chồng lên nhau.
  const n=Math.max(1, Math.floor(len/42));
  const br=bearing(a,b);
  const cssRotate = br - 90; // ký tự mũi tên mặc định hướng sang phải/east
  for(let i=1;i<=n;i++){
    const t=i/(n+1);
    const center=[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
    const p=offsetRight(center, br, 7); // lệch phải 7m để dễ nhìn và tránh đè chiều ngược lại
    const icon=L.divIcon({
      className:"",
      html:`<div class="nav-arrow-tail" style="transform:rotate(${cssRotate}deg)">➜</div>`,
      iconSize:[34,18],
      iconAnchor:[17,9]
    });
    L.marker(p,{icon,interactive:false}).addTo(layers.arrows);
  }
}

function offsetRight(p, brDeg, meters){
  return destinationPoint(p, (brDeg + 90) % 360, meters);
}
function destinationPoint(p, brDeg, meters){
  const R=6371000;
  const δ=meters/R, θ=brDeg*Math.PI/180;
  const φ1=p[0]*Math.PI/180, λ1=p[1]*Math.PI/180;
  const sinφ2=Math.sin(φ1)*Math.cos(δ)+Math.cos(φ1)*Math.sin(δ)*Math.cos(θ);
  const φ2=Math.asin(sinφ2);
  const y=Math.sin(θ)*Math.sin(δ)*Math.cos(φ1);
  const x=Math.cos(δ)-Math.sin(φ1)*sinφ2;
  const λ2=λ1+Math.atan2(y,x);
  return [φ2*180/Math.PI, ((λ2*180/Math.PI+540)%360)-180];
}
function remainingMeters(){
  if (!planned.length || !graph) return 0;
  let total = 0;
  for (let i = planCursor; i < planned.length; i++) {
    const st = planned[i];
    if (!st || edgeStatus.get(st.key)==="skipped") continue;
    const e = graph.edges.get(st.key);
    if (!e) continue;
    let len = e.len;
    // Segment hiện tại: trừ phần đã đi qua theo vị trí GPS nếu đang nằm gần đúng segment.
    if (i === planCursor && currentPos) {
      const a = graph.nodes.get(st.a).p, b = graph.nodes.get(st.b).p;
      const pr = projectPointToSegment(currentPos, a, b);
      if (pr.d <= Math.max(VISITED_BUFFER_M, 15)) {
        len = Math.max(0, len * (1 - pr.t));
      }
    }
    total += len;
  }
  return total;
}

function updateRemainingUI(){
  if (!remainingText) return;
  if (!graph || !planned.length) {
    remainingText.textContent = "Còn lại: --";
    return;
  }
  const m = remainingMeters();
  remainingText.textContent = `Còn lại: ${formatDistance(m)}`;
}

function formatDistance(m){
  if (m >= 1000) return `${(m/1000).toFixed(m >= 10000 ? 1 : 2)} km`;
  return `${Math.round(m)} m`;
}

function saveState(){
  const obj={status:[...edgeStatus.entries()]}; localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}
function restoreState(){
  try{ const obj=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}"); if(obj.status) obj.status.forEach(([k,v])=>edgeStatus.set(k,v)); }catch(e){}
}
function exportGPX(){
  const done=[...graph.edges.values()].filter(e=>edgeStatus.get(e.key)==="done");
  let trk=""; done.forEach(e=>e.geom.forEach(p=>trk+=`<trkpt lat="${p[0]}" lon="${p[1]}"></trkpt>\n`));
  const gpx=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Field Route Navigator v20"><trk><name>Completed route</name><trkseg>${trk}</trkseg></trk></gpx>`;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([gpx],{type:"application/gpx+xml"})); a.download="completed-route.gpx"; a.click(); URL.revokeObjectURL(a.href);
}
