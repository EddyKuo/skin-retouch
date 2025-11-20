import { SkinRetouchEngine } from './SkinRetouchEngine.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM 已完全加載和解析");

    // --- DOM Elements ---
    const canvas = document.getElementById('gl-canvas');
    const canvasContainer = document.querySelector('.canvas-container');
    const radiusSlider = document.getElementById('radius-slider');
    const radiusValueSpan = document.getElementById('radius-value');
    const detailSlider = document.getElementById('detail-slider');
    const detailValueSpan = document.getElementById('detail-value');
    const toleranceSlider = document.getElementById('tolerance-slider');
    const toleranceValueSpan = document.getElementById('tolerance-value');
    const expansionSlider = document.getElementById('expansion-slider');
    const expansionValueSpan = document.getElementById('expansion-value');
    const colorSwatchesContainer = document.getElementById('color-swatches');
    const clearColorsBtn = document.getElementById('clear-colors-btn');
    const viewModeGroup = document.getElementById('view-mode-group');
    const loadBtn = document.getElementById('load-btn');
    const saveBtn = document.getElementById('save-btn');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.querySelector('.preview-container');

    // --- State Variables ---
    let image = null;
    const params = {
        smoothness: 0.1 + (parseFloat(radiusSlider.value) / 100) * 15,
        detailAmount: parseFloat(detailSlider.value) / 100.0,
        colorTolerance: parseFloat(toleranceSlider.value) / 100.0,
        maskExpansion: parseFloat(expansionSlider.value) / 200.0,
        maskBlurRadius: 5.0,
        selectedSkinTones: [],
        viewMode: 'final',
        transformMatrix: null
    };

    // --- Viewport State ---
    let scale = 1.0;
    let panX = 0.0;
    let panY = 0.0;
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // --- Engine Initialization ---
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    const engine = new SkinRetouchEngine(gl);

    // --- Event Listeners ---
    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    radiusSlider.addEventListener('input', handleSliderChange);
    detailSlider.addEventListener('input', handleSliderChange);
    toleranceSlider.addEventListener('input', handleSliderChange);
    expansionSlider.addEventListener('input', handleSliderChange);
    clearColorsBtn.addEventListener('click', handleClearColors);
    saveBtn.addEventListener('click', handleSave);
    viewModeGroup.addEventListener('change', (event) => {
        params.viewMode = event.target.value;
        render();
    });
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);

    // --- Throttle Helper ---
    function throttle(func, limit) {
        let inThrottle;
        let lastFunc;
        let lastRan;
        return function() {
            const context = this;
            const args = arguments;
            if (!inThrottle) {
                func.apply(context, args);
                lastRan = Date.now();
                inThrottle = true;
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(function() {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        }
    }

    // --- Resize Handler ---
    const handleResize = throttle(() => {
        if (!image) return;
        
        const displayWidth = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;

        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
            render();
        }
    }, 100);

    window.addEventListener('resize', handleResize);

    // --- Handlers ---
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                image = img;
                params.selectedSkinTones = [];
                updateColorSwatches();
                scale = 1.0;
                panX = 0.0;
                panY = 0.0;
                canvas.width = canvasContainer.clientWidth;
                canvas.height = canvasContainer.clientHeight;

                engine.setImage(image);
                render();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function handleSliderChange(event) {
        if (event.target === radiusSlider) {
            const sliderValue = parseFloat(event.target.value);
            params.smoothness = 0.1 + (sliderValue / 100) * 15;
            radiusValueSpan.textContent = sliderValue.toFixed(1);
        } else if (event.target === detailSlider) {
            params.detailAmount = parseFloat(event.target.value) / 100.0;
            detailValueSpan.textContent = event.target.value;
        } else if (event.target === toleranceSlider) {
            params.colorTolerance = parseFloat(event.target.value) / 100.0;
            toleranceValueSpan.textContent = event.target.value;
        } else if (event.target === expansionSlider) {
            params.maskExpansion = parseFloat(event.target.value) / 200.0;
            expansionValueSpan.textContent = event.target.value;
        }
        if (image) render();
    }

    function handleClearColors() {
        params.selectedSkinTones = [];
        updateColorSwatches();
        if (image) render();
    }

    function handleContextMenu(event) {
        event.preventDefault();
        if (!image) return;
        if (params.selectedSkinTones.length >= 10) {
            params.selectedSkinTones.shift();
        }
        const { pixelX, pixelY } = getPixelCoordinatesFromEvent(event);
        if (pixelX < 0 || pixelX >= image.width || pixelY < 0 || pixelY >= image.height) return;

        const rgb = engine.getPixelColor(pixelX, pixelY);
        const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
        params.selectedSkinTones.push(hsv);
        updateColorSwatches();
        render();
    }

    function handleSave() {
        if (!image) return;
        // Use BatchProcessor's renderer logic to get full res image
        const base64Data = BatchProcessor.renderImageOffscreen(image);
        window.electronAPI.saveImage({ data: base64Data });
    }

    // --- Viewport Control ---
    function handleWheel(event) {
        event.preventDefault();
        if (!image) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const { aspectCorrectionX, aspectCorrectionY } = getTransformMatrix();
        const clipX = (mouseX / rect.width) * 2 - 1;
        const clipY = (mouseY / rect.height) * -2 + 1;
        const tx = panX / (canvas.width / 2);
        const ty = -panY / (canvas.height / 2);
        const sx = scale * aspectCorrectionX;
        const sy = scale * aspectCorrectionY;
        const imageX = (clipX - tx) / sx;
        const imageY = (clipY - ty) / sy;

        const zoomFactor = 1.1;
        if (event.deltaY < 0) {
            scale *= zoomFactor;
        } else {
            scale /= zoomFactor;
        }
        scale = Math.max(0.02, Math.min(scale, 50));
        const newScale = scale;

        const newSx = newScale * aspectCorrectionX;
        const newSy = newScale * aspectCorrectionY;
        const newTx = clipX - imageX * newSx;
        const newTy = clipY - imageY * newSy;

        panX = newTx * (canvas.width / 2);
        panY = -newTy * (canvas.height / 2);

        render();
    }

    function handleMouseDown(event) {
        if (event.button !== 0) return;
        isPanning = true;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
    }

    function handleMouseMove(event) {
        if (!isPanning) return;
        canvas.style.cursor = 'grabbing';
        const dx = event.clientX - lastMouseX;
        const dy = event.clientY - lastMouseY;
        panX += dx;
        panY += dy;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
        render();
    }

    function handleMouseUp(event) {
        if (event.button !== 0 && event.type !== 'mouseleave') return;
        isPanning = false;
        canvas.style.cursor = 'grab';
    }

    function render() {
        if (!image) return;
        const { transformMatrix } = getTransformMatrix();
        params.transformMatrix = transformMatrix;
        engine.renderToScreen(params);
        renderMaskPreviewOnMainCanvas();
    }

    function renderMaskPreviewOnMainCanvas() {
        if (!image) return;
        const canvasRect = canvas.getBoundingClientRect();
        const previewRect = previewContainer.getBoundingClientRect();

        // Calculate position relative to canvas (bottom-left origin for GL scissors)
        // GL y=0 is bottom. HTML y=0 is top.
        const previewX = previewRect.left - canvasRect.left;
        const previewY = canvasRect.height - (previewRect.top - canvasRect.top) - previewRect.height;

        engine.drawMaskPreview(previewX, previewY, previewRect.width, previewRect.height);
    }

    function getTransformMatrix() {
        const canvasAspect = canvas.width / canvas.height;
        const imageAspect = image.width / image.height;
        let aspectCorrectionX = 1.0, aspectCorrectionY = 1.0;
        if (canvasAspect > imageAspect) {
            aspectCorrectionX = imageAspect / canvasAspect;
        } else {
            aspectCorrectionY = canvasAspect / imageAspect;
        }
        const sx = scale * aspectCorrectionX;
        const sy = scale * aspectCorrectionY;
        const tx = panX / (canvas.width / 2);
        const ty = -panY / (canvas.height / 2);
        const transformMatrix = [ sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1 ];
        return { transformMatrix, aspectCorrectionX, aspectCorrectionY };
    }

    function getPixelCoordinatesFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        const { aspectCorrectionX, aspectCorrectionY } = getTransformMatrix();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const clipX = (mouseX / rect.width) * 2 - 1;
        const clipY = (mouseY / rect.height) * -2 + 1;
        const tx = panX / (canvas.width / 2);
        const ty = -panY / (canvas.height / 2);
        const sx = scale * aspectCorrectionX;
        const sy = scale * aspectCorrectionY;
        const quadX = (clipX - tx) / sx;
        const quadY = (clipY - ty) / sy;
        const texX = (quadX + 1) / 2;
        const texY = (quadY + 1) / 2;
        return {
            pixelX: Math.floor(texX * image.width),
            pixelY: Math.floor(texY * image.height)
        };
    }

    function updateColorSwatches() {
        colorSwatchesContainer.innerHTML = '';
        params.selectedSkinTones.forEach(hsv => {
            const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
            const swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.style.backgroundColor = `rgb(${Math.round(rgb[0]*255)}, ${Math.round(rgb[1]*255)}, ${Math.round(rgb[2]*255)})`;
            colorSwatchesContainer.appendChild(swatch);
        });
    }

    function rgbToHsv(r, g, b) {
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        let d = max - min;
        s = max == 0 ? 0 : d / max;
        if (max == min) { h = 0; } 
        else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, v];
    }

    function hsvToRgb(h, s, v) {
        let r, g, b;
        let i = Math.floor(h * 6);
        let f = h * 6 - i;
        let p = v * (1 - s);
        let q = v * (1 - f * s);
        let t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }
        return [r, g, b];
    }

    // --- Draggable Window ---
    function initDraggable(element, handle) {
        let isDragging = false;
        let offsetX, offsetY;
        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;
            const parentRect = element.parentElement.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            newX = Math.max(0, Math.min(parentRect.width - elementRect.width, newX));
            newY = Math.max(0, Math.min(parentRect.height - elementRect.height, newY));
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
            element.style.bottom = 'auto';
            element.style.right = 'auto';
            if (image) render();
        });
        document.addEventListener('mouseup', (e) => {
            if (e.button !== 0) return;
            isDragging = false;
        });
    }
    initDraggable(previewContainer, previewContainer.querySelector('p'));

    // --- Batch Processor ---
    const BatchProcessor = {
        queue: [],
        currentIndex: 0,
        isProcessing: false,
        engine: null,
        init() {
            const batchBtn = document.getElementById('batch-btn');
            batchBtn.addEventListener('click', this.handleBatchClick.bind(this));
            window.electronAPI.onFolderSelected(this.start.bind(this));
            window.electronAPI.onImageSaved((filePath) => {
                this.log(`✅ 已儲存: ${filePath.split('\\').pop()}`);
                this.processNext();
            });
            window.electronAPI.onBatchError((errorMessage) => {
                this.log(`❌ 錯誤: ${errorMessage}`);
                this.stop();
            });

            // Initialize offscreen engine
            const offscreenCanvas = document.createElement('canvas');
            // No need to append to document, just get context
            // Note: we need to set width/height but engine.resize handles it
            const gl = offscreenCanvas.getContext('webgl');
            this.engine = new SkinRetouchEngine(gl);
        },
        handleBatchClick() {
            if (this.isProcessing) return;
            if (params.selectedSkinTones.length === 0) {
                alert('開始批次處理前，請先選取至少一個膚色樣本。');
                return;
            }
            window.electronAPI.openFolderDialog();
        },
        start(files) {
            if (!files || files.length === 0) {
                alert('選取的資料夾中未找到任何圖片檔案。');
                return;
            }
            this.queue = files;
            this.currentIndex = 0;
            this.isProcessing = true;
            this.updateUI(true);
            this.log(`開始批次處理 ${files.length} 張圖片...\n`);
            this.processNext();
        },
        stop() {
            this.isProcessing = false;
            this.updateUI(false);
        },
        processNext() {
            if (this.currentIndex >= this.queue.length) {
                this.log('\n🎉 批次處理完成!');
                this.stop();
                this.updateProgressBar(100);
                return;
            }
            const filePath = this.queue[this.currentIndex];
            const fileName = filePath.split('\\').pop();
            this.log(`正在處理 ${fileName} (${this.currentIndex + 1}/${this.queue.length})...`);
            this.updateProgressBar((this.currentIndex / this.queue.length) * 100);
            
            const img = new Image();
            img.onload = () => {
                const base64Data = this.renderImageOffscreen(img);
                window.electronAPI.saveBatchImage({ data: base64Data, originalPath: filePath });
                this.currentIndex++;
            };
            img.onerror = () => {
                this.log(`❌ 無法載入圖片: ${fileName}`);
                this.currentIndex++;
                this.processNext();
            };
            img.src = "file://" + filePath;
        },
        renderImageOffscreen(imageObject) {
            // Reuse the persistent engine!
            this.engine.setImage(imageObject);
            this.engine.renderToTexture(params);
            const pixels = this.engine.getPixelData();
            
            // Convert pixels to Base64 (needs a 2D canvas)
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageObject.width;
            tempCanvas.height = imageObject.height;
            const tempCtx = tempCanvas.getContext('2d');
            const imageData = tempCtx.createImageData(imageObject.width, imageObject.height);
            const data = imageData.data;

            // Flip Y
            for (let i = 0; i < imageObject.height; i++) {
                for (let j = 0; j < imageObject.width; j++) {
                    const srcIndex = (i * imageObject.width + j) * 4;
                    const destIndex = ((imageObject.height - 1 - i) * imageObject.width + j) * 4;
                    data[destIndex] = pixels[srcIndex];
                    data[destIndex + 1] = pixels[srcIndex + 1];
                    data[destIndex + 2] = pixels[srcIndex + 2];
                    data[destIndex + 3] = pixels[srcIndex + 3];
                }
            }
            tempCtx.putImageData(imageData, 0, 0);
            const dataUrl = tempCanvas.toDataURL('image/png');
            return dataUrl.replace(/^data:image\/png;base64,/, "");
        },
        updateUI(isProcessing) {
            const batchProgressContainer = document.getElementById('batch-progress');
            const batchBtn = document.getElementById('batch-btn');
            const startBatchBtn = document.getElementById('start-batch-btn');
            batchProgressContainer.style.display = isProcessing ? 'block' : 'none';
            batchBtn.disabled = isProcessing;
            startBatchBtn.disabled = isProcessing;
            if (isProcessing) {
                batchBtn.textContent = '處理中...';
                startBatchBtn.textContent = '處理中...';
            } else {
                batchBtn.textContent = '📂 選擇批次圖片';
                startBatchBtn.textContent = '✨ 開始批次修飾';
            }
        },
        log(message) {
            const batchLog = document.getElementById('batch-log');
            if(this.currentIndex === 0 && message.startsWith('開始')) batchLog.textContent = '';
            batchLog.textContent += message + '\n';
            batchLog.scrollTop = batchLog.scrollHeight;
        },
        updateProgressBar(percentage) {
            const batchProgressBar = document.getElementById('batch-progress-bar');
            batchProgressBar.style.width = `${percentage}%`;
        }
    };
    BatchProcessor.init();
});
