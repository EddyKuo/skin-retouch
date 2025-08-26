import { rgbToHsv, hsvToRgb } from './utils.js';

/**
 * ui-handlers.js
 * 處理所有 UI 事件
 */

function handleFileSelect(event, appState, renderer) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            appState.image = img;
            
            // 重置狀態
            appState.selectedSkinTones = [];
            updateColorSwatches(appState);
            appState.scale = 1.0;
            appState.panX = 0.0;
            appState.panY = 0.0;
            
            const { canvas, canvasContainer } = appState.dom;
            canvas.width = canvasContainer.clientWidth;
            canvas.height = canvasContainer.clientHeight;
            renderer.gl.viewport(0, 0, canvas.width, canvas.height);

            renderer.setup(img);
            renderer.render(appState);
            renderer.renderMaskPreview(appState);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleSliderChange(event, appState, renderer) {
    const { radiusSlider, detailSlider, toleranceSlider, radiusValueSpan, detailValueSpan, toleranceValueSpan } = appState.dom;
    
    if (event.target === radiusSlider) {
        const sliderValue = parseFloat(event.target.value);
        appState.smoothness = 0.1 + (sliderValue / 100) * 15;
        radiusValueSpan.textContent = sliderValue.toFixed(1);
    } else if (event.target === detailSlider) {
        appState.detailAmount = parseFloat(event.target.value) / 100.0;
        detailValueSpan.textContent = event.target.value;
    } else if (event.target === toleranceSlider) {
        appState.colorTolerance = parseFloat(event.target.value) / 100.0;
        toleranceValueSpan.textContent = event.target.value;
    }
    
    if (appState.image) {
        renderer.render(appState);
        if (event.target === toleranceSlider) {
            renderer.renderMaskPreview(appState);
        }
    }
}

function handleClearColors(appState, renderer) {
    appState.selectedSkinTones = [];
    updateColorSwatches(appState);
    if (appState.image) {
        renderer.render(appState);
        renderer.renderMaskPreview(appState);
    }
}

function handleContextMenu(event, appState, renderer) {
    event.preventDefault();
    if (!appState.image) return;

    if (appState.selectedSkinTones.length >= 10) {
        appState.selectedSkinTones.shift();
    }

    const { pixelX, pixelY } = renderer.getPixelCoordinatesFromEvent(event, appState);
    if (pixelX < 0 || pixelX >= appState.image.width || pixelY < 0 || pixelY >= appState.image.height) return;

    const gl = renderer.gl;
    const tempFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderer.textures.original, 0);
    
    const pixelData = new Uint8Array(4);
    gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(tempFBO);

    const rgb = [pixelData[0] / 255, pixelData[1] / 255, pixelData[2] / 255];
    const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    appState.selectedSkinTones.push(hsv);
    
    updateColorSwatches(appState);
    renderer.render(appState);
    renderer.renderMaskPreview(appState);
}

function handleSave(appState, batchProcessor) {
    if (!appState.image) return;
    const base64Data = batchProcessor.renderImageOffscreen(appState.image);
    window.electronAPI.saveImage({ data: base64Data });
}

function handleViewModeChange(event, appState, renderer) {
    appState.currentViewMode = event.target.value;
    renderer.render(appState);
}

function updateColorSwatches(appState) {
    const { colorSwatchesContainer } = appState.dom;
    colorSwatchesContainer.innerHTML = '';
    appState.selectedSkinTones.forEach(hsv => {
        const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
        const swatch = document.createElement('div');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = `rgb(${Math.round(rgb[0]*255)}, ${Math.round(rgb[1]*255)}, ${Math.round(rgb[2]*255)})`;
        colorSwatchesContainer.appendChild(swatch);
    });
}

export function setupUIHandlers(appState, renderer, batchProcessor) {
    const { loadBtn, fileInput, radiusSlider, detailSlider, toleranceSlider, clearColorsBtn, saveBtn, viewModeGroup, canvas } = appState.dom;

    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFileSelect(e, appState, renderer));
    
    radiusSlider.addEventListener('input', (e) => handleSliderChange(e, appState, renderer));
    detailSlider.addEventListener('input', (e) => handleSliderChange(e, appState, renderer));
    toleranceSlider.addEventListener('input', (e) => handleSliderChange(e, appState, renderer));
    
    clearColorsBtn.addEventListener('click', () => handleClearColors(appState, renderer));
    saveBtn.addEventListener('click', () => handleSave(appState, batchProcessor));
    
    viewModeGroup.addEventListener('change', (e) => handleViewModeChange(e, appState, renderer));
    canvas.addEventListener('contextmenu', (e) => handleContextMenu(e, appState, renderer));
}
