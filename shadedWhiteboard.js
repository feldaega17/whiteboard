'use strict';

/**
 * shadedWhiteboard.js
 * - Implementasi Phong Shading (per-fragment lighting).
 * - Kontrol interaktif untuk posisi & warna cahaya.
 * - Fitur warna frame dinamis (manual & RGB).
 * - Fitur tekstur dinamis (generated, checkerboard, image).
 */

let canvas, gl, program, fboProgram; // Program utama dan program untuk FBO
let modelViewMatrix, projectionMatrix;

// Buffer
let mainCBuffer, mainTBuffer, mainNBuffer, mainVBuffer, mainIBuffer;

// Lokasi Uniform Matriks
let modelViewMatrixLoc, projectionMatrixLoc, nMatrixLoc;

// Lokasi Uniform Pencahayaan & Tekstur
let uLightAmbientLoc,
  uLightDiffuseLoc,
  uLightSpecularLoc,
  uLightPositionLoc,
  uShininessLoc,
  uSamplerLoc,
  uTextureModeLoc,
  uDrawingSamplerLoc; // Sampler untuk tekstur gambar

// Geometri gabungan
let allVertices = [];
let allColors = []; // Digunakan sebagai warna material (diffuse)
let allNormals = []; // Array untuk menyimpan normal
let allTexCoords = []; // Array untuk menyimpan koordinat tekstur
let allIndices = [];

// --- Geometri & State Objek Terpisah (untuk animasi) ---
let markerVertices = [],
  markerNormals = [],
  markerColors = [],
  markerIndices = [];
let eraserVertices = [],
  eraserNormals = [],
  eraserColors = [],
  eraserIndices = [];
let markerBuffers, eraserBuffers;
let isDrawingAnimation = false;
let isErasingAnimation = false;
let animationTime = 0;

// --- State Pencahayaan ---
let lightPosition = vec4(1.5, 2.0, 4.0, 1.0);
let lightAmbient = vec4(0.2, 0.2, 0.2, 1.0);
let lightDiffuse = vec4(1.0, 1.0, 1.0, 1.0);
let lightSpecular = vec4(1.0, 1.0, 1.0, 1.0);
let materialShininess = 100.0;
let isLightAutoMoving = false;
let lightAnimationTime = 0;

// --- State FBO untuk Menggambar ---
let drawingFBO;
let drawingTexture;
const FBO_WIDTH = 1024,
  FBO_HEIGHT = 512;
let fboLocations; // Lokasi untuk shader FBO
let fboPointBuffer;
let fboSquareBuffer;

// --- State Tekstur ---
let textTexture, checkerboardTexture, imageTexture;
let currentTexture;
let textureMode = 0; // 0: Modulate, 1: Decal

// --- State Interaksi ---
let rotationAngles = { x: -20, y: 30 };
let boardOnlyRotationAngle = 0;
let scaleFactors = { x: 1.0, y: 1.0, z: 1.0 };
let translationOffsets = { x: 0.0, y: 0.0 };
let isBoardOnlyRotation = false;
let isPerspective = true;
let isAutoRotating = false;

// --- State Warna Frame ---
let frameColor = hexToVec4('#c2c2c2');
let isFrameRgbCycling = false;
let frameRgbTime = 0;
let frameVertexStartIndex = 0;
let frameVertexCount = 0;

// Mouse drag
let mouseDown = false;
let lastMouseX = null;
let lastMouseY = null;

// Pemisah indeks
let boardIndicesCount = 0;

// Konstanta kecepatan
const ROT_SPEED = 2;
const TRANSLATION_SPEED = 0.1;
let zoomFactor = 1.0;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 6.0;
const AUTO_ROT_SPEED_Y = 0.3;
const AUTO_ROT_SPEED_BOARD = 0.18;

window.onload = function init() {
  canvas = document.getElementById('gl-canvas');
  gl = canvas.getContext('webgl2');
  if (!gl) {
    alert("WebGL 2.0 isn't available");
    return;
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.4, 0.4, 0.4, 1.0);
  gl.enable(gl.DEPTH_TEST);

  // Inisialisasi dua program shader
  program = initShaders(gl, "vertex-shader", "fragment-shader");
  fboProgram = initShaders(gl, "fbo-vertex-shader", "fbo-fragment-shader");
  gl.useProgram(program);

  // Dapatkan lokasi semua uniform
  getShaderLocations();

  // Buat FBO dan tekstur untuk menggambar
  initFBO();

  // Buat semua tekstur
  textTexture = createTextTexture();
  checkerboardTexture = createCheckerboardTexture();
  imageTexture = loadImageTexture('simba.jpeg');
  currentTexture = textTexture; // Tekstur default

  buildWhiteboard();
  createMainBuffers();
  setupEventListeners();

  // Buat objek animasi terpisah
  buildAnimatedObjects();

  // Inisialisasi papan dengan membersihkannya
  clearDrawing();

  render();
};

function getShaderLocations() {
  // Program utama (3D)
  modelViewMatrixLoc = gl.getUniformLocation(program, 'uModelViewMatrix');
  projectionMatrixLoc = gl.getUniformLocation(program, 'uProjectionMatrix');
  nMatrixLoc = gl.getUniformLocation(program, 'uNormalMatrix');
  uLightAmbientLoc = gl.getUniformLocation(program, 'uLightAmbient');
  uLightDiffuseLoc = gl.getUniformLocation(program, 'uLightDiffuse');
  uLightSpecularLoc = gl.getUniformLocation(program, 'uLightSpecular');
  uLightPositionLoc = gl.getUniformLocation(program, 'uLightPosition');
  uShininessLoc = gl.getUniformLocation(program, 'uShininess');
  uSamplerLoc = gl.getUniformLocation(program, 'uSampler');
  uDrawingSamplerLoc = gl.getUniformLocation(program, 'uDrawingSampler');
  uTextureModeLoc = gl.getUniformLocation(program, 'uTextureMode');

  // Program FBO (2D)
  fboLocations = {
    position: gl.getAttribLocation(fboProgram, 'a_position'),
    pointSize: gl.getUniformLocation(fboProgram, 'u_pointSize'),
    color: gl.getUniformLocation(fboProgram, 'u_color'),
  };

  // Buffer untuk menggambar titik (spidol)
  fboPointBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fboPointBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0]), gl.DYNAMIC_DRAW);

  // Buffer untuk menggambar kotak (penghapus)
  fboSquareBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fboSquareBuffer);
  const eraserSize = 0.15; // Ukuran kuas penghapus di ruang clip-space
  const square = [
    -eraserSize, -eraserSize,
     eraserSize, -eraserSize,
    -eraserSize,  eraserSize,
     eraserSize,  eraserSize,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(square), gl.DYNAMIC_DRAW);
}

function createTextTexture() {
  const textCanvas = document.createElement('canvas');
  const ctx = textCanvas.getContext('2d');
  const canvasWidth = 512;
  const canvasHeight = 256;
  textCanvas.width = canvasWidth;
  textCanvas.height = canvasHeight;

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.font = "bold 48px 'Comic Sans MS', cursive, sans-serif";
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('aku ❤️ grafkom', canvasWidth / 2, canvasHeight / 2);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Gunakan pixelStorei untuk membalik gambar secara vertikal saat di-upload ke GPU
  // Ini adalah cara yang lebih efisien daripada membalik koordinat tekstur
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Kembalikan pengaturan pixelStorei ke default agar tidak mempengaruhi tekstur lain
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  return texture;
}

function createCheckerboardTexture() {
  const texSize = 64;
  const numChecks = 8;
  const image = new Uint8Array(4 * texSize * texSize);
  for (let i = 0; i < texSize; i++) {
    for (let j = 0; j < texSize; j++) {
      const patchx = Math.floor(i / (texSize / numChecks));
      const patchy = Math.floor(j / (texSize / numChecks));
      const c = (patchx % 2 !== patchy % 2) ? 255 : 0;
      const idx = 4 * (i * texSize + j);
      image[idx] = c;
      image[idx + 1] = c;
      image[idx + 2] = c;
      image[idx + 3] = 255;
    }
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texSize, texSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function loadImageTexture(url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Placeholder 1x1 piksel biru saat gambar sedang dimuat
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));

  const image = new Image();
  image.src = url;
  image.onload = function () {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Reset to default
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  };
  return texture;
}

function initFBO() {
  // 1. Buat Framebuffer
  drawingFBO = gl.createFramebuffer();

  // 2. Buat tekstur tujuan
  drawingTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, drawingTexture);
  // Alokasikan memori untuk tekstur, tapi jangan isi datanya dulu
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FBO_WIDTH, FBO_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  // Atur parameter tekstur
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // 3. Kaitkan tekstur ke FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawingFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, drawingTexture, 0);

  // 4. Periksa apakah FBO sudah lengkap
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error('FBO tidak lengkap: ' + status.toString(16));
    // Cari tahu error spesifik
    if (status === gl.FRAMEBUFFER_UNSUPPORTED) {
        console.error("Kombinasi format FBO tidak didukung oleh hardware ini.");
    } else if (status === gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT) {
        console.error("Attachment FBO tidak lengkap.");
    } // ... tambahkan pengecekan lain jika perlu
    return;
  }

  // 5. Lepaskan ikatan (unbind) FBO agar kita kembali menggambar ke canvas utama
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function buildWhiteboard() {
  const materials = {
    boardFront: vec4(1.0, 1.0, 1.0, 1.0),
    boardBack: vec4(0.2, 0.2, 0.2, 1.0),
    frame: vec4(0.82, 0.82, 0.82, 1.0),
    stand: vec4(0.15, 0.15, 0.15, 1.0),
    wheels: vec4(0.3, 0.3, 0.3, 1.0),
  };

  const boardW = 1.5,
    boardH = 1.0,
    boardD = 0.01;
  const t = 0.03,
    fDepth = 0.03;

  // Papan depan dengan koordinat tekstur
  const boardFrontTexCoords = [
    vec2(0, 0),
    vec2(1, 0),
    vec2(1, 1),
    vec2(0, 1), // Front
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0), // Back
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0), // etc.
  ];
  createPrism(
    boardW,
    boardH,
    boardD,
    materials.boardFront,
    mat4(),
    boardFrontTexCoords
  );
  // Papan belakang
  createPrism(
    boardW,
    boardH,
    boardD,
    materials.boardBack,
    translate(0, 0, -0.02),
  );

  // Frame (catat indeksnya untuk perubahan warna)
  frameVertexStartIndex = allVertices.length;
  createPrism(
    boardW + 2 * t,
    t,
    fDepth,
    materials.frame,
    translate(0, boardH / 2 + t / 2, 0)
  );
  createPrism(
    boardW + 2 * t,
    t,
    fDepth,
    materials.frame,
    translate(0, -boardH / 2 - t / 2, 0)
  );
  createPrism(
    t,
    boardH + 2 * t,
    fDepth,
    materials.frame,
    translate(-boardW / 2 - t / 2, 0, 0)
  );
  createPrism(
    t,
    boardH + 2 * t,
    fDepth,
    materials.frame,
    translate(boardW / 2 + t / 2, 0, 0)
  );
  frameVertexCount = allVertices.length - frameVertexStartIndex;

  boardIndicesCount = allIndices.length;

  const standHeight = 1.2,
    standOffset = boardW / 2;
  createPrism(
    0.05,
    standHeight,
    0.05,
    materials.stand,
    translate(-standOffset, -standHeight / 2, 0)
  );
  createPrism(
    0.05,
    standHeight,
    0.05,
    materials.stand,
    translate(standOffset, -standHeight / 2, 0)
  );

  const braceY = -0.55,
    braceW = 1.55;
  createPrism(braceW, 0.05, 0.05, materials.stand, translate(0, braceY, 0));

  const feetDepth = 0.6,
    feetThicknessX = 0.05,
    feetHeight = 0.05;
  const feetYPos = -standHeight + 0.05;
  createPrism(
    feetThicknessX,
    feetHeight,
    feetDepth,
    materials.stand,
    translate(-standOffset, feetYPos, 0)
  );
  createPrism(
    feetThicknessX,
    feetHeight,
    feetDepth,
    materials.stand,
    translate(standOffset, feetYPos, 0)
  );

  const wheelYPos = feetYPos - 0.05,
    wheelOffsetZ = feetDepth / 2 - 0.03;
  const wheelRadius = 0.05,
    wheelWidth = 0.03;
  const wheelRotation = rotateZ(90);
  // createCylinder(
  //   wheelRadius,
  //   wheelWidth,
  //   materials.wheels,
  //   mult(translate(-standOffset, wheelYPos, -wheelOffsetZ), wheelRotation)
  // );
  // createCylinder(
  //   wheelRadius,
  //   wheelWidth,
  //   materials.wheels,
  //   mult(translate(-standOffset, wheelYPos, wheelOffsetZ), wheelRotation)
  // );
  // createCylinder(
  //   wheelRadius,
  //   wheelWidth,
  //   materials.wheels,
  //   mult(translate(standOffset, wheelYPos, -wheelOffsetZ), wheelRotation)
  // );
  // createCylinder(
  //   wheelRadius,
  //   wheelWidth,
  //   materials.wheels,
  //   mult(translate(standOffset, wheelYPos, wheelOffsetZ), wheelRotation)
  // );
}

// Function to build marker and eraser geometries and their separate buffers
function buildAnimatedObjects() {
  // --- SPIDOL ---
  const markerRadius = 0.02;
  const markerHeight = 0.25;
  const markerColor = vec4(0.8, 0.1, 0.1, 1.0); // Merah

  // Simpan data geometri spidol ke array terpisah
  createCylinderSeparate(markerRadius, markerHeight, markerColor, markerVertices, markerNormals, markerColors, markerIndices);
  markerBuffers = setupObjectBuffers(markerVertices, markerNormals, markerColors, markerIndices);

  // --- PENGHAPUS ---
  const eraserW = 0.2;
  const eraserH = 0.1;
  const eraserD = 0.08;
  const eraserColor = vec4(0.2, 0.2, 0.5, 1.0); // Biru tua

  // Simpan data geometri penghapus ke array terpisah
  createPrismSeparate(eraserW, eraserH, eraserD, eraserColor, eraserVertices, eraserNormals, eraserColors, eraserIndices);
  eraserBuffers = setupObjectBuffers(eraserVertices, eraserNormals, eraserColors, eraserIndices);
}

// Helper to create cylinder geometry into separate arrays
function createCylinderSeparate(radius, height, color, outVertices, outNormals, outColors, outIndices) {
  // Temporarily swap global arrays to populate separate arrays
  const tempAllVertices = allVertices, tempAllNormals = allNormals, tempAllColors = allColors, tempAllIndices = allIndices;
  allVertices = outVertices; allNormals = outNormals; allColors = outColors; allIndices = outIndices;
  createCylinder(radius, height, color, mat4());
  allVertices = tempAllVertices; allNormals = tempAllNormals; allColors = tempAllColors; allIndices = tempAllIndices;
}

// Helper to create prism geometry into separate arrays
function createPrismSeparate(width, height, depth, color, outVertices, outNormals, outColors, outIndices) {
  // Temporarily swap global arrays to populate separate arrays
  const tempAllVertices = allVertices, tempAllNormals = allNormals, tempAllColors = allColors, tempAllIndices = allIndices;
  allVertices = outVertices; allNormals = outNormals; allColors = outColors; allIndices = outIndices;
  createPrism(width, height, depth, color, mat4());
  allVertices = tempAllVertices; allNormals = tempAllNormals; allColors = tempAllColors; allIndices = tempAllIndices;
}

function createPrism(
  width,
  height,
  depth,
  color,
  transformMatrix = mat4(),
  texCoords = null
) {
  const indexOffset = allVertices.length;

  const vertices = [
    // Front face
    vec4(-0.5, -0.5, 0.5, 1.0),
    vec4(0.5, -0.5, 0.5, 1.0),
    vec4(0.5, 0.5, 0.5, 1.0),
    vec4(-0.5, 0.5, 0.5, 1.0),
    // Back face
    vec4(-0.5, -0.5, -0.5, 1.0),
    vec4(-0.5, 0.5, -0.5, 1.0),
    vec4(0.5, 0.5, -0.5, 1.0),
    vec4(0.5, -0.5, -0.5, 1.0),
    // Top face
    vec4(-0.5, 0.5, 0.5, 1.0),
    vec4(0.5, 0.5, 0.5, 1.0),
    vec4(0.5, 0.5, -0.5, 1.0),
    vec4(-0.5, 0.5, -0.5, 1.0),
    // Bottom face
    vec4(-0.5, -0.5, -0.5, 1.0),
    vec4(0.5, -0.5, -0.5, 1.0),
    vec4(0.5, -0.5, 0.5, 1.0),
    vec4(-0.5, -0.5, 0.5, 1.0),
    // Right face
    vec4(0.5, -0.5, 0.5, 1.0),
    vec4(0.5, -0.5, -0.5, 1.0),
    vec4(0.5, 0.5, -0.5, 1.0),
    vec4(0.5, 0.5, 0.5, 1.0),
    // Left face
    vec4(-0.5, -0.5, -0.5, 1.0),
    vec4(-0.5, -0.5, 0.5, 1.0),
    vec4(-0.5, 0.5, 0.5, 1.0),
    vec4(-0.5, 0.5, -0.5, 1.0),
  ];

  // Default texCoords jika tidak disediakan (semua 0,0)
  const finalTexCoords = texCoords || [
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
    vec2(0, 0),
  ];

  // Pastikan panjang texCoords sesuai dengan jumlah vertex per sisi
  const baseTexCoords = [
    finalTexCoords[0],
    finalTexCoords[1],
    finalTexCoords[2],
    finalTexCoords[3], // Front
    ...Array(20).fill(vec2(0, 0)), // Sisi lain tidak pakai tekstur
  ];

  const normals = [
    // Front
    vec3(0, 0, 1),
    vec3(0, 0, 1),
    vec3(0, 0, 1),
    vec3(0, 0, 1),
    // Back
    vec3(0, 0, -1),
    vec3(0, 0, -1),
    vec3(0, 0, -1),
    vec3(0, 0, -1),
    // Top
    vec3(0, 1, 0),
    vec3(0, 1, 0),
    vec3(0, 1, 0),
    vec3(0, 1, 0),
    // Bottom
    vec3(0, -1, 0),
    vec3(0, -1, 0),
    vec3(0, -1, 0),
    vec3(0, -1, 0),
    // Right
    vec3(1, 0, 0),
    vec3(1, 0, 0),
    vec3(1, 0, 0),
    vec3(1, 0, 0),
    // Left
    vec3(-1, 0, 0),
    vec3(-1, 0, 0),
    vec3(-1, 0, 0),
    vec3(-1, 0, 0),
  ];

  const indices = [
    0,
    1,
    2,
    0,
    2,
    3, // front
    4,
    5,
    6,
    4,
    6,
    7, // back
    8,
    9,
    10,
    8,
    10,
    11, // top
    12,
    13,
    14,
    12,
    14,
    15, // bottom
    16,
    17,
    18,
    16,
    18,
    19, // right
    20,
    21,
    22,
    20,
    22,
    23, // left
  ];

  const finalMatrix = mult(transformMatrix, scale(width, height, depth));
  const nMatrix = normalMatrix(finalMatrix, true);

  for (let i = 0; i < vertices.length; i++) {
    const tv = mult(finalMatrix, vertices[i]);
    const tn = mult(nMatrix, normals[i]);
    allVertices.push(vec3(tv[0], tv[1], tv[2]));
    allNormals.push(normalize(vec3(tn[0], tn[1], tn[2])));
    allTexCoords.push(baseTexCoords[i] || vec2(0, 0)); // Tambahkan tex coord
    allColors.push(color);
  }
  for (let i = 0; i < indices.length; i++) {
    allIndices.push(indices[i] + indexOffset);
  }
}

function createCylinder(radius, height, color, transformMatrix = mat4()) {
  const segments = 20;
  const angleStep = (2 * Math.PI) / segments;
  const halfHeight = height / 2;
  const indexOffset = allVertices.length;

  const finalMatrix = transformMatrix;
  const nMatrix = normalMatrix(finalMatrix, true);

  let baseVertices = [];
  let baseNormals = [];
  let baseIndices = [];

  // --- SIDES ---
  for (let i = 0; i <= segments; i++) {
    const angle = i * angleStep;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    const sideNormal = vec3(x, 0, z);

    baseVertices.push(vec4(radius * x, halfHeight, radius * z, 1.0));
    baseNormals.push(sideNormal);
    baseVertices.push(vec4(radius * x, -halfHeight, radius * z, 1.0));
    baseNormals.push(sideNormal);
  }

  for (let i = 0; i < segments; i++) {
    const i0 = i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    baseIndices.push(i0, i1, i2);
    baseIndices.push(i1, i3, i2);
  }

  // --- CAPS ---
  let capVertexOffset = baseVertices.length;

  // Top Cap
  baseVertices.push(vec4(0, halfHeight, 0, 1.0));
  baseNormals.push(vec3(0, 1, 0));
  for (let i = 0; i <= segments; i++) {
    const angle = i * angleStep;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    baseVertices.push(vec4(radius * x, halfHeight, radius * z, 1.0));
    baseNormals.push(vec3(0, 1, 0));
  }
  for (let i = 0; i < segments; i++) {
    baseIndices.push(
      capVertexOffset,
      capVertexOffset + i + 1,
      capVertexOffset + i + 2
    );
  }

  capVertexOffset = baseVertices.length;

  // Bottom Cap
  baseVertices.push(vec4(0, -halfHeight, 0, 1.0));
  baseNormals.push(vec3(0, -1, 0));
  for (let i = 0; i <= segments; i++) {
    const angle = i * angleStep;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    baseVertices.push(vec4(radius * x, -halfHeight, radius * z, 1.0));
    baseNormals.push(vec3(0, -1, 0));
  }
  for (let i = 0; i < segments; i++) {
    baseIndices.push(
      capVertexOffset,
      capVertexOffset + i + 2,
      capVertexOffset + i + 1
    );
  }

  // --- Push to global arrays ---
  for (let i = 0; i < baseVertices.length; i++) {
    const tv = mult(finalMatrix, baseVertices[i]);
    const tn = mult(nMatrix, baseNormals[i]);
    allVertices.push(vec3(tv[0], tv[1], tv[2]));
    allNormals.push(normalize(vec3(tn[0], tn[1], tn[2])));
    allColors.push(color);
  }
  for (let i = 0; i < baseIndices.length; i++) {
    allIndices.push(baseIndices[i] + indexOffset);
  }
}

// Function to create and populate the main buffers (for whiteboard and stand) once
function createMainBuffers() {
  // Buffer Warna Material
  mainCBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainCBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allColors), gl.DYNAMIC_DRAW);

  // Buffer Koordinat Tekstur
  mainTBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainTBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allTexCoords), gl.STATIC_DRAW);

  // Buffer Normal
  mainNBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainNBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allNormals), gl.STATIC_DRAW);

  // Buffer Posisi
  mainVBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allVertices), gl.STATIC_DRAW);

  // Buffer Indeks
  mainIBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mainIBuffer);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(allIndices),
    gl.STATIC_DRAW
  );
}

function setupObjectBuffers(vertices, normals, colors, indices) {
    const aColor = gl.getAttribLocation(program, 'aColor');
    const aNormal = gl.getAttribLocation(program, 'aNormal');
    const aPosition = gl.getAttribLocation(program, 'aPosition');

    const cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW);

    const nBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(normals), gl.STATIC_DRAW);

    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertices), gl.STATIC_DRAW);

    const iBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    return {
        cBuffer,
        nBuffer,
        vBuffer,
        iBuffer,
        numIndices: indices.length,
        attribs: {
            aColor, aNormal, aPosition
        }
    };
}

function bindMainBuffersAndEnableAttributes() {
  const aColor = gl.getAttribLocation(program, 'aColor');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainCBuffer);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0); // Use mainCBuffer
  gl.enableVertexAttribArray(aColor);

  const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainTBuffer);
  gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0); // Use mainTBuffer
  gl.enableVertexAttribArray(aTexCoord);

  const aNormal = gl.getAttribLocation(program, 'aNormal');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainNBuffer);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0); // Use mainNBuffer
  gl.enableVertexAttribArray(aNormal);

  const aPosition = gl.getAttribLocation(program, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainVBuffer);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0); // Use mainVBuffer
  gl.enableVertexAttribArray(aPosition);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mainIBuffer); // Use mainIBuffer
}

function hexToVec4(hex) {
  let r = 0,
    g = 0,
    b = 0;
  if (hex.length == 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length == 7) {
    r = parseInt(hex[1] + hex[2], 16);
    g = parseInt(hex[3] + hex[4], 16);
    b = parseInt(hex[5] + hex[6], 16);
  }
  return vec4(r / 255, g / 255, b / 255, 1.0);
}

function updateFrameColor(color) {
  for (let i = 0; i < frameVertexCount; i++) {
    allColors[frameVertexStartIndex + i] = color;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, mainCBuffer); // Use mainCBuffer
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    frameVertexStartIndex * 16, // 16 bytes per vec4 (4 floats * 4 bytes)
    flatten(
      allColors.slice(
        frameVertexStartIndex,
        frameVertexStartIndex + frameVertexCount
      )
    )
  );
}

function disableAutoLight() {
  if (isLightAutoMoving) {
    isLightAutoMoving = false;
    document.getElementById('auto-light-toggle').innerText =
      '▶️ Mulai Gerak Cahaya Otomatis';
  }
}

function setupEventListeners() {
  document.getElementById('light-x').oninput = (e) => {
    lightPosition[0] = parseFloat(e.target.value);
    disableAutoLight();
  };
  document.getElementById('light-y').oninput = (e) => {
    lightPosition[1] = parseFloat(e.target.value);
    disableAutoLight();
  };
  document.getElementById('light-z').oninput = (e) => {
    lightPosition[2] = parseFloat(e.target.value);
    disableAutoLight();
  };
  document.getElementById('light-ambient').oninput = (e) =>
    (lightAmbient = hexToVec4(e.target.value));
  document.getElementById('light-diffuse').oninput = (e) =>
    (lightDiffuse = hexToVec4(e.target.value));
  document.getElementById('light-specular').oninput = (e) =>
    (lightSpecular = hexToVec4(e.target.value));
  document.getElementById('shininess').oninput = (e) =>
    (materialShininess = parseFloat(e.target.value));

  // Kontrol Warna Frame
  document.getElementById('frame-color').oninput = (e) => {
    isFrameRgbCycling = false;
    document.getElementById('frame-rgb-toggle').innerText = '🌈 Mode: Warna Statis';
    frameColor = hexToVec4(e.target.value);
    updateFrameColor(frameColor);
  };
  document.getElementById('frame-rgb-toggle').onclick = () => {
    isFrameRgbCycling = !isFrameRgbCycling;
    document.getElementById('frame-rgb-toggle').innerText = isFrameRgbCycling
      ? '🌈 Mode: Warna RGB'
      : '🌈 Mode: Warna Statis';
  };

  // Kontrol Tekstur
  document.getElementById('texture-select').onchange = (e) => {
    switch (e.target.value) {
      case 'text':
        currentTexture = textTexture;
        break;
      case 'checkerboard':
        currentTexture = checkerboardTexture;
        break;
      case 'image':
        currentTexture = imageTexture;
        break;
    }
  };
  document.getElementById('texture-mode').onchange = (e) => {
    textureMode = parseInt(e.target.value);
  };

  // Kontrol Animasi
  document.getElementById('draw-animation-toggle').onclick = () => {
      isDrawingAnimation = !isDrawingAnimation;
      isErasingAnimation = false; // Matikan animasi lain
      animationTime = 0; // Reset waktu
      document.getElementById('draw-animation-toggle').innerText = isDrawingAnimation ? '✏️ Hentikan Animasi' : '✏️ Mulai Animasi Menggambar';
      document.getElementById('erase-animation-toggle').innerText = '🧽 Mulai Animasi Menghapus';
  };

  document.getElementById('erase-animation-toggle').onclick = () => {
      isErasingAnimation = !isErasingAnimation;
      isDrawingAnimation = false; // Matikan animasi lain
      animationTime = 0; // Reset waktu
      document.getElementById('erase-animation-toggle').innerText = isErasingAnimation ? '🧽 Hentikan Animasi' : '🧽 Mulai Animasi Menghapus';
      document.getElementById('draw-animation-toggle').innerText = '✏️ Mulai Animasi Menggambar';
  };

  document.getElementById('clear-board-button').onclick = clearDrawing;

  const stopAnimations = () => {
      isDrawingAnimation = false;
      isErasingAnimation = false;
      document.getElementById('draw-animation-toggle').innerText = '✏️ Mulai Animasi Menggambar';
      document.getElementById('erase-animation-toggle').innerText = '🧽 Mulai Animasi Menghapus';
  }

  canvas.onmousedown = (e) => {
    if (isAutoRotating) {
      isAutoRotating = false;
      document.getElementById('auto-rotate-toggle').innerText =
        '▶️ Mulai Rotasi Otomatis';
    }
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    stopAnimations();
  };
  canvas.onmouseup = () => (mouseDown = false);
  canvas.onmouseleave = () => (mouseDown = false);
  canvas.onmousemove = (e) => {
    if (!mouseDown) return;
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    if (isBoardOnlyRotation) {
      boardOnlyRotationAngle += deltaY;
    } else {
      rotationAngles.y += deltaX;
      rotationAngles.x += deltaY;
    }
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  };

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      zoomFactor *= 1 + dir * ZOOM_STEP;
      zoomFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomFactor));
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (isAutoRotating) {
      isAutoRotating = false;
      document.getElementById('auto-rotate-toggle').innerText =
        '▶️ Mulai Rotasi Otomatis';
    }
    stopAnimations();
    const k = e.key.toLowerCase();
    const key = e.key;
    if (key === '+' || key === '=')
      zoomFactor = Math.min(zoomFactor * (1 + ZOOM_STEP), ZOOM_MAX);
    else if (key === '-' || key === '_')
      zoomFactor = Math.max(zoomFactor * (1 - ZOOM_STEP), ZOOM_MIN);

    if (
      [
        'w',
        'a',
        's',
        'd',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(key)
    )
      e.preventDefault();

    if (isBoardOnlyRotation) {
      if (k === 'w') boardOnlyRotationAngle -= ROT_SPEED;
      if (k === 's') boardOnlyRotationAngle += ROT_SPEED;
      return;
    }

    switch (k) {
      case 'w':
        rotationAngles.x -= ROT_SPEED;
        break;
      case 's':
        rotationAngles.x += ROT_SPEED;
        break;
      case 'a':
        rotationAngles.y -= ROT_SPEED;
        break;
      case 'd':
        rotationAngles.y += ROT_SPEED;
        break;
    }
    switch (key) {
      case 'ArrowUp':
        translationOffsets.y += TRANSLATION_SPEED;
        break;
      case 'ArrowDown':
        translationOffsets.y -= TRANSLATION_SPEED;
        break;
      case 'ArrowLeft':
        translationOffsets.x -= TRANSLATION_SPEED;
        break;
      case 'ArrowRight':
        translationOffsets.x += TRANSLATION_SPEED;
        break;
    }
  });

  document.getElementById('reset-button').onclick = () => {
    rotationAngles = { x: -20, y: 30 };
    boardOnlyRotationAngle = 0;
    scaleFactors = { x: 1.0, y: 1.0, z: 1.0 };
    translationOffsets = { x: 0.0, y: 0.0 };
    zoomFactor = 1.0;
    isPerspective = true;
    isAutoRotating = false;
    document.getElementById('auto-rotate-toggle').innerText =
      '▶️ Mulai Rotasi Otomatis';
    document.getElementById('scale-x').value = 1.0;
    document.getElementById('scale-y').value = 1.0;
    document.getElementById('light-x').value = 1.5;
    document.getElementById('light-y').value = 2.0;
    document.getElementById('light-z').value = 4.0;
    document.getElementById('light-ambient').value = '#202020';
    document.getElementById('light-diffuse').value = '#ffffff';
    document.getElementById('light-specular').value = '#ffffff';
    document.getElementById('shininess').value = 100;
    lightPosition = vec4(1.5, 2.0, 4.0, 1.0);
    lightAmbient = hexToVec4('#202020');
    lightDiffuse = hexToVec4('#ffffff');
    lightSpecular = hexToVec4('#ffffff');
    materialShininess = 100.0;
    isLightAutoMoving = false;
    document.getElementById('auto-light-toggle').innerText =
      '▶️ Mulai Gerak Cahaya Otomatis';
    lightAnimationTime = 0;

    // Reset Frame Color
    isFrameRgbCycling = false;
    document.getElementById('frame-rgb-toggle').innerText = '🌈 Mode: Warna Statis';
    document.getElementById('frame-color').value = '#c2c2c2';
    frameColor = hexToVec4('#c2c2c2');
    updateFrameColor(frameColor);

    // Reset Tekstur
    document.getElementById('texture-select').value = 'text';
    document.getElementById('texture-mode').value = '0';
    currentTexture = textTexture;
    textureMode = 0;

    // Reset Animasi
    stopAnimations();

    // Bersihkan papan
    clearDrawing();


  };

  document.getElementById('board-rotation-toggle').onclick = () => {
    isBoardOnlyRotation = !isBoardOnlyRotation;
    document.getElementById('board-rotation-toggle').innerText =
      isBoardOnlyRotation
        ? '↕️ Mode: Putar Papan Saja'
        : '↔️ Mode: Putar Semua Objek';
  };

  document.getElementById('projection-toggle').onclick = () => {
    isPerspective = !isPerspective;
    document.getElementById('projection-toggle').innerHTML = isPerspective
      ? '🔭 Mode: Proyeksi Perspektif'
      : '📐 Mode: Proyeksi Ortografik';
  };

  document.getElementById('auto-rotate-toggle').onclick = () => {
    isAutoRotating = !isAutoRotating;
    document.getElementById('auto-rotate-toggle').innerText = isAutoRotating
      ? '⏸️ Hentikan Rotasi'
      : '▶️ Mulai Rotasi Otomatis';
  };

  document.getElementById('auto-light-toggle').onclick = () => {
    isLightAutoMoving = !isLightAutoMoving;
    document.getElementById('auto-light-toggle').innerText = isLightAutoMoving
      ? '⏸️ Hentikan Gerak Cahaya'
      : '▶️ Mulai Gerak Cahaya Otomatis';
  };

  document.getElementById('scale-x').oninput = (e) =>
    (scaleFactors.x = parseFloat(e.target.value));
  document.getElementById('scale-y').oninput = (e) =>
    (scaleFactors.y = parseFloat(e.target.value));
}

function drawObject(buffers, modelMatrix) {
    const { cBuffer, nBuffer, vBuffer, iBuffer, numIndices, attribs } = buffers;

    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.vertexAttribPointer(attribs.aColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.aColor); // Enable attribute for this object

    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.aNormal); // Enable attribute for this object

    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.aPosition); // Enable attribute for this object

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelMatrix));
    gl.drawElements(gl.TRIANGLES, numIndices, gl.UNSIGNED_SHORT, 0);
}

function drawOnBoard(x, y, isErasing) {
  // 1. Bind FBO untuk menggambar ke tekstur
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawingFBO);
  gl.viewport(0, 0, FBO_WIDTH, FBO_HEIGHT);

  // 2. Gunakan program shader 2D
  gl.useProgram(fboProgram);

  // 3. Atur atribut dan uniform
  gl.enableVertexAttribArray(fboLocations.position);

  if (isErasing) {
    // Gambar kotak putih besar untuk menghapus
    gl.bindBuffer(gl.ARRAY_BUFFER, fboSquareBuffer);
    gl.vertexAttribPointer(fboLocations.position, 2, gl.FLOAT, false, 0, 0);
    // Pindahkan kotak ke posisi kursor
    const translatedSquare = new Float32Array([
      -0.15 + x, -0.15 + y,
       0.15 + x, -0.15 + y,
      -0.15 + x,  0.15 + y,
       0.15 + x,  0.15 + y,
    ]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, translatedSquare);
    gl.uniform4fv(fboLocations.color, flatten(vec4(1, 1, 1, 1))); // Warna putih
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    // Gambar titik hitam untuk menggambar
    gl.bindBuffer(gl.ARRAY_BUFFER, fboPointBuffer);
    gl.vertexAttribPointer(fboLocations.position, 2, gl.FLOAT, false, 0, 0);
    // Pindahkan titik ke posisi kursor
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([x, y]));
    gl.uniform1f(fboLocations.pointSize, 10.0); // Ukuran kuas
    gl.uniform4fv(fboLocations.color, flatten(vec4(0, 0, 0, 1))); // Warna hitam
    gl.drawArrays(gl.POINTS, 0, 1);
  }

  // 4. Unbind FBO dan kembalikan ke program utama
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(program);
  gl.viewport(0, 0, canvas.width, canvas.height); // Kembalikan viewport
}

function clearDrawing() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawingFBO);
  gl.clearColor(1.0, 1.0, 1.0, 1.0); // Warna putih
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Unbind FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // Kembalikan warna clear default untuk canvas utama
  gl.clearColor(0.4, 0.4, 0.4, 1.0);
}

function render() {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Update waktu animasi
  if (isDrawingAnimation || isErasingAnimation) {
    animationTime += 0.015; // Sedikit dipercepat
    if (isDrawingAnimation && animationTime > 3) animationTime = 0; // Durasi animasi gambar 3 detik
    if (isErasingAnimation && animationTime > 2) animationTime = 0; // Durasi animasi hapus 2 detik

    let animX3D, animY3D;

    if (isDrawingAnimation) {
      // Animasi menggambar segitiga
      const p1 = vec2(-0.4, -0.3);
      const p2 = vec2(0.4, -0.3);
      const p3 = vec2(0.0, 0.4);

      if (animationTime < 1.0) { // Sisi 1: P1 -> P2
        const t = animationTime;
        const pos = mix(p1, p2, t);
        animX3D = pos[0];
        animY3D = pos[1];
      } else if (animationTime < 2.0) { // Sisi 2: P2 -> P3
        const t = animationTime - 1.0;
        const pos = mix(p2, p3, t);
        animX3D = pos[0];
        animY3D = pos[1];
      } else { // Sisi 3: P3 -> P1
        const t = animationTime - 2.0;
        const pos = mix(p3, p1, t);
        animX3D = pos[0];
        animY3D = pos[1];
      }
    } else { // isErasingAnimation
      animX3D = -0.6 + 1.2 * (animationTime / 2);
      animY3D = 0.2 * Math.sin(animationTime * Math.PI * 4);
    }

    const texX = (animX3D + 0.75) / 1.5;
    const texY = (animY3D + 0.5) / 1.0;

    // Gambar ke FBO
    drawOnBoard(texX * 2 - 1, texY * 2 - 1, isErasingAnimation); // Konversi ke clip space [-1, 1]
  }

  if (isAutoRotating) {
    rotationAngles.y = (rotationAngles.y + AUTO_ROT_SPEED_Y) % 360;
    boardOnlyRotationAngle =
      (boardOnlyRotationAngle + AUTO_ROT_SPEED_BOARD) % 360;
  }

  if (isLightAutoMoving) {
    lightAnimationTime += 0.008; // Kecepatan animasi dikurangi
    const radius = 6.0;
    const yAmplitude = 3.0;
    const yOffset = 2.5;

    // Gerakan melingkar di sumbu XZ dan Y dengan kecepatan sama
    lightPosition[0] = Math.cos(lightAnimationTime) * radius;
    lightPosition[1] = Math.sin(lightAnimationTime) * yAmplitude + yOffset;
    lightPosition[2] = Math.sin(lightAnimationTime) * radius;

    // Perbarui juga nilai di slider agar sinkron
    document.getElementById('light-x').value = lightPosition[0];
    document.getElementById('light-y').value = lightPosition[1];
    document.getElementById('light-z').value = lightPosition[2];
  }

  if (isFrameRgbCycling) {
    frameRgbTime += 0.02;
    const r = Math.sin(frameRgbTime * 1.0) * 0.5 + 0.5;
    const g = Math.sin(frameRgbTime * 1.0 + 2.0) * 0.5 + 0.5;
    const b = Math.sin(frameRgbTime * 1.0 + 4.0) * 0.5 + 0.5;
    frameColor = vec4(r, g, b, 1.0);
    updateFrameColor(frameColor);
    // Perbarui UI color picker
    const hexColor =
      '#' +
      [r, g, b]
        .map((c) =>
          Math.round(c * 255)
            .toString(16)
            .padStart(2, '0')
        )
        .join('');
    document.getElementById('frame-color').value = hexColor;
  }

  const aspect = canvas.width / canvas.height;
  if (isPerspective) {
    projectionMatrix = perspective(45, aspect, 0.1, 100);
  } else {
    const zoom = 3.0;
    projectionMatrix = ortho(
      -zoom * aspect,
      zoom * aspect,
      -zoom,
      zoom,
      -10,
      10
    );
  }
  gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

  let baseMatrix = mult(rotateX(rotationAngles.x), rotateY(rotationAngles.y));
  baseMatrix = mult(
    scale(
      scaleFactors.x * zoomFactor,
      scaleFactors.y * zoomFactor,
      scaleFactors.z * zoomFactor
    ),
    baseMatrix
  );

  const viewMatrix = translate(translationOffsets.x, translationOffsets.y, -5);
  baseMatrix = mult(viewMatrix, baseMatrix);

  // Kirim uniform pencahayaan global ke shader
  gl.uniform4fv(uLightPositionLoc, flatten(lightPosition));
  gl.uniform4fv(uLightAmbientLoc, flatten(lightAmbient));
  gl.uniform4fv(uLightDiffuseLoc, flatten(lightDiffuse));
  gl.uniform4fv(uLightSpecularLoc, flatten(lightSpecular));
  gl.uniform1f(uShininessLoc, materialShininess);

  bindMainBuffersAndEnableAttributes();

  // Bind tekstur ke unit yang berbeda
  // Unit 0: Tekstur dasar (teks, simba, dll)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, currentTexture);
  gl.uniform1i(uSamplerLoc, 0);

  // Unit 1: Tekstur gambar dinamis dari FBO
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, drawingTexture);
  gl.uniform1i(uDrawingSamplerLoc, 1);

  gl.uniform1i(uTextureModeLoc, textureMode);

  // Gambar Papan
  const boardRotationMatrix = rotateX(boardOnlyRotationAngle);
  modelViewMatrix = mult(baseMatrix, boardRotationMatrix);
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
  let nMatrix = normalMatrix(modelViewMatrix, true);
  gl.uniformMatrix3fv(nMatrixLoc, false, flatten(nMatrix));
  gl.drawElements(gl.TRIANGLES, boardIndicesCount, gl.UNSIGNED_SHORT, 0);

  // Gambar Stand
  modelViewMatrix = baseMatrix;
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
  nMatrix = normalMatrix(modelViewMatrix, true);
  gl.uniformMatrix3fv(nMatrixLoc, false, flatten(nMatrix));
  gl.drawElements(
    gl.TRIANGLES,
    allIndices.length - boardIndicesCount,
    gl.UNSIGNED_SHORT,
    boardIndicesCount * 2
  );

  // --- Gambar Objek Animasi (Spidol & Penghapus) ---
  // Matriks ini akan menempatkan objek di atas papan dan membuatnya ikut berputar dengan papan
  const boardObjectBaseMatrix = mult(baseMatrix, boardRotationMatrix);

  // Posisi istirahat di atas tatakan bawah
  const trayY = -0.55;
  const trayZ = 0.05;

  // --- Spidol ---
  let markerMatrix;
  if (isDrawingAnimation) {
      // Animasi: bergerak horizontal di tengah papan
      let animX, animY;
      const p1 = vec2(-0.4, -0.3);
      const p2 = vec2(0.4, -0.3);
      const p3 = vec2(0.0, 0.4);

      if (animationTime < 1.0) {
        const pos = mix(p1, p2, animationTime);
        [animX, animY] = pos;
      } else if (animationTime < 2.0) {
        const pos = mix(p2, p3, animationTime - 1.0);
        [animX, animY] = pos;
      } else {
        const pos = mix(p3, p1, animationTime - 2.0);
        [animX, animY] = pos;
      }

      const animZ = 0.02; // Sedikit di depan papan
      markerMatrix = mult(boardObjectBaseMatrix, translate(animX, animY, animZ));
      markerMatrix = mult(markerMatrix, rotateZ(90)); // Tidurkan spidol
  } else {
      // Posisi istirahat
      markerMatrix = mult(boardObjectBaseMatrix, translate(-0.3, trayY + 0.02, trayZ));
  }
  modelViewMatrix = markerMatrix;
  nMatrix = normalMatrix(modelViewMatrix, true);
  gl.uniformMatrix3fv(nMatrixLoc, false, flatten(nMatrix));
  drawObject(markerBuffers, modelViewMatrix);

  // --- Penghapus ---
  let eraserMatrix;
  if (isErasingAnimation) {
      // Animasi: bergerak zig-zag
      const animX = -0.6 + 1.2 * (animationTime / 2);
      const animY = 0.2 * Math.sin(animationTime * Math.PI * 4); // Gerak naik-turun
      const animZ = 0.02;
      eraserMatrix = mult(boardObjectBaseMatrix, translate(animX, animY, animZ));
  } else {
      // Posisi istirahat
      eraserMatrix = mult(boardObjectBaseMatrix, translate(0.3, trayY + 0.05, trayZ));
  }
  modelViewMatrix = eraserMatrix;
  nMatrix = normalMatrix(modelViewMatrix, true);
  gl.uniformMatrix3fv(nMatrixLoc, false, flatten(nMatrix));
  drawObject(eraserBuffers, modelViewMatrix);

  // Kembalikan buffer utama untuk gambar berikutnya
  bindMainBuffersAndEnableAttributes();

  requestAnimationFrame(render);
}