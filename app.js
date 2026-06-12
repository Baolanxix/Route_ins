// Route KMZ Navigator
// Chạy tốt trên GitHub Pages vì Geolocation yêu cầu HTTPS.

const DEFAULT_FILE = 'Route.kmz';
const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const stepsEl = document.getElementById('steps');

let routeSegments = [];
let optimizedPath = [];
let userMarker = null;
let routeLayer = null;
let optimizedLayer = null;
let arrowLayer = null;
let currentUserPos = null;

const map = L.map('map', { zoomControl: true }).setView([10.77, 106.67], 15);

// Bản đồ vệ tinh Esri, miễn phí cho public usage theo điều khoản Esri/Leaflet.
L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 20, attribution: 'Tiles © Esri' }
).addTo(map);

function setStatus(msg) { statusEl.textContent = msg; }
function toRad(d) { return d * Math.PI / 180; }
function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}
function fmtMeters(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`; }

function parseCoordinates(text) {
  return text.trim().split(/\s+/).map(item => {
    const [lng, lat] = item.split(',').map(Number);
    return { lat, lng };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function parseKml(kmlText) {
  const xml = new DOMParser().parseFromString(kmlText, 'text/xml');
  const errors = xml.getElementsByTagName('parsererror');
  if (errors.length) throw new Error('File KML không đọc được.');
  const coordNodes = [...xml.getElementsByTagName('coordinates')];
  const segments = coordNodes.map(n => parseCoordinates(n.textContent)).filter(s => s.length >= 2);
  if (!segments.length) throw new Error('Không thấy LineString/coordinates trong file.');
  return segments;
}

async function readRouteFile(fileOrUrl) {
  let name = typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.name;
  let buffer;
  if (typeof fileOrUrl === 'string') {
    const res = await fetch(fileOrUrl);
    if (!res.ok) throw new Error(`Không tải được ${fileOrUrl}`);
    buffer = await res.arrayBuffer();
  } else {
    buffer = await fileOrUrl.arrayBuffer();
  }
  if (name.toLowerCase().endsWith('.kmz')) {
    const zip = await JSZip.loadAsync(buffer);
    const kmlFileName = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.kml'));
    if (!kmlFileName) throw new Error('KMZ không có file KML bên trong.');
    return parseKml(await zip.file(kmlFileName).async('text'));
  }
  return parseKml(new TextDecoder().decode(buffer));
}

function drawRoute() {
  if (routeLayer) routeLayer.remove();
  if (optimizedLayer) optimizedLayer.remove();
  if (arrowLayer) arrowLayer.remove();

  routeLayer = L.layerGroup().addTo(map);
  for (const seg of routeSegments) {
    L.polyline(seg, { weight: 5, opacity: 0.75 }).addTo(routeLayer);
  }
  const all = routeSegments.flat();
  map.fitBounds(L.latLngBounds(all.map(p => [p.lat, p.lng])), { padding: [30, 30] });
}

function nearestEndpointIndex(path, pos) {
  const dStart = haversine(pos, path[0]);
  const dEnd = haversine(pos, path[path.length - 1]);
  return dStart <= dEnd ? 0 : path.length - 1;
}

function mergeSegments(segments) {
  // Với route dạng 1 LineString thì giữ nguyên.
  // Với nhiều LineString, nối greedily theo đầu/cuối gần nhất để giảm nhảy tuyến.
  let unused = segments.map(s => [...s]);
  let path = unused.shift();
  while (unused.length) {
    const end = path[path.length - 1];
    let best = { i: 0, reverse: false, dist: Infinity };
    unused.forEach((s, i) => {
      const d0 = haversine(end, s[0]);
      const d1 = haversine(end, s[s.length - 1]);
      if (d0 < best.dist) best = { i, reverse: false, dist: d0 };
      if (d1 < best.dist) best = { i, reverse: true, dist: d1 };
    });
    let next = unused.splice(best.i, 1)[0];
    if (best.reverse) next.reverse();
    path = path.concat(next);
  }
  return path;
}

function optimizeFromCurrentLocation(pos) {
  let path = mergeSegments(routeSegments);
  if (nearestEndpointIndex(path, pos) === path.length - 1) path.reverse();
  optimizedPath = path;
  return path;
}

function drawOptimized(path) {
  if (optimizedLayer) optimizedLayer.remove();
  if (arrowLayer) arrowLayer.remove();
  optimizedLayer = L.polyline(path, { weight: 8, opacity: 0.9, dashArray: '8 8' }).addTo(map);
  arrowLayer = L.layerGroup().addTo(map);

  for (let i = 0; i < path.length; i += Math.max(1, Math.floor(path.length / 12))) {
    L.circleMarker(path[i], { radius: 5, weight: 2, fillOpacity: 1 })
      .bindPopup(`Điểm ${i + 1}/${path.length}`)
      .addTo(arrowLayer);
  }

  const bounds = L.latLngBounds(path.map(p => [p.lat, p.lng]));
  if (currentUserPos) bounds.extend([currentUserPos.lat, currentUserPos.lng]);
  map.fitBounds(bounds, { padding: [35, 35] });
}

function updateSteps(path, pos) {
  stepsEl.innerHTML = '';
  const first = path[0];
  const last = path[path.length - 1];
  const total = path.reduce((sum, p, i) => i ? sum + haversine(path[i - 1], p) : 0, 0);
  const dToStart = haversine(pos, first);
  const rows = [
    `Từ vị trí hiện tại, đi tới điểm bắt đầu gần nhất của route: ${fmtMeters(dToStart)}.`,
    `Sau đó đi theo đường nét đứt trên bản đồ vệ tinh đến cuối tuyến.`,
    `Chiều dài route cần đi: khoảng ${fmtMeters(total)}.`,
    `Điểm kết thúc: ${last.lat.toFixed(6)}, ${last.lng.toFixed(6)}.`
  ];
  for (const text of rows) {
    const li = document.createElement('li');
    li.textContent = text;
    stepsEl.appendChild(li);
  }
  infoEl.textContent = `Đã tối ưu hướng đi theo vị trí hiện tại. Route có ${path.length} điểm.`;
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus('Trình duyệt không hỗ trợ định vị.');
    return;
  }
  setStatus('Đang xin quyền và lấy vị trí thiết bị...');
  navigator.geolocation.getCurrentPosition(pos => {
    currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (userMarker) userMarker.remove();
    userMarker = L.marker(currentUserPos).addTo(map).bindPopup('Vị trí của bạn').openPopup();
    if (!routeSegments.length) {
      setStatus('Đã có vị trí. Hãy tải route trước.');
      return;
    }
    const path = optimizeFromCurrentLocation(currentUserPos);
    drawOptimized(path);
    updateSteps(path, currentUserPos);
    setStatus('Sẵn sàng dẫn đường.');
  }, err => {
    setStatus(`Không lấy được vị trí: ${err.message}`);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

async function loadRoute(fileOrUrl) {
  try {
    setStatus('Đang đọc route...');
    routeSegments = await readRouteFile(fileOrUrl);
    drawRoute();
    setStatus('Đã tải route. Bấm “Lấy vị trí của tôi” để tối ưu hướng đi.');
    const points = routeSegments.flat().length;
    infoEl.textContent = `Route gồm ${routeSegments.length} đoạn, ${points} điểm tọa độ.`;
    if (currentUserPos) {
      const path = optimizeFromCurrentLocation(currentUserPos);
      drawOptimized(path);
      updateSteps(path, currentUserPos);
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message);
  }
}

document.getElementById('locateBtn').addEventListener('click', locateUser);
document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadRoute(file);
});

loadRoute(DEFAULT_FILE);
