const OFFICE_LOCATION = { lat: -6.1421841, lng: 106.8164501 };
const RADIUS_METERS = 200;
const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

const checkinLocation = document.querySelector("#checkin-location");
const checkoutLocation = document.querySelector("#checkout-location");
const checkinStatus = document.querySelector("#checkin-status");
const checkoutStatus = document.querySelector("#checkout-status");
const checkinButton = document.querySelector("#checkin-btn");
const checkoutButton = document.querySelector("#checkout-btn");
const checkinAddress = document.querySelector("#checkin-address");
const checkoutAddress = document.querySelector("#checkout-address");

const modal = document.querySelector("#camera-modal");
const video = document.querySelector("#camera-video");
const canvas = document.querySelector("#camera-canvas");
const cameraStatus = document.querySelector("#camera-status");
const checkinPreview = document.querySelector("#checkin-preview");
const overtimePreview = document.querySelector("#overtime-preview");

let cameraStream = null;
let activePhotoTarget = null;
let currentFacingMode = "environment";
let cameraDevices = [];
let currentCameraIndex = 0;

const toRadians = (value) => (value * Math.PI) / 180;

const distanceMeters = (from, to) => {
  const earthRadius = 6371000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const setPresenceState = (allowed, statusEl, buttonEl, message) => {
  if (!statusEl || !buttonEl) return;
  statusEl.textContent = message;
  statusEl.style.color = allowed ? "var(--accent-2)" : "var(--accent-3)";
  buttonEl.disabled = !allowed;
};

const formatAddressId = (data) => {
  const address = data?.address;
  if (!address) return data?.display_name || "Alamat tidak ditemukan.";
  const roadRaw = address.road || address.pedestrian || address.footway;
  const area = address.neighbourhood || address.suburb || address.village;
  const city =
    address.city || address.town || address.county || address.state_district;
  const state = address.state;
  const normalizeRoad = (value) => {
    if (!value) return null;
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("jalan ")) return trimmed;
    return `Jalan ${trimmed}`;
  };
  const translateRegion = (value) => {
    if (!value) return null;
    const map = {
      "West Jakarta": "Jakarta Barat",
      "East Jakarta": "Jakarta Timur",
      "South Jakarta": "Jakarta Selatan",
      "North Jakarta": "Jakarta Utara",
      "Central Jakarta": "Jakarta Pusat",
    };
    return map[value] || value;
  };
  const road = normalizeRoad(roadRaw);
  const cityId = translateRegion(city);
  const stateId = translateRegion(state);
  const parts = [];
  if (road) parts.push(road);
  if (area) parts.push(area);
  if (cityId) parts.push(cityId);
  if (stateId) parts.push(stateId);
  if (parts.length) return parts.join(", ");
  return data?.display_name || "Alamat tidak ditemukan.";
};

const reverseGeocode = async (lat, lng) => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error("Gagal mengambil alamat");
    }
    const data = await response.json();
    return formatAddressId(data);
  } catch (error) {
    return "Alamat tidak tersedia.";
  }
};

const updatePresenceAvailability = () => {
  if (!checkinStatus || !checkoutStatus) return;

  if (!navigator.geolocation) {
    const message = "Browser tidak mendukung GPS.";
    setPresenceState(false, checkinStatus, checkinButton, message);
    setPresenceState(false, checkoutStatus, checkoutButton, message);
    if (checkinAddress) checkinAddress.value = "Lokasi tidak tersedia.";
    if (checkoutAddress) checkoutAddress.value = "Lokasi tidak tersedia.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const current = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const accuracy = Math.round(position.coords.accuracy || 0);
      const currentText = `${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}`;
      if (checkinLocation) checkinLocation.value = currentText;
      if (checkoutLocation) checkoutLocation.value = currentText;

      const distance = distanceMeters(current, OFFICE_LOCATION);
      const allowed = distance <= RADIUS_METERS;
      const distanceText = Math.round(distance);
      const accuracyText = accuracy ? `Akurasi ±${accuracy}m.` : "";
      const message = allowed
        ? `Dalam radius kantor (${RADIUS_METERS}m). ${accuracyText}`
        : `Di luar radius kantor (${distanceText}m dari titik). ${accuracyText}`;

      setPresenceState(allowed, checkinStatus, checkinButton, message);
      setPresenceState(allowed, checkoutStatus, checkoutButton, message);
      const addressText = await reverseGeocode(current.lat, current.lng);
      if (checkinAddress) checkinAddress.value = addressText;
      if (checkoutAddress) checkoutAddress.value = addressText;
    },
    () => {
      const message = "Lokasi tidak tersedia. Aktifkan GPS.";
      setPresenceState(false, checkinStatus, checkinButton, message);
      setPresenceState(false, checkoutStatus, checkoutButton, message);
      if (checkinAddress) checkinAddress.value = "Lokasi tidak tersedia.";
      if (checkoutAddress) checkoutAddress.value = "Lokasi tidak tersedia.";
    },
    GEO_OPTIONS
  );
};

const syncCameraDevices = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  cameraDevices = devices.filter((device) => device.kind === "videoinput");
  const track = cameraStream?.getVideoTracks?.()[0];
  const settings = track?.getSettings?.();
  if (settings?.deviceId) {
    const idx = cameraDevices.findIndex(
      (device) => device.deviceId === settings.deviceId
    );
    if (idx >= 0) currentCameraIndex = idx;
  }
};

const startCamera = async (constraints) => {
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: constraints,
    audio: false,
  });
  video.srcObject = cameraStream;
};

const openCamera = async (target) => {
  activePhotoTarget = target;
  cameraStatus.textContent = "Menyiapkan kamera...";
  modal.classList.remove("hidden");
  canvas.classList.add("hidden");
  video.classList.remove("hidden");

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Browser tidak mendukung akses kamera.";
    return;
  }

  try {
    await startCamera({ facingMode: currentFacingMode });
    await syncCameraDevices();
    cameraStatus.textContent = "Arahkan kamera ke wajah Anda.";
  } catch (error) {
    cameraStatus.textContent = "Akses kamera ditolak atau tidak tersedia.";
  }
};

const closeCamera = () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  modal.classList.add("hidden");
};

const switchCamera = async () => {
  cameraStatus.textContent = "Mengganti kamera...";
  try {
    await syncCameraDevices();
    if (cameraDevices.length < 2) {
      cameraStatus.textContent = "Perangkat hanya memiliki satu kamera.";
      return;
    }
    currentCameraIndex =
      (currentCameraIndex + 1) % cameraDevices.length;
    const nextDevice = cameraDevices[currentCameraIndex];
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    await startCamera({ deviceId: { exact: nextDevice.deviceId } });
    cameraStatus.textContent = "Kamera berhasil diganti.";
  } catch (error) {
    cameraStatus.textContent = "Gagal mengganti kamera.";
  }
};

const capturePhoto = () => {
  if (!cameraStream) {
    cameraStatus.textContent = "Kamera belum aktif.";
    return;
  }
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);
  canvas.classList.remove("hidden");
  video.classList.add("hidden");
  cameraStatus.textContent = "Foto tertangkap. Klik Gunakan Foto.";
};

const useCapturedPhoto = () => {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  if (activePhotoTarget === "checkin" && checkinPreview) {
    checkinPreview.src = dataUrl;
    checkinPreview.style.display = "block";
  }
  if (activePhotoTarget === "overtime" && overtimePreview) {
    overtimePreview.src = dataUrl;
    overtimePreview.style.display = "block";
  }
  closeCamera();
};

const retakePhoto = () => {
  canvas.classList.add("hidden");
  video.classList.remove("hidden");
  cameraStatus.textContent = "Ulangi pengambilan foto.";
};

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;

  if (action === "gps-checkin" || action === "gps-checkout") {
    updatePresenceAvailability();
  }

  if (action === "open-camera") {
    const target = event.target.closest("[data-target]")?.dataset.target;
    if (target) openCamera(target);
  }

  if (action === "close-camera") {
    closeCamera();
  }

  if (action === "capture-photo") {
    capturePhoto();
  }

  if (action === "use-photo") {
    useCapturedPhoto();
  }

  if (action === "retake-photo") {
    retakePhoto();
  }

  if (action === "switch-camera") {
    switchCamera();
  }
});

updatePresenceAvailability();
