import { segmentForeground } from '@imgly/background-removal';

const imageInput = document.getElementById('imageInput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const actionControls = document.getElementById('actionControls');
const toolControls = document.getElementById('toolControls');
const eraserOptions = document.getElementById('eraserOptions');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingTitle = document.getElementById('loadingTitle');
const loadingMessage = document.getElementById('loadingMessage');
const progressBar = document.getElementById('progressBar');
const statusMessage = document.getElementById('statusMessage');
const imageMeta = document.getElementById('imageMeta');
const stage = document.querySelector('.stage');
const removeBgBtn = document.getElementById('removeBgBtn');
const resetBtn = document.getElementById('resetBtn');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomFitBtn = document.getElementById('zoomFit');
const zoomLabel = document.getElementById('zoomLabel');
const btnAuto = document.getElementById('btnAuto');
const btnBox = document.getElementById('btnBox');
const btnColor = document.getElementById('btnColor');
const btnErase = document.getElementById('btnErase');
const btnRestore = document.getElementById('btnRestore');
const brushSizeInput = document.getElementById('brushSize');
const colorOptions = document.getElementById('colorOptions');
const colorToleranceInput = document.getElementById('colorTolerance');
const colorToleranceValue = document.getElementById('colorToleranceValue');
const modelQualityInput = document.getElementById('modelQuality');
const maskOptions = document.getElementById('maskOptions');
const maskStrengthInput = document.getElementById('maskStrength');
const maskStrengthValue = document.getElementById('maskStrengthValue');

let originalImage = null;
let restoreSource = null;
let originalName = 'imagen_editada';
let mode = 'auto';
let drawing = false;
let modelReady = false;
let modelLoading = false;
let isSelecting = false;
let selectionStart = null;
let selectionRect = null;
let canvasSnapshot = null;
let isProcessing = false;
let pointerId = null;
let processedMask = null;
let processedAlpha = null;
let outputOffsetX = 0;
let outputOffsetY = 0;
let previousRestorePoint = null;
let previousColorPoint = null;
let colorStrokeStartPoint = null;
let colorStrokeImage = null;
let colorStrokeUndoState = null;
let colorStrokeChanged = false;
let colorStrokeDragged = false;
let undoState = null;
let canvasZoom = 1;

function captureUndoState() {
  return {
    image: ctx.getImageData(0, 0, canvas.width, canvas.height),
    restoreSource,
    outputOffsetX,
    outputOffsetY,
  };
}

function setUndoState(state) {
  undoState = state;
  undoBtn.disabled = !state;
}

function undoLastAction() {
  if (!undoState) return;
  const state = undoState;
  setUndoState(null);
  canvas.width = state.image.width;
  canvas.height = state.image.height;
  setCanvasZoom(canvasZoom);
  ctx.putImageData(state.image, 0, 0);
  restoreSource = state.restoreSource;
  outputOffsetX = state.outputOffsetX;
  outputOffsetY = state.outputOffsetY;
  processedMask = null;
  processedAlpha = null;
  maskOptions.classList.add('hidden');
  setStatus('Último cambio deshecho.');
}

function setCanvasZoom(value) {
  canvasZoom = Math.min(4, Math.max(0.25, value));
  const styles = getComputedStyle(stage);
  const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const availableWidth = Math.max(1, stage.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, stage.clientHeight - verticalPadding);
  const fitScale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
  const scale = fitScale * canvasZoom;
  canvas.style.width = `${Math.max(1, Math.round(canvas.width * scale))}px`;
  canvas.style.height = `${Math.max(1, Math.round(canvas.height * scale))}px`;
  zoomLabel.textContent = `${Math.round(canvasZoom * 100)}%`;
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  let clientX = event.clientX;
  let clientY = event.clientY;

  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  }

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function setMode(newMode) {
  mode = newMode;

  btnAuto.classList.remove('tool-active');
  btnBox.classList.remove('tool-active');
  btnColor.classList.remove('tool-active');
  btnErase.classList.remove('tool-active');
  btnRestore.classList.remove('tool-active');
  eraserOptions.classList.add('hidden');
  eraserOptions.classList.remove('flex');
  colorOptions.classList.add('hidden');
  colorOptions.classList.remove('flex');

  if (mode === 'auto') {
    btnAuto.classList.add('tool-active');
  } else if (mode === 'box') {
    btnBox.classList.add('tool-active');
  } else if (mode === 'color') {
    btnColor.classList.add('tool-active');
    eraserOptions.classList.remove('hidden');
    eraserOptions.classList.add('flex');
    colorOptions.classList.remove('hidden');
    colorOptions.classList.add('flex');
  } else if (mode === 'erase') {
    btnErase.classList.add('tool-active');
    eraserOptions.classList.remove('hidden');
    eraserOptions.classList.add('flex');
  } else if (mode === 'restore') {
    btnRestore.classList.add('tool-active');
    eraserOptions.classList.remove('hidden');
    eraserOptions.classList.add('flex');
  }

  selectionRect = null;
  canvasSnapshot = null;
  isSelecting = false;
  if (mode !== 'auto') {
    processedMask = null;
    processedAlpha = null;
    maskOptions.classList.add('hidden');
  }
  if (mode === 'box') setStatus('Encierra al sujeto completo y deja un poco de fondo alrededor; el PNG final tendrá el tamaño del cuadro.');
  if (mode === 'color') setStatus('Haz clic en un resto para limpiar su zona conectada, o mantén y arrastra para borrarlo con el pincel.');
  if (mode === 'erase') setStatus('Pinta sobre la imagen para borrar.');
  if (mode === 'restore') setStatus('Pinta para recuperar píxeles de la imagen original.');
}

function eraseColorBrushAt(position) {
  if (!colorStrokeImage) return false;
  const centerX = Math.floor(position.x);
  const centerY = Math.floor(position.y);
  if (centerX < 0 || centerY < 0 || centerX >= canvas.width || centerY >= canvas.height) return false;
  const seedOffset = (centerY * canvas.width + centerX) * 4;
  if (colorStrokeImage.data[seedOffset + 3] === 0) return false;

  const radius = Number(brushSizeInput.value) / 2;
  const radiusSquared = radius * radius;
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(canvas.width - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(canvas.height - 1, Math.ceil(centerY + radius));
  const tolerance = 16 + Math.pow(Number(colorToleranceInput.value) / 100, 1.5) * 425;
  const toleranceSquared = tolerance * tolerance;
  const innerTolerance = tolerance * 0.65;
  const innerToleranceSquared = innerTolerance * innerTolerance;
  const seedRed = colorStrokeImage.data[seedOffset];
  const seedGreen = colorStrokeImage.data[seedOffset + 1];
  const seedBlue = colorStrokeImage.data[seedOffset + 2];
  let changed = false;

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radiusSquared) continue;

      const offset = (y * canvas.width + x) * 4;
      const alpha = colorStrokeImage.data[offset + 3];
      if (alpha === 0) continue;
      const red = colorStrokeImage.data[offset] - seedRed;
      const green = colorStrokeImage.data[offset + 1] - seedGreen;
      const blue = colorStrokeImage.data[offset + 2] - seedBlue;
      const distanceSquared = red * red + green * green + blue * blue;
      if (distanceSquared > toleranceSquared) continue;

      if (!colorStrokeChanged) {
        setUndoState(colorStrokeUndoState);
        colorStrokeChanged = true;
      }
      if (distanceSquared <= innerToleranceSquared) {
        colorStrokeImage.data[offset + 3] = 0;
      } else {
        const distance = Math.sqrt(distanceSquared);
        const progress = (distance - innerTolerance) / (tolerance - innerTolerance);
        const softened = progress * progress * (3 - 2 * progress);
        colorStrokeImage.data[offset + 3] = Math.round(alpha * softened);
      }
      changed = true;
    }
  }

  return changed;
}

function eraseColorBrush(from, to) {
  if (!colorStrokeImage) return;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(1, Number(brushSizeInput.value) * 0.2);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  let changed = false;

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    changed = eraseColorBrushAt({
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    }) || changed;
  }

  if (changed) ctx.putImageData(colorStrokeImage, 0, 0);
}

function fillConnectedColorAt(position) {
  if (!colorStrokeImage) return;
  const startX = Math.floor(position.x);
  const startY = Math.floor(position.y);
  if (startX < 0 || startY < 0 || startX >= canvas.width || startY >= canvas.height) return;

  const image = colorStrokeImage;
  const startIndex = startY * canvas.width + startX;
  const startOffset = startIndex * 4;
  if (image.data[startOffset + 3] === 0) {
    setStatus('Ese punto ya es transparente. Haz clic sobre un resto visible del fondo.');
    return;
  }

  const tolerance = 16 + Math.pow(Number(colorToleranceInput.value) / 100, 1.5) * 425;
  const toleranceSquared = tolerance * tolerance;
  const innerTolerance = tolerance * 0.65;
  const innerToleranceSquared = innerTolerance * innerTolerance;
  const pixelCount = canvas.width * canvas.height;
  let queue = new Uint32Array(Math.min(pixelCount, 65536));
  const visited = new Uint8Array(Math.ceil(pixelCount / 8));
  const seedRed = image.data[startOffset];
  const seedGreen = image.data[startOffset + 1];
  const seedBlue = image.data[startOffset + 2];
  let head = 0;
  let tail = 0;

  function enqueue(index) {
    const byteIndex = index >> 3;
    const bit = 1 << (index & 7);
    if (visited[byteIndex] & bit) return;
    visited[byteIndex] |= bit;

    const offset = index * 4;
    if (image.data[offset + 3] === 0) return;
    const red = image.data[offset] - seedRed;
    const green = image.data[offset + 1] - seedGreen;
    const blue = image.data[offset + 2] - seedBlue;
    if (red * red + green * green + blue * blue > toleranceSquared) return;

    if (tail === queue.length) {
      const expandedQueue = new Uint32Array(Math.min(pixelCount, queue.length * 2));
      expandedQueue.set(queue);
      queue = expandedQueue;
    }
    queue[tail] = index;
    tail += 1;
  }

  enqueue(startIndex);
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % canvas.width;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < canvas.width) enqueue(index + 1);
    if (index >= canvas.width) enqueue(index - canvas.width);
    if (index + canvas.width < pixelCount) enqueue(index + canvas.width);
  }

  for (let pixel = 0; pixel < tail; pixel += 1) {
    const offset = queue[pixel] * 4;
    const red = image.data[offset] - seedRed;
    const green = image.data[offset + 1] - seedGreen;
    const blue = image.data[offset + 2] - seedBlue;
    const distanceSquared = red * red + green * green + blue * blue;
    if (distanceSquared <= innerToleranceSquared) {
      image.data[offset + 3] = 0;
      continue;
    }

    const distance = Math.sqrt(distanceSquared);
    const progress = (distance - innerTolerance) / (tolerance - innerTolerance);
    const softened = progress * progress * (3 - 2 * progress);
    image.data[offset + 3] = Math.round(image.data[offset + 3] * softened);
  }

  if (tail > 0) {
    setUndoState(colorStrokeUndoState);
    ctx.putImageData(image, 0, 0);
    colorStrokeChanged = true;
    setStatus(`Zona de color limpiada (${tail.toLocaleString()} píxeles). Puedes deshacer si afectó algún detalle.`);
  }
}

function startColorErase(event) {
  drawing = true;
  colorStrokeStartPoint = getPointerPosition(event);
  previousColorPoint = colorStrokeStartPoint;
  colorStrokeImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
  colorStrokeUndoState = captureUndoState();
  colorStrokeChanged = false;
  colorStrokeDragged = false;
}

function moveColorErase(event) {
  if (!drawing || !previousColorPoint) return;
  const position = getPointerPosition(event);
  if (!colorStrokeDragged) {
    const distanceFromStart = Math.hypot(
      position.x - colorStrokeStartPoint.x,
      position.y - colorStrokeStartPoint.y,
    );
    if (distanceFromStart < 3) return;
    colorStrokeDragged = true;
    eraseColorBrush(colorStrokeStartPoint, position);
    previousColorPoint = position;
    return;
  }
  eraseColorBrush(previousColorPoint, position);
  previousColorPoint = position;
}

function stopColorErase(applyClick = true) {
  if (!drawing || !colorStrokeImage) return;
  if (!colorStrokeDragged && applyClick) fillConnectedColorAt(colorStrokeStartPoint);
  if (colorStrokeChanged) {
    if (colorStrokeDragged) setStatus('Pasada de limpieza aplicada. Puedes deshacer si afectó algún detalle.');
  }
  drawing = false;
  previousColorPoint = null;
  colorStrokeStartPoint = null;
  colorStrokeImage = null;
  colorStrokeUndoState = null;
  colorStrokeChanged = false;
  colorStrokeDragged = false;
}

function trimTransparentPixels(img) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = img.naturalWidth || img.width;
  tempCanvas.height = img.naturalHeight || img.height;

  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.drawImage(img, 0, 0);

  const data = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
  let minX = tempCanvas.width;
  let minY = tempCanvas.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < tempCanvas.height; y += 1) {
    for (let x = 0; x < tempCanvas.width; x += 1) {
      const alpha = data[(y * tempCanvas.width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX === tempCanvas.width) {
    return { canvas: tempCanvas, x: 0, y: 0, width: tempCanvas.width, height: tempCanvas.height };
  }

  const padding = 4;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const width = Math.min(tempCanvas.width - x, maxX - x + padding * 2 + 1);
  const height = Math.min(tempCanvas.height - y, maxY - y + padding * 2 + 1);

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = width;
  resultCanvas.height = height;

  const resultCtx = resultCanvas.getContext('2d');
  resultCtx.clearRect(0, 0, width, height);
  resultCtx.drawImage(tempCanvas, x, y, width, height, 0, 0, width, height);

  return { canvas: resultCanvas, x, y, width, height };
}

function drawImageToCanvas(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  setCanvasZoom(canvasZoom);
}

function renderOriginal() {
  if (!originalImage) return;
  setUndoState(null);
  processedMask = null;
  processedAlpha = null;
  outputOffsetX = 0;
  outputOffsetY = 0;
  maskOptions.classList.add('hidden');
  drawImageToCanvas(originalImage);
  setStatus('Imagen original restaurada.');
}

function saveProcessedMask() {
  processedMask = ctx.getImageData(0, 0, canvas.width, canvas.height);
  processedAlpha = new Uint8Array(canvas.width * canvas.height);
  for (let pixel = 0; pixel < processedAlpha.length; pixel += 1) {
    processedAlpha[pixel] = processedMask.data[pixel * 4 + 3];
  }
  maskOptions.classList.remove('hidden');
  maskStrengthInput.value = '0';
  maskStrengthValue.textContent = '0%';
  applyMaskStrength();
}

function applyMaskStrength() {
  if (!processedMask || !processedAlpha) return;

  const strength = Number(maskStrengthInput.value) / 100;
  const cutoff = 150 * strength;

  for (let pixel = 0; pixel < processedAlpha.length; pixel += 1) {
    const alpha = processedAlpha[pixel];
    if (strength === 0 || alpha === 0) {
      processedMask.data[pixel * 4 + 3] = alpha;
      continue;
    }
    const normalized = Math.max(0, Math.min(1, (alpha - cutoff) / (255 - cutoff)));
    const softened = normalized * normalized * (3 - 2 * normalized);
    processedMask.data[pixel * 4 + 3] = Math.round(softened * 255);
  }

  ctx.putImageData(processedMask, 0, 0);
  maskStrengthValue.textContent = `${Math.round(strength * 100)}%`;
}

function setProcessingState(value) {
  isProcessing = value;
  removeBgBtn.disabled = value;
  btnAuto.disabled = value;
  btnBox.disabled = value;
  btnColor.disabled = value;
  btnErase.disabled = value;
  btnRestore.disabled = value;
  modelQualityInput.disabled = value;
  resetBtn.disabled = value;
  undoBtn.disabled = value || !undoState;
  downloadBtn.disabled = value;
}

function showLoading(title, message) {
  loadingTitle.textContent = title;
  loadingMessage.textContent = message;
  progressBar.style.width = '0%';
  loadingOverlay.classList.remove('hidden');
  loadingOverlay.classList.add('flex');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
  loadingOverlay.classList.remove('flex');
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('status-error', isError);
}

function createAspectPreservedInput(source) {
  const width = source.width;
  const height = source.height;
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const size = Math.max(scaledWidth, scaledHeight);
  const x = Math.floor((size - scaledWidth) / 2);
  const y = Math.floor((size - scaledHeight) / 2);
  const padded = document.createElement('canvas');
  padded.width = size;
  padded.height = size;
  const paddedCtx = padded.getContext('2d');

  paddedCtx.drawImage(source, x, y, scaledWidth, scaledHeight);
  if (x > 0) {
    paddedCtx.drawImage(source, 0, 0, 1, height, 0, y, x, scaledHeight);
    paddedCtx.drawImage(source, width - 1, 0, 1, height, x + scaledWidth, y, x, scaledHeight);
  } else if (y > 0) {
    paddedCtx.drawImage(source, 0, 0, width, 1, x, 0, scaledWidth, y);
    paddedCtx.drawImage(source, 0, height - 1, width, 1, x, y + scaledHeight, scaledWidth, y);
  }

  return { canvas: padded, x, y, width: scaledWidth, height: scaledHeight };
}

async function removeBackgroundFrom(source) {
  loadingTitle.textContent = 'Quitando el fondo';
  loadingMessage.textContent = 'La primera ejecución puede tardar mientras se descarga el modelo.';
  const inferenceInput = createAspectPreservedInput(source);
  const maskBlob = await segmentForeground(inferenceInput.canvas.toDataURL('image/png'), {
    model: modelQualityInput.value,
    rescale: true,
    output: { format: 'image/png', quality: 1 },
    progress: (asset, current, total) => {
      if (total > 0) {
        const percent = Math.min(100, Math.round((current / total) * 100));
        loadingMessage.textContent = `Preparando IA: ${percent}%`;
        progressBar.style.width = `${percent}%`;
      } else {
        loadingMessage.textContent = `Preparando IA: ${asset}`;
      }
    },
  });
  progressBar.style.width = '100%';
  loadingMessage.textContent = 'Terminando la imagen...';
  const mask = await imageFromBlob(maskBlob);
  const foreground = document.createElement('canvas');
  foreground.width = source.width;
  foreground.height = source.height;
  const foregroundCtx = foreground.getContext('2d');
  foregroundCtx.drawImage(source, 0, 0);
  foregroundCtx.globalCompositeOperation = 'destination-in';
  foregroundCtx.drawImage(
    mask,
    inferenceInput.x,
    inferenceInput.y,
    inferenceInput.width,
    inferenceInput.height,
    0,
    0,
    source.width,
    source.height,
  );
  foregroundCtx.globalCompositeOperation = 'source-over';
  return foreground;
}

function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo abrir la imagen procesada.'));
    };
    image.src = objectUrl;
  });
}

async function renderProcessedSource() {
  try {
    const previousState = undoState;
    const source = document.createElement('canvas');
    source.width = originalImage.naturalWidth;
    source.height = originalImage.naturalHeight;
    source.getContext('2d').drawImage(originalImage, 0, 0);
    const processed = await removeBackgroundFrom(source);
    const trimmed = trimTransparentPixels(processed);
    canvas.width = trimmed.width;
    canvas.height = trimmed.height;
    setCanvasZoom(canvasZoom);
    outputOffsetX = trimmed.x;
    outputOffsetY = trimmed.y;
    restoreSource = originalImage;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(trimmed.canvas, 0, 0);
    setUndoState(previousState);
    saveProcessedMask();
    setStatus(`Fondo eliminado. PNG de ${canvas.width} x ${canvas.height} px. Usa Limpiar por color para quitar restos.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'No se pudo procesar la imagen. Comprueba tu conexión y vuelve a intentarlo.', true);
  } finally {
    hideLoading();
    setProcessingState(false);
  }
}

async function removeBackgroundWithAI() {
  if (!originalImage || isProcessing) return;

  setUndoState(captureUndoState());
  processedMask = null;
  processedAlpha = null;
  outputOffsetX = 0;
  outputOffsetY = 0;
  maskOptions.classList.add('hidden');
  setProcessingState(true);
  showLoading('Quitando el fondo', 'La primera ejecución puede tardar mientras se descarga el modelo.');
  await renderProcessedSource();
}

async function processSelectionBox(rect) {
  if (!rect || rect.w < 12 || rect.h < 12 || !canvasSnapshot || isProcessing) return;

  setUndoState({
    image: canvasSnapshot,
    restoreSource,
    outputOffsetX,
    outputOffsetY,
  });
  setProcessingState(true);
  showLoading('Procesando el recorte', 'La IA analizará solo el área seleccionada.');

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = canvas.width;
  sourceCanvas.height = canvas.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.putImageData(canvasSnapshot, 0, 0);

  const selectionX = Math.max(0, Math.floor(rect.x));
  const selectionY = Math.max(0, Math.floor(rect.y));
  const selectionW = Math.min(canvas.width - selectionX, Math.ceil(rect.x + rect.w) - selectionX);
  const selectionH = Math.min(canvas.height - selectionY, Math.ceil(rect.y + rect.h) - selectionY);
  const margin = Math.max(40, Math.round(Math.min(selectionW, selectionH) * 0.28));
  const contextX = Math.max(0, selectionX - margin);
  const contextY = Math.max(0, selectionY - margin);
  const contextW = Math.min(canvas.width - contextX, selectionW + selectionX - contextX + margin);
  const contextH = Math.min(canvas.height - contextY, selectionH + selectionY - contextY + margin);

  const contextCanvas = document.createElement('canvas');
  contextCanvas.width = contextW;
  contextCanvas.height = contextH;
  contextCanvas.getContext('2d').drawImage(sourceCanvas, contextX, contextY, contextW, contextH, 0, 0, contextW, contextH);

  const selectionCanvas = document.createElement('canvas');
  selectionCanvas.width = selectionW;
  selectionCanvas.height = selectionH;
  selectionCanvas.getContext('2d').drawImage(sourceCanvas, selectionX, selectionY, selectionW, selectionH, 0, 0, selectionW, selectionH);

  try {
    const processed = await removeBackgroundFrom(contextCanvas);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = selectionW;
    outputCanvas.height = selectionH;
    outputCanvas.getContext('2d').drawImage(processed, selectionX - contextX, selectionY - contextY, selectionW, selectionH, 0, 0, selectionW, selectionH);
    const trimmed = trimTransparentPixels(outputCanvas);
    canvas.width = trimmed.width;
    canvas.height = trimmed.height;
    setCanvasZoom(canvasZoom);
    outputOffsetX = trimmed.x;
    outputOffsetY = trimmed.y;
    restoreSource = selectionCanvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(trimmed.canvas, 0, 0);
    saveProcessedMask();
    setStatus(`Recorte ajustado al sujeto: ${canvas.width} x ${canvas.height} px. Puedes recuperar colores con el pincel.`);
  } catch (error) {
    console.error(error);
    if (canvasSnapshot) ctx.putImageData(canvasSnapshot, 0, 0);
    setStatus(error.message || 'La IA no pudo procesar el recorte. Vuelve a intentarlo.', true);
  } finally {
    hideLoading();
    setProcessingState(false);
    selectionRect = null;
    canvasSnapshot = null;
  }
}

function startErasing(event) {
  if (mode !== 'erase' && mode !== 'restore') return;
  setUndoState(captureUndoState());
  drawing = true;
  processedMask = null;
  processedAlpha = null;
  maskOptions.classList.add('hidden');
  const pos = getPointerPosition(event);
  if (mode === 'restore') {
    previousRestorePoint = pos;
    restoreAt(pos, pos);
  } else {
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }
}

function eraseMove(event) {
  if (!drawing || mode !== 'erase') return;

  const pos = getPointerPosition(event);
  ctx.lineWidth = Number(brushSizeInput.value);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function restoreAt(from, to) {
  if (!restoreSource) return;
  const radius = Number(brushSizeInput.value) / 2;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.35)));

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(restoreSource, -outputOffsetX, -outputOffsetY);
    ctx.restore();
  }
}

function restoreMove(event) {
  if (!drawing || mode !== 'restore' || !previousRestorePoint) return;
  const position = getPointerPosition(event);
  restoreAt(previousRestorePoint, position);
  previousRestorePoint = position;
}

function stopErasing() {
  if (!drawing) return;
  drawing = false;
  previousRestorePoint = null;
  ctx.beginPath();
  ctx.globalCompositeOperation = 'source-over';
}

imageInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    setStatus('Formato no compatible. Usa una imagen PNG, JPG o WebP.', true);
    imageInput.value = '';
    return;
  }
  originalName = file.name.replace(/\.[^/.]+$/, '') || 'imagen_editada';

  const reader = new FileReader();
  reader.onerror = () => setStatus('No se pudo leer el archivo seleccionado.', true);
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      restoreSource = img;
      setUndoState(null);
      processedMask = null;
      processedAlpha = null;
      outputOffsetX = 0;
      outputOffsetY = 0;
      maskOptions.classList.add('hidden');
      drawImageToCanvas(img);
      setStatus(`${file.name} · ${img.naturalWidth} x ${img.naturalHeight} px`);
      imageMeta.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
      actionControls.classList.remove('hidden');
      actionControls.classList.add('flex');
      toolControls.classList.remove('hidden');
      toolControls.classList.add('flex');
      setMode('auto');
    };
    img.onerror = () => setStatus('No se pudo abrir este archivo de imagen.', true);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

removeBgBtn.addEventListener('click', () => {
  setMode('auto');
  removeBackgroundWithAI();
});

resetBtn.addEventListener('click', renderOriginal);
undoBtn.addEventListener('click', undoLastAction);
zoomInBtn.addEventListener('click', () => setCanvasZoom(canvasZoom + 0.25));
zoomOutBtn.addEventListener('click', () => setCanvasZoom(canvasZoom - 0.25));
zoomFitBtn.addEventListener('click', () => setCanvasZoom(1));
maskStrengthInput.addEventListener('input', applyMaskStrength);

btnAuto.addEventListener('click', () => {
  setMode('auto');
  if (originalImage) removeBackgroundWithAI();
});

btnBox.addEventListener('click', () => setMode('box'));
btnColor.addEventListener('click', () => setMode('color'));
btnErase.addEventListener('click', () => setMode('erase'));
btnRestore.addEventListener('click', () => setMode('restore'));
colorToleranceInput.addEventListener('input', () => {
  colorToleranceValue.textContent = `${colorToleranceInput.value}%`;
});

canvas.addEventListener('pointerdown', (event) => {
  if (isProcessing) return;
  pointerId = event.pointerId;
  canvas.setPointerCapture(pointerId);
  if (mode === 'erase') {
    startErasing(event);
    return;
  }
  if (mode === 'restore') {
    startErasing(event);
    return;
  }
  if (mode === 'color') {
    startColorErase(event);
    return;
  }

  if (mode === 'box') {
    isSelecting = true;
    selectionStart = getPointerPosition(event);
    canvasSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    selectionRect = null;
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (mode === 'color') {
    moveColorErase(event);
    return;
  }
  if (mode === 'erase') {
    eraseMove(event);
    return;
  }
  if (mode === 'restore') {
    restoreMove(event);
    return;
  }

  if (mode === 'box' && isSelecting && canvasSnapshot) {
    const pos = getPointerPosition(event);
    const x = Math.min(selectionStart.x, pos.x);
    const y = Math.min(selectionStart.y, pos.y);
    const width = Math.abs(pos.x - selectionStart.x);
    const height = Math.abs(pos.y - selectionStart.y);

    ctx.putImageData(canvasSnapshot, 0, 0);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.12)';
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    selectionRect = { x, y, w: width, h: height };
  }
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  if (mode === 'color') {
    stopColorErase();
    return;
  }
  if (mode === 'erase') {
    stopErasing();
    return;
  }
  if (mode === 'restore') {
    stopErasing();
    return;
  }

  if (mode === 'box' && isSelecting) {
    isSelecting = false;
    const pos = getPointerPosition(event);
    const x = Math.min(selectionStart.x, pos.x);
    const y = Math.min(selectionStart.y, pos.y);
    const width = Math.abs(pos.x - selectionStart.x);
    const height = Math.abs(pos.y - selectionStart.y);
    selectionRect = { x, y, w: width, h: height };

    if (selectionRect.w > 12 && selectionRect.h > 12) {
      processSelectionBox(selectionRect);
    } else {
      ctx.putImageData(canvasSnapshot, 0, 0);
      canvasSnapshot = null;
      selectionRect = null;
    }
  }
});

canvas.addEventListener('pointercancel', () => {
  pointerId = null;
  if (mode === 'color') {
    stopColorErase(false);
  }
  if (mode === 'erase' || mode === 'restore') {
    stopErasing();
  }
  if (mode === 'box' && canvasSnapshot) {
    ctx.putImageData(canvasSnapshot, 0, 0);
    canvasSnapshot = null;
    selectionRect = null;
    isSelecting = false;
  }
});

const downloadBtnClick = () => {
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `${originalName}-sin-fondo.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
};

downloadBtn.addEventListener('click', downloadBtnClick);
