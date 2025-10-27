"use strict";

/**
 * script.js (lengkap)
 * - Rotasi: WASD + mouse drag
 * - Zoom: scroll & tombol +/-
 * - Kaki depan–belakang (memanjang sumbu Z)
 * - Papan punya border/frame
 * - Ada batang penyangga horizontal hitam di bawah papan
 *
 * Dependensi: MV.js (vec*, mat*, mult, translate, scale, rotateX/Y, flatten) & initShaders.js
 */

let canvas, gl, program;
let modelViewMatrix, projectionMatrix, modelViewMatrixLoc, projectionMatrixLoc;

// Geometri gabungan
let allVertices = [];
let allColors = [];
let allIndices = [];

// State interaksi
let rotationAngles = { x: -20, y: 30 }; // derajat
let boardOnlyRotationAngle = 0; // yaw papan (derajat)
let scaleFactors = { x: 1.0, y: 1.0, z: 1.0 };
let translationOffsets = { x: 0.0, y: 0.0 }; // Translasi X/Y
let isBoardOnlyRotation = false;
let isPerspective = true;
let isAutoRotating = false;

// Mouse drag
let mouseDown = false;
let lastMouseX = null;
let lastMouseY = null;

// Pemisah indeks papan(+frame) vs stand
let boardIndicesCount = 0;

// Kecepatan rotasi & zoom
const ROT_SPEED = 2; // derajat per penekanan tombol
const TRANSLATION_SPEED = 0.1; // kecepatan geser
let zoomFactor = 1.0; // skala global
const ZOOM_STEP = 0.1; // sensitivitas zoom
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 6.0;
const AUTO_ROT_SPEED_Y = 0.3; // Kecepatan rotasi otomatis objek
const AUTO_ROT_SPEED_BOARD = 0.18; // Kecepatan rotasi otomatis papan

window.onload = function init() {
  canvas = document.getElementById("gl-canvas");
  gl = canvas.getContext("webgl2");
  if (!gl) {
    alert("WebGL 2.0 isn't available");
    return;
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.9, 0.9, 0.9, 1.0);
  gl.enable(gl.DEPTH_TEST);

  program = initShaders(gl, "vertex-shader", "fragment-shader");
  gl.useProgram(program);

  buildWhiteboard();
  setupBuffers();

  modelViewMatrixLoc = gl.getUniformLocation(program, "uModelViewMatrix");
  projectionMatrixLoc = gl.getUniformLocation(program, "uProjectionMatrix");

  setupEventListeners();
  render();
};

function buildWhiteboard() {
  const colors = {
    boardFront: vec4(1.0, 1.0, 1.0, 1.0), // permukaan depan
    boardBack: vec4(0.2, 0.2, 0.2, 1.0), // permukaan belakang
    frame: vec4(0.82, 0.82, 0.82, 1.0), // bingkai/border metal
    stand: vec4(0.1, 0.1, 0.1, 1.0), // tiang & batang penyangga
    wheels: vec4(0.3, 0.3, 0.3, 1.0), // roda
  };

  // ====== DIMENSI PAPAN ======
  const boardW = 1.5;
  const boardH = 1.0;
  const boardD = 0.01;

  // 1) Papan dua sisi (depan putih, belakang hitam)
  createPrism(boardW, boardH, boardD, colors.boardFront); // depan
  createPrism(boardW, boardH, boardD, colors.boardBack, translate(0, 0, -0.02)); // belakang

  // 2) Frame/border di sekeliling papan (bagian dari "papan", ikut rotasi papan)
  //    Dibuat di LUAR dimensi papan agar terlihat sebagai bingkai.
  const t = 0.03; // ketebalan frame (lebar garis)
  const fDepth = 0.03; // tebal frame ke arah Z
  // Top & Bottom (memanjang sumbu X)
  createPrism(
    boardW + 2 * t,
    t,
    fDepth,
    colors.frame,
    translate(0, boardH / 2 + t / 2, 0)
  );
  createPrism(
    boardW + 2 * t,
    t,
    fDepth,
    colors.frame,
    translate(0, -boardH / 2 - t / 2, 0)
  );
  // Left & Right (memanjang sumbu Y)
  createPrism(
    t,
    boardH + 2 * t,
    fDepth,
    colors.frame,
    translate(-boardW / 2 - t / 2, 0, 0)
  );
  createPrism(
    t,
    boardH + 2 * t,
    fDepth,
    colors.frame,
    translate(boardW / 2 + t / 2, 0, 0)
  );

  // Sampai titik ini semua yang kita tambahkan adalah bagian "papan".
  // Simpan jumlah indeks papan agar nanti bisa diputar independen.
  boardIndicesCount = allIndices.length;

  // ====== STAND / RANGKA PENOPANG ======
  const standHeight = 1.2;
  const standOffset = boardW / 2;

  // Tiang kiri & kanan (vertikal)
  createPrism(
    0.05,
    standHeight,
    0.05,
    colors.stand,
    translate(-standOffset, -standHeight / 2, 0)
  );
  createPrism(
    0.05,
    standHeight,
    0.05,
    colors.stand,
    translate(standOffset, -standHeight / 2, 0)
  );

  // Batang penyangga horizontal PERSIS di bawah papan (seperti foto)
  // Memanjang ke samping (sumbu X), menghubungkan kedua tiang.
  const braceY = -0.55; // sedikit di bawah tepi bawah papan (yang y=-0.5)
  const braceW = 1.55; // mendekati jarak antar tiang
  createPrism(braceW, 0.05, 0.05, colors.stand, translate(0, braceY, 0));

  // Kaki bawah — memanjang DEPAN–BELAKANG (sumbu Z)
  const feetDepth = 0.6; // panjang ke depan–belakang
  const feetThicknessX = 0.05; // tipis ke kiri–kanan
  const feetHeight = 0.05;
  const feetYPos = -standHeight + 0.05;

  // Kaki kiri & kanan (memanjang Z)
  createPrism(
    feetThicknessX,
    feetHeight,
    feetDepth,
    colors.stand,
    translate(-standOffset, feetYPos, 0)
  );
  createPrism(
    feetThicknessX,
    feetHeight,
    feetDepth,
    colors.stand,
    translate(standOffset, feetYPos, 0)
  );

  // Roda di ujung depan & belakang tiap kaki
  const wheelYPos = feetYPos - 0.05;
  const wheelOffsetZ = feetDepth / 2 - 0.03;
  const wheelRadius = 0.05;
  const wheelWidth = 0.03;

  // Matriks rotasi untuk memutar silinder agar "berdiri" di sumbu Y
  const wheelRotation = rotateZ(90);

  createCylinder(
    wheelRadius,
    wheelWidth,
    colors.wheels,
    mult(translate(-standOffset, wheelYPos, -wheelOffsetZ), wheelRotation)
  );
  createCylinder(
    wheelRadius,
    wheelWidth,
    colors.wheels,
    mult(translate(-standOffset, wheelYPos, wheelOffsetZ), wheelRotation)
  );
  createCylinder(
    wheelRadius,
    wheelWidth,
    colors.wheels,
    mult(translate(standOffset, wheelYPos, -wheelOffsetZ), wheelRotation)
  );
  createCylinder(
    wheelRadius,
    wheelWidth,
    colors.wheels,
    mult(translate(standOffset, wheelYPos, wheelOffsetZ), wheelRotation)
  );
}

function createCylinder(radius, height, color, transformMatrix = mat4()) {
  const segments = 20; // Jumlah segmen untuk membuat lingkaran (semakin banyak semakin halus)
  const angleStep = (2 * Math.PI) / segments;
  const halfHeight = height / 2;

  const baseVertices = [];

  // Buat verteks untuk lingkaran atas dan bawah
  for (let i = 0; i < segments; i++) {
    const angle = i * angleStep;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    // Verteks bawah
    baseVertices.push(vec4(x, -halfHeight, z, 1.0));
    // Verteks atas
    baseVertices.push(vec4(x, halfHeight, z, 1.0));
  }

  // Tambahkan pusat atas dan bawah untuk tutup
  const bottomCenterIndex = baseVertices.length;
  baseVertices.push(vec4(0, -halfHeight, 0, 1.0));
  const topCenterIndex = baseVertices.length;
  baseVertices.push(vec4(0, halfHeight, 0, 1.0));

  const baseIndices = [];
  for (let i = 0; i < segments; i++) {
    const i0 = i * 2;
    const i1 = i0 + 1;
    const i2 = ((i + 1) % segments) * 2;
    const i3 = i2 + 1;

    // Sisi silinder (2 segitiga per segmen)
    baseIndices.push(i0, i2, i1);
    baseIndices.push(i1, i2, i3);

    // Tutup bawah
    baseIndices.push(i0, bottomCenterIndex, i2);
    // Tutup atas
    baseIndices.push(i1, i3, topCenterIndex);
  }

  const finalMatrix = transformMatrix;
  const indexOffset = allVertices.length;

  for (let i = 0; i < baseVertices.length; i++) {
    const tv = mult(finalMatrix, baseVertices[i]);
    allVertices.push(vec3(tv[0], tv[1], tv[2]));
    allColors.push(color);
  }
  for (let i = 0; i < baseIndices.length; i++) {
    allIndices.push(baseIndices[i] + indexOffset);
  }
}

// Prisma (kubus di-skala) + transform opsional
function createPrism(width, height, depth, color, transformMatrix = mat4()) {
  const baseVertices = [
    vec4(-0.5, -0.5, 0.5, 1.0),
    vec4(-0.5, 0.5, 0.5, 1.0),
    vec4(0.5, 0.5, 0.5, 1.0),
    vec4(0.5, -0.5, 0.5, 1.0),
    vec4(-0.5, -0.5, -0.5, 1.0),
    vec4(-0.5, 0.5, -0.5, 1.0),
    vec4(0.5, 0.5, -0.5, 1.0),
    vec4(0.5, -0.5, -0.5, 1.0),
  ];

  const baseIndices = [
    1, 0, 3, 3, 2, 1, 2, 3, 7, 7, 6, 2, 3, 0, 4, 4, 7, 3, 6, 5, 1, 1, 2, 6, 4,
    5, 6, 6, 7, 4, 5, 4, 0, 0, 1, 5,
  ];

  const finalMatrix = mult(transformMatrix, scale(width, height, depth));
  const indexOffset = allVertices.length;

  for (let i = 0; i < baseVertices.length; i++) {
    const tv = mult(finalMatrix, baseVertices[i]);
    allVertices.push(vec3(tv[0], tv[1], tv[2]));
    allColors.push(color);
  }
  for (let i = 0; i < baseIndices.length; i++) {
    allIndices.push(baseIndices[i] + indexOffset);
  }
}

function setupBuffers() {
  // Warna
  const cBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allColors), gl.STATIC_DRAW);
  const aColor = gl.getAttribLocation(program, "aColor");
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Posisi
  const vBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allVertices), gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(program, "aPosition");
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Indeks
  const iBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(allIndices),
    gl.STATIC_DRAW
  );
}

function setupEventListeners() {
  // Mouse drag
  canvas.onmousedown = (e) => {
    // Hentikan rotasi otomatis saat pengguna berinteraksi
    if (isAutoRotating) {
      isAutoRotating = false;
      document.getElementById("auto-rotate-toggle").innerText =
        "▶️ Mulai Rotasi Otomatis";
    }
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  };
  canvas.onmouseup = () => {
    mouseDown = false;
  };
  canvas.onmouseleave = () => {
    mouseDown = false;
  };
  canvas.onmousemove = (e) => {
    if (!mouseDown) return;
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;

    if (isBoardOnlyRotation) {
      boardOnlyRotationAngle += deltaY; // pitch papan
    } else {
      rotationAngles.y += deltaX;
      rotationAngles.x += deltaY;
    }
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  };

  // Zoom (scroll)
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1; // up = in, down = out
      zoomFactor *= 1 + dir * ZOOM_STEP;
      zoomFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomFactor));
    },
    { passive: false }
  );

  // Keyboard WASD + +/-
  window.addEventListener("keydown", (e) => {
    // Hentikan rotasi otomatis saat pengguna berinteraksi
    if (isAutoRotating) {
      isAutoRotating = false;
      document.getElementById("auto-rotate-toggle").innerText =
        "▶️ Mulai Rotasi Otomatis";
    }

    const k = e.key.toLowerCase(); // untuk w,a,s,d
    const key = e.key; // untuk tombol non-karakter seperti panah

    // Zoom via +/-
    if (e.key === "+" || e.key === "=") {
      zoomFactor *= 1 + ZOOM_STEP;
      zoomFactor = Math.min(zoomFactor, ZOOM_MAX);
    } else if (e.key === "-" || e.key === "_") {
      zoomFactor *= 1 - ZOOM_STEP;
      zoomFactor = Math.max(zoomFactor, ZOOM_MIN);
    }

    // Cegah aksi default browser (seperti scroll) untuk tombol kontrol
    if (
      ["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
        key
      )
    ) {
      e.preventDefault();
    }

    if (isBoardOnlyRotation) {
      if (k === "w") boardOnlyRotationAngle -= ROT_SPEED;
      if (k === "s") boardOnlyRotationAngle += ROT_SPEED;
      return; // A/D dan tombol panah diabaikan di mode papan
    }

    // Rotasi global
    switch (k) {
      case "w": rotationAngles.x -= ROT_SPEED; break;
      case "s": rotationAngles.x += ROT_SPEED; break;
      case "a": rotationAngles.y -= ROT_SPEED; break;
      case "d": rotationAngles.y += ROT_SPEED; break;
    }

    // Translasi global (geser)
    switch (key) {
      case "ArrowUp": translationOffsets.y += TRANSLATION_SPEED; break;
      case "ArrowDown": translationOffsets.y -= TRANSLATION_SPEED; break;
      case "ArrowLeft": translationOffsets.x -= TRANSLATION_SPEED; break;
      case "ArrowRight": translationOffsets.x += TRANSLATION_SPEED; break;
    }
  });

  // Reset
  const resetBtn = document.getElementById("reset-button");
  if (resetBtn) {
    resetBtn.onclick = () => {
      rotationAngles = { x: -20, y: 30 };
      boardOnlyRotationAngle = 0;
      scaleFactors = { x: 1.0, y: 1.0, z: 1.0 };
      translationOffsets = { x: 0.0, y: 0.0 }; // Reset translasi
      zoomFactor = 1.0;
      isPerspective = true;
      isAutoRotating = false; // Matikan juga auto-rotate
      document.getElementById("auto-rotate-toggle").innerText =
        "▶️ Mulai Rotasi Otomatis";
      const sx = document.getElementById("scale-x");
      const sy = document.getElementById("scale-y");
      if (sx) sx.value = 1.0;
      if (sy) sy.value = 1.0;
    };
  }

  // Toggle mode papan
  const toggleBtn = document.getElementById("board-rotation-toggle");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      isBoardOnlyRotation = !isBoardOnlyRotation;
      toggleBtn.innerText = isBoardOnlyRotation
        ? "↕️ Mode: Putar Papan Saja"
        : "↔️ Mode: Putar Semua Objek";
    };
  }

  // Toggle Proyeksi
  const projBtn = document.getElementById("projection-toggle");
  if (projBtn) {
    projBtn.onclick = () => {
      isPerspective = !isPerspective;
      projBtn.innerHTML = isPerspective
        ? "🔭 Mode: Proyeksi Perspektif"
        : "📐 Mode: Proyeksi Ortografik";
    };
  }

  // Toggle Auto-Rotate
  const autoRotateBtn = document.getElementById("auto-rotate-toggle");
  if (autoRotateBtn) {
    autoRotateBtn.onclick = () => {
      isAutoRotating = !isAutoRotating;
      autoRotateBtn.innerText = isAutoRotating
        ? "⏸️ Hentikan Rotasi"
        : "▶️ Mulai Rotasi Otomatis";
    };
  }

  // Slider skala X/Y (opsional)
  const scaleX = document.getElementById("scale-x");
  const scaleY = document.getElementById("scale-y");
  if (scaleX)
    scaleX.oninput = (e) => (scaleFactors.x = parseFloat(e.target.value));
  if (scaleY)
    scaleY.oninput = (e) => (scaleFactors.y = parseFloat(e.target.value));
}

function render() {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Jika auto-rotate aktif, perbarui sudut rotasi di setiap frame
  if (isAutoRotating) {
    rotationAngles.y = (rotationAngles.y + AUTO_ROT_SPEED_Y) % 360;
    boardOnlyRotationAngle = (boardOnlyRotationAngle + AUTO_ROT_SPEED_BOARD) % 360;
  }

  // Atur matriks proyeksi
  const aspect = canvas.width / canvas.height;
  if (isPerspective) {
    projectionMatrix = perspective(45, aspect, 0.1, 100);
  } else {
    // Sesuaikan parameter ortho agar objek tidak terlalu besar/kecil
    const zoom = 3.0;
    projectionMatrix = ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -10, 10);
  }
  gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

  // Transformasi global (skala + zoom + rotasi)
  let baseMatrix = mult(rotateX(rotationAngles.x), rotateY(rotationAngles.y));
  baseMatrix = mult(
    scale(
      scaleFactors.x * zoomFactor,
      scaleFactors.y * zoomFactor,
      scaleFactors.z * zoomFactor
    ),
    baseMatrix
  );

  // Gabungkan dengan matriks view:
  // - Translasi dari input pengguna (panah)
  // - Translasi ke belakang agar objek terlihat di mode perspektif
  const viewMatrix = translate(translationOffsets.x, translationOffsets.y, -5);
  baseMatrix = mult(viewMatrix, baseMatrix);

  // Papan (dengan rotasi khusus papan) - DIGAMBAR DULU (Front-to-Back)
  // Ini memastikan depth buffer diisi oleh objek terdekat terlebih dahulu,
  // mencegah artefak visual di mana objek belakang "menembus" objek depan.
  const boardRotationMatrix = rotateX(boardOnlyRotationAngle);
  modelViewMatrix = mult(baseMatrix, boardRotationMatrix);
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
  gl.drawElements(gl.TRIANGLES, boardIndicesCount, gl.UNSIGNED_SHORT, 0);

  // Stand (semua selain papan)
  modelViewMatrix = baseMatrix;
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
  gl.drawElements(
    gl.TRIANGLES,
    allIndices.length - boardIndicesCount,
    gl.UNSIGNED_SHORT,
    boardIndicesCount * 2 // Offset untuk memulai dari data stand
  );

  requestAnimationFrame(render);
}
