const DEFAULT_OFFICE_LOCATION = { lat: -6.1421841, lng: 106.8164501 };
const DEFAULT_RADIUS_METERS = 200;
const DEFAULT_MAX_ACCURACY_METERS = 80;
const DEFAULT_MAX_POSITION_AGE_MS = 120000;
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
const overtimeButton = document.querySelector("#overtime-btn");
const checkinAddress = document.querySelector("#checkin-address");
const checkoutAddress = document.querySelector("#checkout-address");
const absenPanel = document.querySelector("#absen");
const checkinSection = document.querySelector("#checkin-section");
const checkinNote = document.querySelector("#checkin-note");
const checkoutSection = document.querySelector("#checkout-section");
const checkoutNote = document.querySelector("#checkout-note");
const overtimeSection = document.querySelector("#overtime-section");
const overtimeEndSection = document.querySelector("#overtime-end-section");
const overtimeEndButton = document.querySelector("#overtime-end-btn");
const overtimeNote = document.querySelector("#overtime-note");

const modal = document.querySelector("#camera-modal");
const video = document.querySelector("#camera-video");
const canvas = document.querySelector("#camera-canvas");
const cameraStatus = document.querySelector("#camera-status");
const checkinPreview = document.querySelector("#checkin-preview");
const overtimePreview = document.querySelector("#overtime-preview");
const flashButton = document.querySelector('[data-action="toggle-flash"]');

let cameraStream = null;
let activePhotoTarget = null;
let currentFacingMode = "environment";
let cameraDevices = [];
let currentCameraIndex = 0;
let hasCapturedPhoto = false;
let latestPosition = null;
let latestAddress = null;
let torchEnabled = false;
let torchSupported = false;
let audioContext = null;

const csrfToken = document
  .querySelector('meta[name="csrf-token"]')
  ?.getAttribute("content");

let hasCheckin = absenPanel?.dataset.hasCheckin === "1";
let hasCheckout = absenPanel?.dataset.hasCheckout === "1";
let isOvertime = absenPanel?.dataset.isOvertime === "1";
const workStart = absenPanel?.dataset.workStart;
const lateTolerance = parseInt(absenPanel?.dataset.lateTolerance || "0", 10);
const serverTime = absenPanel?.dataset.serverTime;
let checkinTime = absenPanel?.dataset.checkinTime || "";
let checkoutTime = absenPanel?.dataset.checkoutTime || "";
const officeLat =
  parseFloat(absenPanel?.dataset.officeLat || "") || DEFAULT_OFFICE_LOCATION.lat;
const officeLng =
  parseFloat(absenPanel?.dataset.officeLng || "") || DEFAULT_OFFICE_LOCATION.lng;
const officeRadius =
  parseInt(absenPanel?.dataset.officeRadius || "", 10) || DEFAULT_RADIUS_METERS;
const maxAccuracy =
  parseInt(absenPanel?.dataset.maxAccuracy || "", 10) ||
  DEFAULT_MAX_ACCURACY_METERS;
const maxPositionAgeMs =
  parseInt(absenPanel?.dataset.maxAgeSeconds || "", 10) * 1000 ||
  DEFAULT_MAX_POSITION_AGE_MS;
const officeLocation = { lat: officeLat, lng: officeLng };

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
  const url = `/api/reverse-geocode?lat=${lat}&lng=${lng}`;
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
        accuracy: Math.round(position.coords.accuracy || 0),
        timestamp: position.timestamp || Date.now(),
      };
      latestPosition = current;
      const accuracy = current.accuracy;
      const positionAgeMs = Math.max(0, Date.now() - current.timestamp);
      const currentText = `${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}`;
      if (checkinLocation) checkinLocation.value = currentText;
      if (checkoutLocation) checkoutLocation.value = currentText;

      const distance = distanceMeters(current, officeLocation);
      const withinRadius = distance <= officeRadius;
      const accuracyOk = accuracy > 0 && accuracy <= maxAccuracy;
      const ageOk = positionAgeMs <= maxPositionAgeMs;
      const allowed = withinRadius && accuracyOk && ageOk;
      const distanceText = Math.round(distance);
      const accuracyText = accuracy ? `Akurasi ±${accuracy}m.` : "";
      const ageText =
        !ageOk && positionAgeMs
          ? `Lokasi terlalu lama (${Math.round(positionAgeMs / 1000)} detik).`
          : "";
      let message = `Dalam radius kantor (${officeRadius}m). ${accuracyText}`;
      if (!withinRadius) {
        message = `Di luar radius kantor (${distanceText}m dari titik). ${accuracyText}`;
      } else if (!accuracyOk) {
        message = `Akurasi GPS terlalu rendah (maks ${maxAccuracy}m). ${accuracyText}`;
      } else if (!ageOk) {
        message = `Lokasi sudah terlalu lama. ${ageText}`.trim();
      }

      setPresenceState(
        allowed && !hasCheckin,
        checkinStatus,
        checkinButton,
        message
      );
      setPresenceState(
        allowed && hasCheckin && !hasCheckout,
        checkoutStatus,
        checkoutButton,
        message
      );
      const addressText = await reverseGeocode(current.lat, current.lng);
      latestAddress = addressText;
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

const updateSectionVisibility = () => {
  if (checkinSection && checkinNote) {
    checkinSection.classList.toggle("hidden", hasCheckin);
    checkinNote.classList.toggle("hidden", !hasCheckin);
    if (hasCheckin) {
      const text = checkinTime ? `Sudah absen masuk jam ${checkinTime}.` : "Sudah absen masuk.";
      checkinNote.querySelector(".muted").textContent = text;
    }
  }

  if (checkoutSection && checkoutNote) {
    const hideCheckout = isOvertime || hasCheckout;
    checkoutSection.classList.toggle("hidden", hideCheckout);
    checkoutNote.classList.toggle("hidden", !hasCheckout || isOvertime);
    if (hasCheckout && !isOvertime) {
      const text = checkoutTime
        ? `Sudah absen keluar jam ${checkoutTime}.`
        : "Sudah absen keluar.";
      checkoutNote.querySelector(".muted").textContent = text;
    }
  }

  if (overtimeSection) {
    const now = new Date();
    const showOvertime = now.getHours() >= 18 && hasCheckin && !isOvertime;
    overtimeSection.classList.toggle("hidden", !showOvertime);
  }

  if (overtimeEndSection) {
    overtimeEndSection.classList.toggle("hidden", !isOvertime);
    if (overtimeEndButton) {
      overtimeEndButton.disabled = !isOvertime;
    }
  }

  if (overtimeNote) {
    overtimeNote.classList.toggle("hidden", !isOvertime);
  }
};

const formatDuration = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours} jam ${minutes} menit ${seconds} detik`;
};

const updateLateStatus = () => {
  if (!absenPanel || !checkinStatus || !workStart || hasCheckin) return;

  const baseNow = serverTime ? new Date(serverTime) : new Date();
  const now = new Date();
  const nowMs = now.getTime();
  const driftMs = nowMs - baseNow.getTime();
  const [h, m, s] = workStart.split(":").map((value) => parseInt(value, 10));
  const start = new Date(now);
  start.setHours(h || 0, m || 0, s || 0, 0);
  const startMs = start.getTime() + driftMs;

  const diffSeconds = Math.floor((nowMs - startMs) / 1000) - lateTolerance * 60;
  if (diffSeconds > 0) {
    checkinStatus.textContent = `Telat ${formatDuration(diffSeconds)}`;
    checkinStatus.style.color = "var(--accent-3)";
  } else {
    const remaining = Math.abs(diffSeconds);
    checkinStatus.textContent = `Belum telat · Mulai ${workStart} · ${formatDuration(
      remaining
    )}`;
    checkinStatus.style.color = "var(--accent-2)";
  }
};

const updateOvertimeAvailability = () => {
  if (!overtimeButton) return;
  const now = new Date();
  const can = now.getHours() >= 18 && hasCheckin && !isOvertime;
  overtimeButton.disabled = !can;
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRF-TOKEN": csrfToken || "",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Terjadi kesalahan.");
  }
  return data;
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

const syncTorchSupport = () => {
  const track = cameraStream?.getVideoTracks?.()[0];
  const capabilities = track?.getCapabilities?.();
  torchSupported = !!capabilities?.torch;
  if (flashButton) {
    flashButton.classList.toggle("hidden", !torchSupported);
    flashButton.disabled = !torchSupported;
    flashButton.setAttribute(
      "aria-label",
      torchEnabled ? "Matikan flash" : "Nyalakan flash"
    );
  }
};

const setTorch = async (enabled) => {
  const track = cameraStream?.getVideoTracks?.()[0];
  if (!track || !torchSupported) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: enabled }] });
    torchEnabled = enabled;
    if (flashButton) {
      flashButton.setAttribute(
        "aria-label",
        torchEnabled ? "Matikan flash" : "Nyalakan flash"
      );
    }
  } catch (error) {
    torchEnabled = false;
    if (flashButton) {
      flashButton.setAttribute("aria-label", "Nyalakan flash");
    }
  }
};

const openCamera = async (target) => {
  activePhotoTarget = target;
  hasCapturedPhoto = false;
  torchEnabled = false;
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
    syncTorchSupport();
    cameraStatus.textContent = "Arahkan kamera lalu tekan tombol kamera.";
  } catch (error) {
    cameraStatus.textContent = "Akses kamera ditolak atau tidak tersedia.";
  }
};

const closeCamera = () => {
  if (torchEnabled) {
    setTorch(false);
  }
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
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    if (cameraDevices.length >= 2) {
      currentCameraIndex = (currentCameraIndex + 1) % cameraDevices.length;
      const nextDevice = cameraDevices[currentCameraIndex];
      await startCamera({ deviceId: { exact: nextDevice.deviceId } });
      torchEnabled = false;
      syncTorchSupport();
      cameraStatus.textContent = "Kamera berhasil diganti.";
      return;
    }
    currentFacingMode =
      currentFacingMode === "environment" ? "user" : "environment";
    await startCamera({ facingMode: currentFacingMode });
    torchEnabled = false;
    syncTorchSupport();
    cameraStatus.textContent = "Kamera berhasil diganti.";
  } catch (error) {
    try {
      currentFacingMode =
        currentFacingMode === "environment" ? "user" : "environment";
      await startCamera({ facingMode: currentFacingMode });
      torchEnabled = false;
      syncTorchSupport();
      cameraStatus.textContent = "Kamera berhasil diganti.";
    } catch (fallbackError) {
      cameraStatus.textContent = "Gagal mengganti kamera.";
    }
  }
};

const capturePhoto = () => {
  if (!cameraStream) {
    cameraStatus.textContent = "Kamera belum aktif.";
    return;
  }
  playShutterSound();
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);
  canvas.classList.remove("hidden");
  video.classList.add("hidden");
  hasCapturedPhoto = true;
  cameraStatus.textContent = "Foto tertangkap. Klik ikon centang untuk gunakan.";
};

const playShutterSound = () => {
  try {
    if (!audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audioContext = new Context();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const now = audioContext.currentTime;
    const sampleRate = audioContext.sampleRate;

    const playBurst = (startTime, duration, peakGain, freq) => {
      const buffer = audioContext.createBuffer(
        1,
        Math.floor(sampleRate * duration),
        sampleRate
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      const filter = audioContext.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(freq, startTime);
      filter.Q.setValueAtTime(0.8, startTime);
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.004);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime + duration
      );
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioContext.destination);
      source.start(startTime);
      source.stop(startTime + duration);
    };

    const playClick = (startTime, duration, peakGain, freq) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.002);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime + duration
      );
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    playBurst(now, 0.055, 0.18, 1800);
    playClick(now + 0.008, 0.02, 0.12, 1300);
    playBurst(now + 0.07, 0.045, 0.12, 1400);
    playClick(now + 0.082, 0.018, 0.1, 1100);
  } catch (error) {
    // Ignore audio errors to avoid blocking photo capture.
  }
};

const useCapturedPhoto = () => {
  if (!hasCapturedPhoto) {
    cameraStatus.textContent = "Ambil foto terlebih dahulu.";
    return;
  }
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
  hasCapturedPhoto = false;
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

  if (action === "toggle-flash") {
    setTorch(!torchEnabled);
  }
});

if (checkinButton) {
  checkinButton.addEventListener("click", async () => {
    if (checkinButton.disabled) return;
    if (!latestPosition) {
      checkinStatus.textContent = "Lokasi belum tersedia.";
      return;
    }
    if (!checkinPreview?.src) {
      checkinStatus.textContent = "Ambil foto absen terlebih dahulu.";
      return;
    }
    try {
      const result = await postJson("/absen/checkin", {
        lat: latestPosition.lat,
        lng: latestPosition.lng,
        accuracy: latestPosition.accuracy,
        position_timestamp: latestPosition.timestamp,
        address: latestAddress,
        photo: checkinPreview.src,
      });
      hasCheckin = true;
      checkinTime = result.checkinTime || checkinTime;
      checkinButton.disabled = true;
      checkoutButton.disabled = false;
      checkinStatus.textContent = result.message || "Absen masuk berhasil.";
      updateSectionVisibility();
      updatePresenceAvailability();
    } catch (error) {
      checkinStatus.textContent = error.message;
    }
  });
}

if (checkoutButton) {
  checkoutButton.addEventListener("click", async () => {
    if (checkoutButton.disabled) return;
    if (!latestPosition) {
      checkoutStatus.textContent = "Lokasi belum tersedia.";
      return;
    }
    try {
      const result = await postJson("/absen/checkout", {
        lat: latestPosition.lat,
        lng: latestPosition.lng,
        accuracy: latestPosition.accuracy,
        position_timestamp: latestPosition.timestamp,
        address: latestAddress,
      });
      hasCheckout = true;
      checkoutTime = result.checkoutTime || checkoutTime;
      checkoutButton.disabled = true;
      checkoutStatus.textContent = result.message || "Absen keluar berhasil.";
      updateSectionVisibility();
      updatePresenceAvailability();
    } catch (error) {
      checkoutStatus.textContent = error.message;
    }
  });
}

if (overtimeButton) {
  overtimeButton.addEventListener("click", async () => {
    if (overtimeButton.disabled) return;
    if (!hasCheckin) {
      checkoutStatus.textContent = "Absen masuk dulu sebelum lembur.";
      return;
    }
    if (!overtimePreview?.src) {
      checkoutStatus.textContent = "Ambil bukti lembur terlebih dahulu.";
      return;
    }
    try {
      const result = await postJson("/absen/overtime", {});
      isOvertime = true;
      overtimeButton.disabled = true;
      checkoutStatus.textContent = result.message || "Absen lembur aktif.";
      updateSectionVisibility();
    } catch (error) {
      checkoutStatus.textContent = error.message;
    }
  });
}

if (overtimeEndButton) {
  overtimeEndButton.addEventListener("click", async () => {
    if (overtimeEndButton.disabled) return;
    try {
      const result = await postJson("/absen/overtime-end", {});
      isOvertime = false;
      hasCheckout = true;
      checkoutTime = result.checkoutTime || checkoutTime;
      checkoutStatus.textContent =
        result.message || "Absen keluar lembur berhasil.";
      updateSectionVisibility();
      updatePresenceAvailability();
    } catch (error) {
      checkoutStatus.textContent = error.message;
    }
  });
}

updatePresenceAvailability();
updateLateStatus();
updateOvertimeAvailability();
updateSectionVisibility();
setInterval(updateLateStatus, 1000);
setInterval(updateOvertimeAvailability, 30000);
