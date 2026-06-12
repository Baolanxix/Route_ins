// Field Route Navigator v11
// Chinese Postman style planner: đi qua tất cả đoạn KMZ, ít lặp nhất có thể, chỉ đi trên đoạn có trong KMZ.

const DONE_DIST_M = 22;
const ARROW_LOOKAHEAD_M = 160;
const NODE_PREC = 7;
const STORAGE_KEY = "field-route-v11-state";

let map = L.map("map", { zoomControl: false }).setView([10.8, 106.7], 17);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }).addTo(map);

let rawLines = [];
let graph = null;
let currentPos = null;
let lastPos = null;
let userMarker = null;
let planned = [];
let planCursor = 0;
let layers = { base: L.layerGroup().addTo(map), done: L.layerGroup().addTo(map), active: L.layerGroup().addTo(map), arrows: L.layerGroup().addTo(map), skipped: L.layerGroup().addTo(map) };
let edgeStatus = new Map(); // edgeKey -> unvisited/done/skipped

const fileInput = document.getElementById("fileInput");
fileInput.onchange = async e => { const f = e.target.files[0]; if (f) await loadFile(f); };
document.getElementById("resetBtn").onclick = () => { localStorage.removeItem(STORAGE_KEY); edgeStatus.clear(); planCursor = 0; if (graph && currentPos) rebuildFromGps(); drawAll(); };
document.getElementById("skipBtn").onclick = () => skipCurrentEdge();
document.getElementById("exportBtn").onclick = () => exportGPX();

init();
async function init(){
  await loadDefaultKMZ();
  startGPS();
}

async function loadDefaultKMZ(){
  const res = await fetch("Route.kmz?v=11");
  const blob = await res.blob();
  await loadFile(blob);
}

async function loadFile(file){
  const name = (file.name || "Route.kmz").toLowerCase();
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
  buildGraphFromLines();
  restoreState();
  if (currentPos) rebuildFromGps();
  drawAll(true);
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
  const nodes = new Map(), adj = new Map(), edges = new Map();
  function addNode(p){ const k=keyOf(p); if(!nodes.has(k)) nodes.set(k,{key:k,p}); if(!adj.has(k)) adj.set(k,[]); return k; }
  function addEdge(a,b){
    if (a===b) return;
    const k=ekey(a,b); if (edges.has(k)) return;
    const ea=nodes.get(a).p, eb=nodes.get(b).p, len=dist(ea,eb);
    const edge={key:k,a,b,len,geom:[ea,eb]}; edges.set(k,edge);
    adj.get(a).push({to:b,key:k,w:len}); adj.get(b).push({to:a,key:k,w:len});
    if(!edgeStatus.has(k)) edgeStatus.set(k,"unvisited");
  }
  rawLines.forEach(line => {
    for(let i=0;i<line.length;i++) addNode(line[i]);
    for(let i=0;i<line.length-1;i++) addEdge(keyOf(line[i]), keyOf(line[i+1]));
  });
  graph = {nodes, adj, edges};
}

function startGPS(){
  if (!navigator.geolocation) return alert("Thiết bị không hỗ trợ GPS");
  navigator.geolocation.watchPosition(pos => {
    lastPos = currentPos;
    currentPos = [pos.coords.latitude, pos.coords.longitude];
    updateUserMarker();
    if (!planned.length && graph) rebuildFromGps();
    updateProgress();
    drawAll();
  }, err => alert("Không lấy được GPS. Hãy mở bằng HTTPS và cho phép vị trí."), { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
}

function updateUserMarker(){
  let deg = lastPos ? bearing(lastPos, currentPos) : 0;
  const icon = L.divIcon({className:"", html:`<div class="user-arrow" style="transform:rotate(${deg}deg)"></div>`, iconSize:[28,32], iconAnchor:[14,18]});
  if (!userMarker) userMarker = L.marker(currentPos,{icon}).addTo(map); else userMarker.setLatLng(currentPos).setIcon(icon);
  map.setView(currentPos, Math.max(map.getZoom(), 18), {animate:false});
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
  if(!planned.length) return;
  const step=planned[planCursor]; if(!step) return;
  const a=graph.nodes.get(step.a).p, b=graph.nodes.get(step.b).p;
  const pr=projectPointToSegment(currentPos,a,b);
  if(pr.d < DONE_DIST_M && pr.t > 0.82){
    edgeStatus.set(step.key,"done"); planCursor++;
    while(planned[planCursor] && edgeStatus.get(planned[planCursor].key)!=="unvisited") planCursor++;
    if(planCursor>=planned.length) rebuildFromGps();
    saveState();
  }
}
function skipCurrentEdge(){
  const step=planned[planCursor]; if(!step) return;
  edgeStatus.set(step.key,"skipped");
  rebuildFromGps(); drawAll(); saveState();
}

function drawAll(fit=false){
  Object.values(layers).forEach(g=>g.clearLayers());
  if(!graph) return;
  const bounds=[];
  for(const e of graph.edges.values()){
    const st=edgeStatus.get(e.key)||"unvisited"; const geom=e.geom; bounds.push(...geom);
    if(st==="done") L.polyline(geom,{color:"#00d26a",weight:8,opacity:.95}).addTo(layers.done);
    else if(st==="skipped") L.polyline(geom,{color:"#ff8c00",weight:7,opacity:.95}).addTo(layers.skipped);
    else L.polyline(geom,{color:"#b9c0c9",weight:5,opacity:.55}).addTo(layers.base);
  }
  const step=planned[planCursor];
  if(step){
    const a=graph.nodes.get(step.a).p, b=graph.nodes.get(step.b).p;
    L.polyline([a,b],{color:"#ffd400",weight:9,opacity:1}).addTo(layers.active);
    drawArrowsOnSegment(a,b);
  }
  if(fit && bounds.length) map.fitBounds(bounds,{padding:[30,30]});
}
function drawArrowsOnSegment(a,b){
  const len=dist(a,b), n=Math.max(1, Math.floor(Math.min(len, ARROW_LOOKAHEAD_M)/38));
  const br=bearing(a,b);
  for(let i=1;i<=n;i++){
    const t=(i/(n+1))*Math.min(1,ARROW_LOOKAHEAD_M/len);
    const p=[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
    const icon=L.divIcon({className:"", html:`<div class="nav-arrow" style="transform:rotate(${br}deg)"></div>`, iconSize:[22,28], iconAnchor:[11,17]});
    L.marker(p,{icon,interactive:false}).addTo(layers.arrows);
  }
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
  const gpx=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Field Route Navigator v11"><trk><name>Completed route</name><trkseg>${trk}</trkseg></trk></gpx>`;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([gpx],{type:"application/gpx+xml"})); a.download="completed-route.gpx"; a.click(); URL.revokeObjectURL(a.href);
}
