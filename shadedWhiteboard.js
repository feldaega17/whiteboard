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
let wheelVertices = [],
  wheelNormals = [],
  wheelColors = [],
  wheelIndices = [];
let platformVertices = [],
  platformNormals = [],
  platformColors = [],
  platformIndices = [];
let isPlatformVisible = true; // State untuk mengontrol visibilitas alas

let markerBuffers, eraserBuffers, wheelBuffers, platformBuffers;
let isDrawingAnimation = false;
let isErasingAnimation = false;
let animationTime = 0;
let lastTime = 0; // Moved to global scope

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
let textTexture, checkerboardTexture, imageTexture, whiteTexture;
let currentTexture;
let textureMode = 0; // 0: Modulate, 1: Decal

// --- State Interaksi ---
let rotationAngles = { x: -20, y: 30 };
let boardOnlyRotationAngle = 0;
let wheelRotationAngle = 0;
let scaleFactors = { x: 1.0, y: 1.0, z: 1.0 };
let translationOffsets = { x: 0.0, y: 0.0, z: 0.0 };
let isBoardOnlyRotation = false;
let isPerspective = true;
let isAutoRotating = false;
let isShowcaseAnimating = false;
let showcaseStage = 0;
let showcaseTime = 0;

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

  program = initShaders(gl, "vertex-shader", "fragment-shader");
  fboProgram = initShaders(gl, "fbo-vertex-shader", "fbo-fragment-shader");
  gl.useProgram(program);

  getShaderLocations();
  initFBO();

  textTexture = createTextTexture();
  checkerboardTexture = createCheckerboardTexture();
  imageTexture = loadImageTexture('simba.jpeg');
  whiteTexture = createSolidColorTexture([255, 255, 255, 255]);
  
  // Set default texture state
  document.getElementById('texture-select').value = 'white';
  currentTexture = whiteTexture;

  buildWhiteboard(); // Builds the board and stand
  createMainBuffers(); // Buffers for board and stand

  buildAnimatedObjects(); // Builds marker, eraser, and wheels
  buildPlatform(); // Membuat alas statis

  setupEventListeners();
  clearDrawing();
  render();
};

function getShaderLocations() {
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

  fboLocations = {
    position: gl.getAttribLocation(fboProgram, 'a_position'),
    pointSize: gl.getUniformLocation(fboProgram, 'u_pointSize'),
    color: gl.getUniformLocation(fboProgram, 'u_color'),
  };

  fboPointBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fboPointBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0]), gl.DYNAMIC_DRAW);

  fboSquareBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fboSquareBuffer);
  const eraserSize = 0.15;
  const square = [-eraserSize, -eraserSize, eraserSize, -eraserSize, -eraserSize, eraserSize, eraserSize, eraserSize];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(square), gl.DYNAMIC_DRAW);
}

function createSolidColorTexture(color) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(color));
    return texture;
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
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));
    const image = new Image();
    image.src = url;
    image.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    return texture;
}

function initFBO() {
    drawingFBO = gl.createFramebuffer();
    drawingTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, drawingTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FBO_WIDTH, FBO_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, drawingFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, drawingTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('FBO tidak lengkap: ' + status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function buildWhiteboard() {
  const materials = {
    boardFront: vec4(1.0, 1.0, 1.0, 1.0),
    boardBack: vec4(0.2, 0.2, 0.2, 1.0),
    frame: vec4(0.82, 0.82, 0.82, 1.0),
    stand: vec4(0.15, 0.15, 0.15, 1.0),
  };

  const boardW = 1.5, boardH = 1.0, boardD = 0.01;
  const t = 0.03, fDepth = 0.03;

  const boardFrontTexCoords = [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1), vec2(0, 0), vec2(0, 0), vec2(0, 0), vec2(0, 0), vec2(0, 0), vec2(0, 0), vec2(0, 0), vec2(0, 0)];
  createPrism(boardW, boardH, boardD, materials.boardFront, mat4(), boardFrontTexCoords);
  createPrism(boardW, boardH, boardD, materials.boardBack, translate(0, 0, -0.02));

  frameVertexStartIndex = allVertices.length;
  createPrism(boardW + 2 * t, t, fDepth, materials.frame, translate(0, boardH / 2 + t / 2, 0));
  createPrism(boardW + 2 * t, t, fDepth, materials.frame, translate(0, -boardH / 2 - t / 2, 0));
  createPrism(t, boardH + 2 * t, fDepth, materials.frame, translate(-boardW / 2 - t / 2, 0, 0));
  createPrism(t, boardH + 2 * t, fDepth, materials.frame, translate(boardW / 2 + t / 2, 0, 0));
  frameVertexCount = allVertices.length - frameVertexStartIndex;

  boardIndicesCount = allIndices.length;

  const standHeight = 1.2, standOffset = boardW / 2;
  createPrism(0.05, standHeight, 0.05, materials.stand, translate(-standOffset, -standHeight / 2, 0));
  createPrism(0.05, standHeight, 0.05, materials.stand, translate(standOffset, -standHeight / 2, 0));

  const braceY = -0.55, braceW = 1.55;
  createPrism(braceW, 0.05, 0.05, materials.stand, translate(0, braceY, 0));

  const feetDepth = 0.6, feetThicknessX = 0.05, feetHeight = 0.05;
  const feetYPos = -standHeight + 0.05;
  createPrism(feetThicknessX, feetHeight, feetDepth, materials.stand, translate(-standOffset, feetYPos, 0));
  createPrism(feetThicknessX, feetHeight, feetDepth, materials.stand, translate(standOffset, feetYPos, 0));
}

function buildAnimatedObjects() {
  // --- Spidol (Marker) ---
  const markerBodyColor = vec4(0.8, 0.1, 0.1, 1.0); // Merah untuk badan
  const markerCapColor = vec4(0.2, 0.2, 0.2, 1.0); // Abu-abu gelap untuk tutup
  const markerTipColor = vec4(0.0, 0.0, 0.0, 1.0); // Hitam untuk ujung
  const markerRingColor = vec4(0.9, 0.9, 0.9, 1.0); // Cincin perak

  markerVertices = []; markerNormals = []; markerColors = []; markerIndices = [];

  // Badan spidol utama
  _createCylinderPart(0.02, 0.2, markerBodyColor, translate(0, 0.025, 0), markerVertices, markerNormals, markerColors, markerIndices);
  // Tutup spidol (sedikit lebih lebar dan pendek)
  _createCylinderPart(0.025, 0.05, markerCapColor, translate(0, 0.125, 0), markerVertices, markerNormals, markerColors, markerIndices);
  // Cincin antara badan dan tutup
  _createCylinderPart(0.022, 0.01, markerRingColor, translate(0, 0.09, 0), markerVertices, markerNormals, markerColors, markerIndices);
  // Ujung spidol (kerucut/silinder kecil)
  _createCylinderPart(0.01, 0.02, markerTipColor, translate(0, -0.085, 0), markerVertices, markerNormals, markerColors, markerIndices);

  markerBuffers = setupObjectBuffers(markerVertices, markerNormals, markerColors, markerIndices);

  // --- Penghapus (Eraser) ---
  const eraserBodyColor = vec4(0.2, 0.2, 0.5, 1.0); // Biru untuk badan
  const eraserFeltColor = vec4(0.1, 0.1, 0.1, 1.0); // Abu-abu gelap untuk alas felt
  const eraserHandleColor = vec4(0.7, 0.7, 0.7, 1.0); // Abu-abu terang untuk pegangan

  eraserVertices = []; eraserNormals = []; eraserColors = []; eraserIndices = [];

  // Badan penghapus utama
  _createPrismPart(0.2, 0.06, 0.08, eraserBodyColor, translate(0, 0.02, 0), eraserVertices, eraserNormals, eraserColors, eraserIndices);
  // Pegangan penghapus (prism lebih kecil di atas)
  _createPrismPart(0.15, 0.02, 0.06, eraserHandleColor, translate(0, 0.05, 0), eraserVertices, eraserNormals, eraserColors, eraserIndices);
  // Alas felt (prism tipis di bawah)
  _createPrismPart(0.18, 0.02, 0.07, eraserFeltColor, translate(0, -0.03, 0), eraserVertices, eraserNormals, eraserColors, eraserIndices);

  eraserBuffers = setupObjectBuffers(eraserVertices, eraserNormals, eraserColors, eraserIndices);

  // --- Roda (Wheels) ---
  const wheelColor = vec4(0.3, 0.3, 0.3, 1.0);
  wheelVertices = []; wheelNormals = []; wheelColors = []; wheelIndices = [];
  _createCylinderPart(0.05, 0.03, wheelColor, mat4(), wheelVertices, wheelNormals, wheelColors, wheelIndices);
  wheelBuffers = setupObjectBuffers(wheelVertices, wheelNormals, wheelColors, wheelIndices);
}

// Fungsi untuk membuat alas statis
function buildPlatform() {
  const platformColor = vec4(0.35, 0.35, 0.4, 1.0); // Warna abu-abu gelap
  const platformW = 3.0;
  const platformH = 0.05;
  const platformD = 2.0;
  const platformY = -1.275; // Posisi Y agar tepat di bawah roda

  platformVertices = []; platformNormals = []; platformColors = []; platformIndices = [];
  _createPrismPart(platformW, platformH, platformD, platformColor, translate(0, platformY, 0), platformVertices, platformNormals, platformColors, platformIndices);
  platformBuffers = setupObjectBuffers(platformVertices, platformNormals, platformColors, platformIndices);
}

// Helper function untuk membuat bagian silinder dan menambahkannya ke array spesifik
function _createCylinderPart(radius, height, color, transformMatrix, outVertices, outNormals, outColors, outIndices) {
  const tempAllVertices = allVertices, tempAllNormals = allNormals, tempAllColors = allColors, tempAllIndices = allIndices, tempAllTexCoords = allTexCoords;
  allVertices = outVertices; allNormals = outNormals; allColors = outColors; allIndices = outIndices; allTexCoords = [];
  createCylinder(radius, height, color, transformMatrix); // Meneruskan matriks transformasi
  allVertices = tempAllVertices; allNormals = tempAllNormals; allColors = tempAllColors; allIndices = tempAllIndices; allTexCoords = tempAllTexCoords;
}

// Helper function untuk membuat bagian prisma dan menambahkannya ke array spesifik
function _createPrismPart(width, height, depth, color, transformMatrix, outVertices, outNormals, outColors, outIndices) {
  const tempAllVertices = allVertices, tempAllNormals = allNormals, tempAllColors = allColors, tempAllIndices = allIndices, tempAllTexCoords = allTexCoords;
  allVertices = outVertices; allNormals = outNormals; allColors = outColors; allIndices = outIndices; allTexCoords = [];
  createPrism(width, height, depth, color, transformMatrix); // Meneruskan matriks transformasi
  allVertices = tempAllVertices; allNormals = tempAllNormals; allColors = tempAllColors; allIndices = tempAllIndices; allTexCoords = tempAllTexCoords;
}

function createPrism(width, height, depth, color, transformMatrix = mat4(), texCoords = null) {
  const indexOffset = allVertices.length;
  const vertices = [vec4(-0.5,-0.5,0.5,1),vec4(0.5,-0.5,0.5,1),vec4(0.5,0.5,0.5,1),vec4(-0.5,0.5,0.5,1),vec4(-0.5,-0.5,-0.5,1),vec4(-0.5,0.5,-0.5,1),vec4(0.5,0.5,-0.5,1),vec4(0.5,-0.5,-0.5,1),vec4(-0.5,0.5,0.5,1),vec4(0.5,0.5,0.5,1),vec4(0.5,0.5,-0.5,1),vec4(-0.5,0.5,-0.5,1),vec4(-0.5,-0.5,-0.5,1),vec4(0.5,-0.5,-0.5,1),vec4(0.5,-0.5,0.5,1),vec4(-0.5,-0.5,0.5,1),vec4(0.5,-0.5,0.5,1),vec4(0.5,-0.5,-0.5,1),vec4(0.5,0.5,-0.5,1),vec4(0.5,0.5,0.5,1),vec4(-0.5,-0.5,-0.5,1),vec4(-0.5,-0.5,0.5,1),vec4(-0.5,0.5,0.5,1),vec4(-0.5,0.5,-0.5,1)];
  const finalTexCoords = texCoords || Array(24).fill(vec2(0, 0));
  const baseTexCoords = [finalTexCoords[0],finalTexCoords[1],finalTexCoords[2],finalTexCoords[3],...Array(20).fill(vec2(0, 0))];
  const normals = [vec3(0,0,1),vec3(0,0,1),vec3(0,0,1),vec3(0,0,1),vec3(0,0,-1),vec3(0,0,-1),vec3(0,0,-1),vec3(0,0,-1),vec3(0,1,0),vec3(0,1,0),vec3(0,1,0),vec3(0,1,0),vec3(0,-1,0),vec3(0,-1,0),vec3(0,-1,0),vec3(0,-1,0),vec3(1,0,0),vec3(1,0,0),vec3(1,0,0),vec3(1,0,0),vec3(-1,0,0),vec3(-1,0,0),vec3(-1,0,0),vec3(-1,0,0)];
  const indices = [0,1,2,0,2,3,4,5,6,4,6,7,8,9,10,8,10,11,12,13,14,12,14,15,16,17,18,16,18,19,20,21,22,20,22,23];
  const finalMatrix = mult(transformMatrix, scale(width, height, depth));
  const nMatrix = normalMatrix(finalMatrix, true);
  for (let i = 0; i < vertices.length; i++) {
    const tv = mult(finalMatrix, vertices[i]);
    const tn = mult(nMatrix, normals[i]);
    allVertices.push(vec3(tv[0], tv[1], tv[2]));
    allNormals.push(normalize(vec3(tn[0], tn[1], tn[2])));
    allTexCoords.push(baseTexCoords[i] || vec2(0, 0));
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
    const i0 = i * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
    baseIndices.push(i0, i1, i2, i1, i3, i2);
  }
  let capVertexOffset = baseVertices.length;
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
    baseIndices.push(capVertexOffset, capVertexOffset + i + 1, capVertexOffset + i + 2);
  }
  capVertexOffset = baseVertices.length;
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
    baseIndices.push(capVertexOffset, capVertexOffset + i + 2, capVertexOffset + i + 1);
  }
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

function createMainBuffers() {
  mainCBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainCBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allColors), gl.DYNAMIC_DRAW);
  mainTBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainTBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allTexCoords), gl.STATIC_DRAW);
  mainNBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainNBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allNormals), gl.STATIC_DRAW);
  mainVBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mainVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flatten(allVertices), gl.STATIC_DRAW);
  mainIBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mainIBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(allIndices), gl.STATIC_DRAW);
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
    return { cBuffer, nBuffer, vBuffer, iBuffer, numIndices: indices.length, attribs: { aColor, aNormal, aPosition } };
}

function bindMainBuffersAndEnableAttributes() {
  const aColor = gl.getAttribLocation(program, 'aColor');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainCBuffer);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);
  const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainTBuffer);
  gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aTexCoord);
  const aNormal = gl.getAttribLocation(program, 'aNormal');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainNBuffer);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aNormal);
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, mainVBuffer);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mainIBuffer);
}

function hexToVec4(hex) {
  let r = 0, g = 0, b = 0;
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
  gl.bindBuffer(gl.ARRAY_BUFFER, mainCBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, frameVertexStartIndex * 16, flatten(allColors.slice(frameVertexStartIndex, frameVertexStartIndex + frameVertexCount)));
}

function disableAutoLight() {
  if (isLightAutoMoving) {
    isLightAutoMoving = false;
    document.getElementById('auto-light-toggle').innerText = '▶️ Mulai Gerak Cahaya Otomatis';
  }
}

function setupEventListeners() {
  document.getElementById('light-x').oninput = (e) => { lightPosition[0] = parseFloat(e.target.value); disableAutoLight(); };
  document.getElementById('light-y').oninput = (e) => { lightPosition[1] = parseFloat(e.target.value); disableAutoLight(); };
  document.getElementById('light-z').oninput = (e) => { lightPosition[2] = parseFloat(e.target.value); disableAutoLight(); };
  document.getElementById('light-ambient').oninput = (e) => (lightAmbient = hexToVec4(e.target.value));
  document.getElementById('light-diffuse').oninput = (e) => (lightDiffuse = hexToVec4(e.target.value));
  document.getElementById('light-specular').oninput = (e) => (lightSpecular = hexToVec4(e.target.value));
  document.getElementById('shininess').oninput = (e) => (materialShininess = parseFloat(e.target.value));

  document.getElementById('frame-color').oninput = (e) => {
    isFrameRgbCycling = false;
    document.getElementById('frame-rgb-toggle').innerText = '🌈 Mode: Warna Statis';
    frameColor = hexToVec4(e.target.value);
    updateFrameColor(frameColor);
  };
  document.getElementById('frame-rgb-toggle').onclick = () => {
    isFrameRgbCycling = !isFrameRgbCycling;
    document.getElementById('frame-rgb-toggle').innerText = isFrameRgbCycling ? '🌈 Mode: Warna RGB' : '🌈 Mode: Warna Statis';
  };

  document.getElementById('texture-select').onchange = (e) => {
    switch (e.target.value) {
      case 'white': currentTexture = whiteTexture; clearDrawing(); break;
      case 'text': currentTexture = textTexture; break;
      case 'checkerboard': currentTexture = checkerboardTexture; break;
      case 'image': currentTexture = imageTexture; break;
    }
  };
  document.getElementById('texture-mode').onchange = (e) => { textureMode = parseInt(e.target.value); };

  document.getElementById('draw-animation-toggle').onclick = () => {
      isShowcaseAnimating = false;
      isDrawingAnimation = !isDrawingAnimation;
      isErasingAnimation = false;
      animationTime = 0;
      document.getElementById('draw-animation-toggle').innerText = isDrawingAnimation ? '✏️ Hentikan Animasi' : '✏️ Mulai Animasi Menggambar';
      document.getElementById('erase-animation-toggle').innerText = '🧽 Mulai Animasi Menghapus';
  };

  document.getElementById('erase-animation-toggle').onclick = () => {
      isShowcaseAnimating = false;
      isErasingAnimation = !isErasingAnimation;
      isDrawingAnimation = false;
      animationTime = 0;
      document.getElementById('erase-animation-toggle').innerText = isErasingAnimation ? '🧽 Hentikan Animasi' : '🧽 Mulai Animasi Menghapus';
      document.getElementById('draw-animation-toggle').innerText = '✏️ Mulai Animasi Menggambar';
  };

  document.getElementById('toggle-platform-button').onclick = () => {
    isPlatformVisible = !isPlatformVisible;
    document.getElementById('toggle-platform-button').innerText = isPlatformVisible ? '🔲 Sembunyikan Alas' : '🔳 Tampilkan Alas';
  };

  document.getElementById('clear-board-button').onclick = clearDrawing;

  const stopAnimations = () => {
      isDrawingAnimation = false;
      isErasingAnimation = false;
      isShowcaseAnimating = false;
      document.getElementById('draw-animation-toggle').innerText = '✏️ Mulai Animasi Menggambar';
      document.getElementById('erase-animation-toggle').innerText = '🧽 Mulai Animasi Menghapus';
      document.getElementById('showcase-animation-toggle').innerText = '▶️ Mulai Animasi Showcase';
  }

  canvas.onmousedown = (e) => {
    if (isAutoRotating) {
      isAutoRotating = false;
      document.getElementById('auto-rotate-toggle').innerText = '▶️ Mulai Rotasi Otomatis';
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

  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const dir = e.deltaY < 0 ? 1 : -1; zoomFactor *= 1 + dir * ZOOM_STEP; zoomFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomFactor)); }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (isAutoRotating) {
      isAutoRotating = false;
      document.getElementById('auto-rotate-toggle').innerText = '▶️ Mulai Rotasi Otomatis';
    }
    stopAnimations();
    const k = e.key.toLowerCase();
    const key = e.key;
    if (key === '+' || key === '=') zoomFactor = Math.min(zoomFactor * (1 + ZOOM_STEP), ZOOM_MAX);
    else if (key === '-' || key === '_') zoomFactor = Math.max(zoomFactor * (1 - ZOOM_STEP), ZOOM_MIN);

    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) e.preventDefault();

    if (isBoardOnlyRotation) {
      if (k === 'w') boardOnlyRotationAngle -= ROT_SPEED;
      if (k === 's') boardOnlyRotationAngle += ROT_SPEED;
      return;
    }

    switch (k) {
      case 'w': rotationAngles.x -= ROT_SPEED; break;
      case 's': rotationAngles.x += ROT_SPEED; break;
      case 'a': rotationAngles.y -= ROT_SPEED; break;
      case 'd': rotationAngles.y += ROT_SPEED; break;
    }
    switch (key) {
      case 'ArrowUp': translationOffsets.z -= TRANSLATION_SPEED; break; // Mundur (menjauhi kamera)
      case 'ArrowDown': translationOffsets.z += TRANSLATION_SPEED; break; // Maju (mendekati kamera)
      case 'ArrowLeft': translationOffsets.x -= TRANSLATION_SPEED; break;
      case 'ArrowRight': translationOffsets.x += TRANSLATION_SPEED; break;
    }
  });

  document.getElementById('reset-button').onclick = () => {
    rotationAngles = { x: -20, y: 30 };
    boardOnlyRotationAngle = 0;
    wheelRotationAngle = 0;
    scaleFactors = { x: 1.0, y: 1.0, z: 1.0 };
    translationOffsets = { x: 0.0, y: 0.0, z: 0.0 };
    zoomFactor = 1.0;
    isPerspective = true;
    isAutoRotating = false;
    document.getElementById('auto-rotate-toggle').innerText = '▶️ Mulai Rotasi Otomatis';
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
    document.getElementById('auto-light-toggle').innerText = '▶️ Mulai Gerak Cahaya Otomatis';
    lightAnimationTime = 0;

    isFrameRgbCycling = false;
    document.getElementById('frame-rgb-toggle').innerText = '🌈 Mode: Warna Statis';
    document.getElementById('frame-color').value = '#c2c2c2';
    frameColor = hexToVec4('#c2c2c2');
    updateFrameColor(frameColor);

    document.getElementById('texture-select').value = 'white';
    document.getElementById('texture-mode').value = '0';
    currentTexture = whiteTexture;
    isPlatformVisible = true;
    document.getElementById('toggle-platform-button').innerText = '🔲 Sembunyikan Alas';
    textureMode = 0;

    stopAnimations();
    clearDrawing();
  };

  document.getElementById('board-rotation-toggle').onclick = () => {
    isBoardOnlyRotation = !isBoardOnlyRotation;
    document.getElementById('board-rotation-toggle').innerText = isBoardOnlyRotation ? '↕️ Mode: Putar Papan Saja' : '↔️ Mode: Putar Semua Objek';
  };

  document.getElementById('projection-toggle').onclick = () => {
    isPerspective = !isPerspective;
    document.getElementById('projection-toggle').innerHTML = isPerspective ? '🔭 Mode: Proyeksi Perspektif' : '📐 Mode: Proyeksi Ortografik';
  };

  document.getElementById('auto-rotate-toggle').onclick = () => {
    isAutoRotating = !isAutoRotating;
    document.getElementById('auto-rotate-toggle').innerText = isAutoRotating ? '⏸️ Hentikan Rotasi' : '▶️ Mulai Rotasi Otomatis';
  };

  document.getElementById('auto-light-toggle').onclick = () => {
    isLightAutoMoving = !isLightAutoMoving;
    document.getElementById('auto-light-toggle').innerText = isLightAutoMoving ? '⏸️ Hentikan Gerak Cahaya' : '▶️ Mulai Gerak Cahaya Otomatis';
  };

  document.getElementById('showcase-animation-toggle').onclick = () => {
    isShowcaseAnimating = !isShowcaseAnimating;
    if (isShowcaseAnimating) {
      isAutoRotating = false;
      isDrawingAnimation = false;
      isErasingAnimation = false;
      isLightAutoMoving = false;
      document.getElementById('auto-rotate-toggle').innerText = '▶️ Mulai Rotasi Otomatis';
      document.getElementById('draw-animation-toggle').innerText = '✏️ Mulai Animasi Menggambar';
      document.getElementById('erase-animation-toggle').innerText = '🧽 Mulai Animasi Menghapus';
      document.getElementById('auto-light-toggle').innerText = '▶️ Mulai Gerak Cahaya Otomatis';

      // Soft reset
      rotationAngles = { x: -20, y: 30 };
      boardOnlyRotationAngle = 0;
      wheelRotationAngle = 0;
      translationOffsets = { x: 0.0, y: 0.0, z: 0.0 };
      zoomFactor = 1.0;
      clearDrawing();

      showcaseStage = 0;
      showcaseTime = 0;
      document.getElementById('showcase-animation-toggle').innerText = '⏹️ Hentikan Showcase';
    } else {
      document.getElementById('showcase-animation-toggle').innerText = '▶️ Mulai Animasi Showcase';
      document.getElementById('reset-button').click();
    }
  };

  document.getElementById('scale-x').oninput = (e) => (scaleFactors.x = parseFloat(e.target.value));
  document.getElementById('scale-y').oninput = (e) => (scaleFactors.y = parseFloat(e.target.value));
}

function drawObject(buffers, modelMatrix) {
    const { cBuffer, nBuffer, vBuffer, iBuffer, numIndices, attribs } = buffers;
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.vertexAttribPointer(attribs.aColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.aColor);

    const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
    gl.disableVertexAttribArray(aTexCoord);

    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.aNormal);
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribs.aPosition);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelMatrix));
    gl.drawElements(gl.TRIANGLES, numIndices, gl.UNSIGNED_SHORT, 0);

    gl.enableVertexAttribArray(aTexCoord);
}

function drawOnBoard(x, y, isErasing) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawingFBO);
  gl.viewport(0, 0, FBO_WIDTH, FBO_HEIGHT);
  gl.useProgram(fboProgram);
  gl.enableVertexAttribArray(fboLocations.position);
  if (isErasing) {
    gl.bindBuffer(gl.ARRAY_BUFFER, fboSquareBuffer);
    gl.vertexAttribPointer(fboLocations.position, 2, gl.FLOAT, false, 0, 0);
    const translatedSquare = new Float32Array([-0.15+x,-0.15+y,0.15+x,-0.15+y,-0.15+x,0.15+y,0.15+x,0.15+y]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, translatedSquare);
    gl.uniform4fv(fboLocations.color, flatten(vec4(1, 1, 1, 1)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, fboPointBuffer);
    gl.vertexAttribPointer(fboLocations.position, 2, gl.FLOAT, false, 0, 0);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([x, y]));
    gl.uniform1f(fboLocations.pointSize, 10.0);
    gl.uniform4fv(fboLocations.color, flatten(vec4(0, 0, 0, 1)));
    gl.drawArrays(gl.POINTS, 0, 1);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(program);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function clearDrawing() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawingFBO);
  gl.clearColor(1.0, 1.0, 1.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(0.4, 0.4, 0.4, 1.0);
}

function render() {
  requestAnimationFrame(render);

  const now = Date.now();
  const delta = now - (lastTime || now);
  lastTime = now;
  const deltaTime = delta / 1000.0;

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  if (isShowcaseAnimating) {
    showcaseTime += deltaTime;

    const stageDuration = 4;
    const t = showcaseTime / stageDuration;

    if (showcaseTime > stageDuration) {
        showcaseTime = 0;
        showcaseStage++;

        // Explicitly reset state from previous stage
        rotationAngles = { x: -20, y: 30 };
        boardOnlyRotationAngle = 0;
        wheelRotationAngle = 0;
        translationOffsets = { x: 0.0, y: 0.0, z: 0.0 };
        isDrawingAnimation = false;
        isErasingAnimation = false;
        animationTime = 0;
        clearDrawing();

        if (showcaseStage > 5) {
            isShowcaseAnimating = false;
            showcaseStage = 0;
            document.getElementById('showcase-animation-toggle').innerText = '▶️ Mulai Animasi Showcase';
            document.getElementById('reset-button').click();
            return;
        }
    }

    switch (showcaseStage) {
        case 0: // Wheels Only
            wheelRotationAngle = 720 * t;
            break;
        case 1: // Board Only
            boardOnlyRotationAngle = 180 * Math.sin(t * Math.PI);
            break;
        case 2: // Stand + Wheels
            translationOffsets.z = 1.5 * Math.sin(t * Math.PI);
            wheelRotationAngle = -translationOffsets.z * 200;
            break;
        case 3: // Stand + Board
            rotationAngles.y = 30 + 180 * t;
            boardOnlyRotationAngle = 90 * Math.sin(t * Math.PI * 2);
            break;
        case 4: // Root move
            rotationAngles.y = 30 + 360 * t;
            rotationAngles.x = -20 + 45 * Math.sin(t * Math.PI);
            break;
        case 5: // Drawing on moving board
            rotationAngles.y = 30 + 120 * t;
            isDrawingAnimation = true;
            break;
    }
  }

  if (isDrawingAnimation || isErasingAnimation) {
    animationTime += deltaTime * 1.5;
    if (isDrawingAnimation && animationTime > 3) { animationTime = 0; if(!isShowcaseAnimating) isDrawingAnimation=false; }
    if (isErasingAnimation && animationTime > 2) { animationTime = 0; if(!isShowcaseAnimating) isErasingAnimation=false; }

    let animX3D, animY3D;
    if (isDrawingAnimation) {
      const p1=vec2(-.4,-.3), p2=vec2(.4,-.3), p3=vec2(0,.4);
      const animT = animationTime / 3.0 * 3;
      if (animT < 1) { const pos=mix(p1,p2,animT); animX3D=pos[0]; animY3D=pos[1]; }
      else if (animT < 2) { const pos=mix(p2,p3,animT-1); animX3D=pos[0]; animY3D=pos[1]; }
      else { const pos=mix(p3,p1,animT-2); animX3D=pos[0]; animY3D=pos[1]; }
    } else { 
      animX3D = -0.6 + 1.2 * (animationTime / 2);
      animY3D = 0.2 * Math.sin(animationTime * Math.PI * 4);
    }
    const texX = (animX3D + 0.75) / 1.5;
    const texY = (animY3D + 0.5) / 1.0;
    drawOnBoard(texX * 2 - 1, texY * 2 - 1, isErasingAnimation);
  }

  if (isAutoRotating) {
    rotationAngles.y = (rotationAngles.y + AUTO_ROT_SPEED_Y) % 360;
    boardOnlyRotationAngle = (boardOnlyRotationAngle + AUTO_ROT_SPEED_BOARD) % 360;
  }

  if (isLightAutoMoving) {
    lightAnimationTime += 0.008;
    const radius = 6.0, yAmplitude = 3.0, yOffset = 2.5;
    lightPosition[0] = Math.cos(lightAnimationTime) * radius;
    lightPosition[1] = Math.sin(lightAnimationTime) * yAmplitude + yOffset;
    lightPosition[2] = Math.sin(lightAnimationTime) * radius;
    document.getElementById('light-x').value = lightPosition[0];
    document.getElementById('light-y').value = lightPosition[1];
    document.getElementById('light-z').value = lightPosition[2];
  }

  if (isFrameRgbCycling) {
    frameRgbTime += 0.02;
    const r = Math.sin(frameRgbTime*1) * 0.5 + 0.5;
    const g = Math.sin(frameRgbTime*1 + 2) * 0.5 + 0.5;
    const b = Math.sin(frameRgbTime*1 + 4) * 0.5 + 0.5;
    frameColor = vec4(r, g, b, 1.0);
    updateFrameColor(frameColor);
    const hexColor = '#' + [r,g,b].map(c => Math.round(c*255).toString(16).padStart(2,'0')).join('');
    document.getElementById('frame-color').value = hexColor;
  }

  const aspect = canvas.width / canvas.height;
  if (isPerspective) {
    projectionMatrix = perspective(45, aspect, 0.1, 100);
  } else {
    const zoom = 3.0;
    projectionMatrix = ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -10, 10);
  }
  gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

  let baseMatrix = mult(rotateX(rotationAngles.x), rotateY(rotationAngles.y));
  baseMatrix = mult(scale(scaleFactors.x * zoomFactor, scaleFactors.y * zoomFactor, scaleFactors.z * zoomFactor), baseMatrix);

  // Pisahkan matriks view (kamera) dari matriks translasi objek
  const cameraViewMatrix = translate(0.0, 0.0, -5); // Kamera mundur
  const objectTranslationMatrix = translate(translationOffsets.x, translationOffsets.y, translationOffsets.z); // Pergeseran dari panah

  baseMatrix = mult(cameraViewMatrix, mult(objectTranslationMatrix, baseMatrix));

  gl.uniform4fv(uLightPositionLoc, flatten(lightPosition));
  gl.uniform4fv(uLightAmbientLoc, flatten(lightAmbient));
  gl.uniform4fv(uLightDiffuseLoc, flatten(lightDiffuse));
  gl.uniform4fv(uLightSpecularLoc, flatten(lightSpecular));
  gl.uniform1f(uShininessLoc, materialShininess);

  bindMainBuffersAndEnableAttributes();

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, currentTexture);
  gl.uniform1i(uSamplerLoc, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, drawingTexture);
  gl.uniform1i(uDrawingSamplerLoc, 1);

  gl.uniform1i(uTextureModeLoc, textureMode);

  const boardRotationMatrix = rotateX(boardOnlyRotationAngle);
  modelViewMatrix = mult(baseMatrix, boardRotationMatrix);
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
  let nMatrix = normalMatrix(modelViewMatrix, true);
  gl.uniformMatrix3fv(nMatrixLoc, false, flatten(nMatrix));
  gl.drawElements(gl.TRIANGLES, boardIndicesCount, gl.UNSIGNED_SHORT, 0);

  modelViewMatrix = baseMatrix;
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
  nMatrix = normalMatrix(modelViewMatrix, true);
  gl.uniformMatrix3fv(nMatrixLoc, false, flatten(nMatrix));
  gl.drawElements(gl.TRIANGLES, allIndices.length - boardIndicesCount, gl.UNSIGNED_SHORT, boardIndicesCount * 2);

  const boardObjectBaseMatrix = mult(baseMatrix, boardRotationMatrix);

  const trayY = -0.55, trayZ = 0.05;

  let markerMatrix;
  if (isDrawingAnimation) {
      let animX, animY;
      const p1=vec2(-.4,-.3), p2=vec2(.4,-.3), p3=vec2(0,.4);
      const animT = animationTime / 3.0 * 3;
      if (animT < 1) { const pos=mix(p1,p2,animT); animX=pos[0]; animY=pos[1]; }
      else if (animT < 2) { const pos=mix(p2,p3,animT-1); animX=pos[0]; animY=pos[1]; }
      else { const pos=mix(p3,p1,animT-2); animX=pos[0]; animY=pos[1]; }
      const animZ = 0.02;
      // Pindahkan spidol ke posisi di papan
      markerMatrix = mult(boardObjectBaseMatrix, translate(animX, animY, animZ));
      // Putar spidol 90 derajat pada sumbu X agar ujungnya menunjuk ke papan
      markerMatrix = mult(markerMatrix, rotateX(90));
  } else {
      markerMatrix = mult(boardObjectBaseMatrix, translate(-0.3, trayY + 0.02, trayZ));
  }
  drawObject(markerBuffers, markerMatrix);

  let eraserMatrix;
  if (isErasingAnimation) {
      const animX = -0.6 + 1.2 * (animationTime / 2);
      const animY = 0.2 * Math.sin(animationTime * Math.PI * 4);
      const animZ = 0.02;
      eraserMatrix = mult(boardObjectBaseMatrix, translate(animX, animY, animZ));
  } else {
      eraserMatrix = mult(boardObjectBaseMatrix, translate(0.3, trayY + 0.05, trayZ));
  }
  drawObject(eraserBuffers, eraserMatrix);

  // Draw Wheels
  const standHeight = 1.2, standOffset = 1.5 / 2;
  const feetDepth = 0.6;
  const feetYPos = -standHeight + 0.05;
  const wheelYPos = feetYPos - 0.05;
  const wheelOffsetZ = feetDepth / 2 - 0.03;
  const wheelInitialRotation = rotateZ(90);
  const wheelAnimRotation = rotateX(wheelRotationAngle);

  const wheelPositions = [
      translate(-standOffset, wheelYPos, -wheelOffsetZ),
      translate(-standOffset, wheelYPos, wheelOffsetZ),
      translate(standOffset, wheelYPos, -wheelOffsetZ),
      translate(standOffset, wheelYPos, wheelOffsetZ)
  ];

  for(const pos of wheelPositions) {
      let wheelMatrix = mult(baseMatrix, pos);
      wheelMatrix = mult(wheelMatrix, wheelInitialRotation);
      wheelMatrix = mult(wheelMatrix, wheelAnimRotation);
      drawObject(wheelBuffers, wheelMatrix);
  }

  // Gambar alas statis (platform)
  // Matriksnya hanya berisi viewMatrix, tanpa transformasi objek (baseMatrix)
  // Ini membuatnya tetap di tempatnya, tidak terpengaruh oleh translasi papan tulis.
  // Hanya digambar jika isPlatformVisible adalah true.
  if (isPlatformVisible) {
    const platformMatrix = cameraViewMatrix;
    drawObject(platformBuffers, platformMatrix);
  }
}