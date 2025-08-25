// 從輔助模組中引入 WebGL 著色器和程序創建函式
import { createShader, createProgram } from './webgl-utils.js';

// 當整個 HTML 文件被完全加載和解析後，執行初始化程式碼
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM 已完全加載和解析");

    // --- DOM 元素獲取 ---
    // 獲取主要的 WebGL 畫布及其容器
    const canvas = document.getElementById('gl-canvas');
    const canvasContainer = document.querySelector('.canvas-container');
    // 獲取控制項元素：滑桿、數值顯示、按鈕等
    const radiusSlider = document.getElementById('radius-slider');
    const radiusValueSpan = document.getElementById('radius-value');
    const detailSlider = document.getElementById('detail-slider');
    const detailValueSpan = document.getElementById('detail-value');
    const toleranceSlider = document.getElementById('tolerance-slider');
    const toleranceValueSpan = document.getElementById('tolerance-value');
    const colorSwatchesContainer = document.getElementById('color-swatches');
    const clearColorsBtn = document.getElementById('clear-colors-btn');
    const viewModeGroup = document.getElementById('view-mode-group');
    const loadBtn = document.getElementById('load-btn');
    const saveBtn = document.getElementById('save-btn');
    const fileInput = document.getElementById('file-input');
    // 獲取用於預覽皮膚遮罩的 2D 畫布及其上下文
    const maskPreviewCanvas = document.getElementById('mask-preview-canvas');
    const maskPreviewCtx = maskPreviewCanvas.getContext('2d');

    // --- WebGL 與狀態變數初始化 ---
    // 獲取 WebGL 上下文，preserveDrawingBuffer: true 允許從畫布讀取像素
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    let image = null; // 當前載入的圖片對象
    // 從滑桿初始值計算處理參數
    let smoothness = 0.1 + (parseFloat(radiusSlider.value) / 100) * 15; // 平滑度（模糊半徑）
    let detailAmount = parseFloat(detailSlider.value) / 100.0; // 細節保留量
    let colorTolerance = parseFloat(toleranceSlider.value) / 100.0; // 膚色選取容差
    let selectedSkinTones = []; // 儲存使用者選取的膚色樣本 (HSV格式)
    let currentViewMode = 'final'; // 當前視圖模式 (final, high, low)

    // --- 視口狀態變數 (用於縮放與平移) ---
    let scale = 1.0; // 縮放比例
    let panX = 0.0; // X軸平移量
    let panY = 0.0; // Y軸平移量
    let isPanning = false; // 是否正在平移
    let lastMouseX = 0; // 上一次滑鼠X座標
    let lastMouseY = 0; // 上一次滑鼠Y座標

    // --- WebGL 資源變數 ---
    let originalTexture, blurProgram, maskProgram, finalProgram; // 紋理和著色器程序
    let positionBuffer, texCoordBuffer; // 頂點和紋理座標緩衝區
    let textures = [], framebuffers = []; // 離屏渲染用的紋理和幀緩衝區

    // --- GLSL 著色器原始碼 ---

    // 頂點著色器：處理頂點位置和紋理座標
    const vertexShaderSource = `
        attribute vec2 a_position;      // 頂點位置
        attribute vec2 a_texCoord;      // 紋理座標
        varying vec2 v_texCoord;        // 傳遞給片段著色器的紋理座標
        uniform mat4 u_transform;       // 變換矩陣 (用於縮放/平移)
        void main() {
            gl_Position = u_transform * vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `;

    // 片段著色器：高斯模糊
    const blurFragmentShaderSource = `
        precision highp float;
        uniform sampler2D u_image;      // 輸入紋理
        uniform vec2 u_resolution;      // 圖片解析度
        uniform float u_radius;         // 模糊半徑 (sigma)
        uniform vec2 u_dir;             // 模糊方向 (1,0) 或 (0,1)
        varying vec2 v_texCoord;
        void main() {
            vec2 uv = v_texCoord;
            vec4 color = vec4(0.0);
            float total = 0.0;
            float sigma = u_radius;
            // 如果半徑太小，直接返回原色，避免不必要的計算
            if (sigma < 0.1) {
                gl_FragColor = texture2D(u_image, uv);
                return;
            }
            // 進行高斯採樣
            for (float i = -15.0; i <= 15.0; i += 1.0) {
                // 計算高斯權重
                float weight = (1.0 / (2.5066 * sigma)) * exp(-0.5 * (i * i) / (sigma * sigma));
                vec2 offset = u_dir * i / u_resolution;
                color += texture2D(u_image, uv + offset) * weight;
                total += weight;
            }
            gl_FragColor = color / total; // 加權平均
        }
    `;

    // 片段著色器：生成膚色遮罩
    const maskFragmentShaderSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_originalImage; // 原始圖片
        uniform vec3 u_skinTones[10];      // 選取的膚色樣本 (HSV)
        uniform int u_toneCount;           // 膚色樣本數量
        uniform float u_tolerance;         // 顏色容差

        // RGB 到 HSV 的轉換函式
        vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }

        // 計算兩個色相(Hue)之間的最短距離
        float hueDiff(float h1, float h2) {
            float d = abs(h1 - h2);
            return min(d, 1.0 - d);
        }

        void main() {
            // 忽略紋理座標外的片元
            if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }
            vec3 pixelRGB = texture2D(u_originalImage, v_texCoord).rgb;
            vec3 pixelHSV = rgb2hsv(pixelRGB);
            float mask = 0.0; // 遮罩值，0為黑，1為白
            // 遍歷所有膚色樣本
            for (int i = 0; i < 10; i++) {
                if (i >= u_toneCount) break;
                vec3 toneHSV = u_skinTones[i];
                float hDiff = hueDiff(pixelHSV.x, toneHSV.x);
                float sDiff = abs(pixelHSV.y - toneHSV.y);
                // 如果色相和飽和度差異在容差範圍內，則視為皮膚
                if (hDiff < u_tolerance && sDiff < u_tolerance * 1.5) {
                    mask = 1.0;
                    break;
                }
            }
            gl_FragColor = vec4(vec3(mask), 1.0);
        }
    `;

    // 片段著色器：最終合成
    const finalFragmentShaderSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_originalImage; // 原始圖片
        uniform sampler2D u_blurredImage;  // 低頻層 (模糊後的圖片)
        uniform sampler2D u_skinMask;      // 膚色遮罩
        uniform float u_detailAmount;      // 細節保留量
        uniform int u_viewMode;            // 視圖模式 (0: Final, 2: High, 3: Low)

        void main() {
            if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
                gl_FragColor = vec4(0.1, 0.1, 0.1, 1.0); // 畫布背景色
                return;
            }
            vec4 original = texture2D(u_originalImage, v_texCoord);
            vec4 blurred = texture2D(u_blurredImage, v_texCoord);
            float mask = texture2D(u_skinMask, v_texCoord).r;

            // 高低頻分離：高頻 = 原始 - 低頻
            vec3 highPass = original.rgb - blurred.rgb;

            // 根據視圖模式返回不同結果
            if (u_viewMode == 2) { // 高頻視圖
                gl_FragColor = vec4(highPass + 0.5, 1.0); // +0.5 是為了將負值移到可見範圍
                return;
            }
            if (u_viewMode == 3) { // 低頻視圖
                gl_FragColor = blurred;
                return;
            }

            // 計算平滑後的皮膚顏色：低頻 + 高頻 * 細節量
            vec3 smoothedSkin = blurred.rgb + highPass * u_detailAmount;
            // 使用遮罩混合原始顏色和平滑後的顏色
            vec3 finalColor = mix(original.rgb, smoothedSkin, mask);
            gl_FragColor = vec4(finalColor, original.a);
        }
    `;

    // --- 事件監聽器綁定 ---
    console.log("綁定事件監聽器...");

    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    radiusSlider.addEventListener('input', handleSliderChange);
    detailSlider.addEventListener('input', handleSliderChange);
    toleranceSlider.addEventListener('input', handleSliderChange);
    clearColorsBtn.addEventListener('click', handleClearColors);
    saveBtn.addEventListener('click', handleSave);

    viewModeGroup.addEventListener('change', (event) => {
        currentViewMode = event.target.value;
        render();
    });

    // 視口控制事件
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu); // 右鍵選色

    console.log("事件監聽器已綁定。");

    // --- 主要功能函式 ---

    /**
     * 處理檔案選擇事件
     */
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                image = img;
                
                // 重置狀態
                selectedSkinTones = [];
                updateColorSwatches();
                scale = 1.0;
                panX = 0.0;
                panY = 0.0;
                
                // 調整畫布大小以適應容器
                canvas.width = canvasContainer.clientWidth;
                canvas.height = canvasContainer.clientHeight;
                gl.viewport(0, 0, canvas.width, canvas.height);

                // 初始化 WebGL 資源並首次渲染
                setupWebGL();
                render();
                renderMaskPreview();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /**
     * 處理滑桿值變更事件
     */
    function handleSliderChange(event) {
        if (event.target === radiusSlider) {
            const sliderValue = parseFloat(event.target.value);
            smoothness = 0.1 + (sliderValue / 100) * 15;
            radiusValueSpan.textContent = sliderValue.toFixed(1);
        } else if (event.target === detailSlider) {
            detailAmount = parseFloat(event.target.value) / 100.0;
            detailValueSpan.textContent = event.target.value;
        } else if (event.target === toleranceSlider) {
            colorTolerance = parseFloat(event.target.value) / 100.0;
            toleranceValueSpan.textContent = event.target.value;
            if (image) renderMaskPreview(); // 僅在容差變化時更新遮罩預覽
        }
        if (image) render(); // 任何滑桿變化都觸發重新渲染
    }

    /**
     * 處理清除膚色樣本事件
     */
    function handleClearColors() {
        selectedSkinTones = [];
        updateColorSwatches();
        if (image) {
            render();
            renderMaskPreview();
        }
    }

    /**
     * 處理右鍵點擊事件 (選取膚色)
     */
    function handleContextMenu(event) {
        event.preventDefault(); // 防止瀏覽器預設右鍵菜單
        if (!image) return;

        // 維護最多10個顏色樣本
        if (selectedSkinTones.length >= 10) {
            selectedSkinTones.shift();
        }

        // 從滑鼠事件座標轉換為圖片像素座標
        const { pixelX, pixelY } = getPixelCoordinatesFromEvent(event);
        if (pixelX < 0 || pixelX >= image.width || pixelY < 0 || pixelY >= image.height) return;

        // 使用 FBO 從原始紋理中讀取指定座標的像素顏色
        const tempFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, originalTexture, 0);
        
        const pixelData = new Uint8Array(4);
        gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(tempFBO);

        // 將讀取的 RGBA 顏色轉換為 HSV 並儲存
        const rgb = [pixelData[0] / 255, pixelData[1] / 255, pixelData[2] / 255];
        const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
        selectedSkinTones.push(hsv);
        
        // 更新 UI 並重新渲染
        updateColorSwatches();
        render();
        renderMaskPreview();
    }

    /**
     * 處理儲存圖片事件
     */
    function handleSave() {
        if (!image) return;
        // 使用批次處理模組的離屏渲染函式來獲取結果
        const base64Data = BatchProcessor.renderImageOffscreen(image);
        // 透過 preload 腳本呼叫主程序的儲存功能
        window.electronAPI.saveImage({ data: base64Data });
    }

    // --- 視口控制函式 ---

    function handleWheel(event) {
        event.preventDefault();
        if (!image) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const zoomFactor = 1.1;
        const oldScale = scale;
        if (event.deltaY < 0) { scale *= zoomFactor; } 
        else { scale /= zoomFactor; }
        scale = Math.max(0.02, Math.min(scale, 50)); // 限制縮放範圍
        // 以滑鼠為中心進行縮放
        panX = mouseX - (mouseX - panX) * (scale / oldScale);
        panY = mouseY - (mouseY - panY) * (scale / oldScale);
        render();
    }

    function handleMouseDown(event) {
        if (event.button !== 0) return; // 只響應左鍵
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
        if (event.button !== 0) return;
        isPanning = false;
        canvas.style.cursor = 'grab';
    }

    // --- WebGL 核心函式 ---

    /**
     * 初始化 WebGL 資源，包括著色器、緩衝區、紋理和 FBO
     */
    function setupWebGL() {
        if (!gl) { alert('WebGL 不被支援!'); return; }

        // 清理舊的資源
        if (originalTexture) gl.deleteTexture(originalTexture);
        textures.forEach(t => gl.deleteTexture(t));
        framebuffers.forEach(f => gl.deleteFramebuffer(f));
        textures = [];
        framebuffers = [];

        // 編譯和連結著色器程序
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const blurShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);
        const maskShader = createShader(gl, gl.FRAGMENT_SHADER, maskFragmentShaderSource);
        const finalShader = createShader(gl, gl.FRAGMENT_SHADER, finalFragmentShaderSource);

        blurProgram = createProgram(gl, vertexShader, blurShader);
        maskProgram = createProgram(gl, vertexShader, maskShader);
        finalProgram = createProgram(gl, vertexShader, finalShader);

        // 建立並填充頂點位置緩衝區 (一個覆蓋全螢幕的四邊形)
        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        // 建立並填充紋理座標緩衝區
        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

        // 上傳圖片時翻轉Y軸，以匹配 WebGL 的座標系
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        // 建立並上傳原始圖片紋理
        originalTexture = createAndSetupTexture(gl);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        // 建立3個 FBO 和對應的紋理，用於多通道渲染
        // textures[0] -> 水平模糊結果
        // textures[1] -> 垂直模糊結果 (低頻層)
        // textures[2] -> 膚色遮罩
        for (let i = 0; i < 3; i++) {
            const texture = createAndSetupTexture(gl, image.width, image.height);
            textures.push(texture);
            const fbo = gl.createFramebuffer();
            framebuffers.push(fbo);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); // 解除綁定
    }

    /**
     * 主渲染函式，執行整個渲染管線
     */
    function render() {
        if (!image) return;

        const { transformMatrix } = getTransformMatrix();
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; // 單位矩陣，用於離屏渲染

        // 離屏渲染時，視口應與圖片大小一致
        gl.viewport(0, 0, image.width, image.height);

        // Pass 1: 生成膚色遮罩
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[2]);
        gl.useProgram(maskProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(maskProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(maskProgram, 'u_originalImage'), 0);
        gl.uniform1i(gl.getUniformLocation(maskProgram, 'u_toneCount'), selectedSkinTones.length);
        gl.uniform1f(gl.getUniformLocation(maskProgram, 'u_tolerance'), colorTolerance);
        if (selectedSkinTones.length > 0) {
            gl.uniform3fv(gl.getUniformLocation(maskProgram, 'u_skinTones'), selectedSkinTones.flat());
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, originalTexture);
        draw(maskProgram);

        // Pass 2: 水平高斯模糊
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
        gl.useProgram(blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), smoothness);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), image.width, image.height);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0); // 水平方向
        gl.bindTexture(gl.TEXTURE_2D, originalTexture);
        draw(blurProgram);

        // Pass 3: 垂直高斯模糊 (輸入為 Pass 2 的結果)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1]);
        gl.useProgram(blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1); // 垂直方向
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[0]);
        draw(blurProgram);

        // Pass 4: 最終合成並渲染到畫布
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height); // 視口恢復為畫布大小
        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(finalProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, transformMatrix); // 使用帶縮放/平移的矩陣
        const viewModeMap = { 'final': 0, 'high': 2, 'low': 3 };
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), viewModeMap[currentViewMode]);
        gl.uniform1f(gl.getUniformLocation(finalProgram, 'u_detailAmount'), detailAmount);
        
        // 綁定三個輸入紋理
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, originalTexture);
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_originalImage'), 0);
        
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures[1]); // 低頻層
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_blurredImage'), 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, textures[2]); // 膚色遮罩
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_skinMask'), 2);
        
        draw(finalProgram);
    }

    /**
     * 從 FBO 讀取遮罩紋理數據，並將其繪製到 2D 預覽畫布上
     */
    function renderMaskPreview() {
        if (!image) return;

        // 從 FBO 讀取像素
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[2]);
        const pixels = new Uint8Array(image.width * image.height * 4);
        gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 建立一個臨時的 2D canvas 來處理像素數據
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(image.width, image.height);
        
        // 由於 readPixels 和 2D canvas 的座標系差異，需要手動翻轉Y軸
        const data = imageData.data;
        for (let i = 0; i < image.height; i++) {
            for (let j = 0; j < image.width; j++) {
                const srcIndex = (i * image.width + j) * 4;
                const destIndex = ((image.height - 1 - i) * image.width + j) * 4;
                data[destIndex] = pixels[srcIndex];
                data[destIndex + 1] = pixels[srcIndex + 1];
                data[destIndex + 2] = pixels[srcIndex + 2];
                data[destIndex + 3] = 255;
            }
        }
        tempCtx.putImageData(imageData, 0, 0);

        // 將臨時 canvas 的內容繪製到預覽畫布上，並保持長寬比
        maskPreviewCtx.clearRect(0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);
        const hRatio = maskPreviewCanvas.width / image.width;
        const vRatio = maskPreviewCanvas.height / image.height;
        const ratio = Math.min(hRatio, vRatio);
        const centerShift_x = (maskPreviewCanvas.width - image.width * ratio) / 2;
        const centerShift_y = (maskPreviewCanvas.height - image.height * ratio) / 2;
        
        maskPreviewCtx.drawImage(tempCanvas, 0, 0, image.width, image.height,
                               centerShift_x, centerShift_y, image.width * ratio, image.height * ratio);
    }

    /**
     * 計算用於視口縮放和平移的變換矩陣
     */
    function getTransformMatrix() {
        const canvasAspect = canvas.width / canvas.height;
        const imageAspect = image.width / image.height;
        let aspectCorrectionX = 1.0;
        let aspectCorrectionY = 1.0;
        // 根據畫布和圖片的長寬比，計算校正因子以避免圖像變形
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

    /**
     * 將滑鼠在畫布上的點擊座標轉換為圖片的像素座標
     */
    function getPixelCoordinatesFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        const { aspectCorrectionX, aspectCorrectionY } = getTransformMatrix();

        // 1. 滑鼠座標 -> Clip Space (-1 to 1)
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const clipX = (mouseX / rect.width) * 2 - 1;
        const clipY = (mouseY / rect.height) * -2 + 1;

        // 2. Clip Space -> Quad Space (考慮平移和縮放)
        const tx = panX / (canvas.width / 2);
        const ty = -panY / (canvas.height / 2);
        const sx = scale * aspectCorrectionX;
        const sy = scale * aspectCorrectionY;
        const quadX = (clipX - tx) / sx;
        const quadY = (clipY - ty) / sy;

        // 3. Quad Space -> Texture Space (0 to 1)
        const texX = (quadX + 1) / 2;
        const texY = (quadY + 1) / 2;

        // 4. Texture Space -> Pixel Space
        return {
            pixelX: Math.floor(texX * image.width),
            pixelY: Math.floor(texY * image.height)
        };
    }

    /**
     * 創建並設置一個 WebGL 紋理
     */
    function createAndSetupTexture(gl, width, height) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // 設置紋理參數，防止紋理環繞和啟用線性過濾
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // 如果提供了寬高，則為 FBO 創建一個空的紋理
        if (width && height) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        return texture;
    }

    /**
     * 繪製一個覆蓋整個視口的四邊形
     */
    function draw(program) {
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // --- UI 更新函式 ---

    /**
     * 更新顯示選取膚色的色塊 UI
     */
    function updateColorSwatches() {
        colorSwatchesContainer.innerHTML = '';
        selectedSkinTones.forEach(hsv => {
            const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
            const swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.style.backgroundColor = `rgb(${Math.round(rgb[0]*255)}, ${Math.round(rgb[1]*255)}, ${Math.round(rgb[2]*255)})`;
            colorSwatchesContainer.appendChild(swatch);
        });
    }

    // --- 顏色轉換工具函式 ---

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

    // --- 批次處理模組 ---
    const BatchProcessor = {
        queue: [], // 待處理檔案佇列
        currentIndex: 0, // 當前處理索引
        isProcessing: false, // 是否正在處理

        /**
         * 初始化批次處理器，綁定事件
         */
        init() {
            const batchBtn = document.getElementById('batch-btn');
            batchBtn.addEventListener('click', this.handleBatchClick.bind(this));

            // 監聽從主程序返回的事件
            window.electronAPI.onFolderSelected(this.start.bind(this));
            window.electronAPI.onImageSaved((filePath) => {
                this.log(`✅ 已儲存: ${filePath.split('\\').pop()}`);
                this.processNext(); // 處理下一個
            });
            window.electronAPI.onBatchError((errorMessage) => {
                this.log(`❌ 錯誤: ${errorMessage}`);
                this.stop();
            });
        },

        /**
         * 處理 "選擇批次圖片" 按鈕點擊
         */
        handleBatchClick() {
            if (this.isProcessing) return;
            if (selectedSkinTones.length === 0) {
                alert('開始批次處理前，請先選取至少一個膚色樣本。');
                return;
            }
            window.electronAPI.openFolderDialog();
        },

        /**
         * 開始批次處理流程
         */
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

        /**
         * 停止批次處理
         */
        stop() {
            this.isProcessing = false;
            this.updateUI(false);
        },

        /**
         * 處理佇列中的下一個圖片
         */
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
                // 離屏渲染並獲取 base64 數據
                const base64Data = this.renderImageOffscreen(img);
                // 發送到主程序進行儲存
                window.electronAPI.saveBatchImage({ data: base64Data, originalPath: filePath });
                this.currentIndex++;
            };
            img.onerror = () => {
                this.log(`❌ 無法載入圖片: ${fileName}`);
                this.currentIndex++;
                this.processNext(); // 跳過錯誤的圖片
            };
            // 直接從檔案路徑載入圖片
            img.src = "file://" + filePath;
        },

        /**
         * 離屏渲染單張圖片並返回 base64 數據
         */
        renderImageOffscreen(imageObject) {
            // 為本次渲染創建臨時的 WebGL 資源
            const tempOriginalTexture = createAndSetupTexture(gl);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageObject);

            const tempFBOs = [gl.createFramebuffer(), gl.createFramebuffer(), gl.createFramebuffer()];
            const tempTextures = [
                createAndSetupTexture(gl, imageObject.width, imageObject.height),
                createAndSetupTexture(gl, imageObject.width, imageObject.height),
                createAndSetupTexture(gl, imageObject.width, imageObject.height)
            ];
            for (let i = 0; i < 3; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[i]);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempTextures[i], 0);
            }

            gl.viewport(0, 0, imageObject.width, imageObject.height);
            const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
            
            // 執行與主渲染函式相同的渲染管線
            // Pass 1: Mask
            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[2]);
            gl.useProgram(maskProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(maskProgram, 'u_transform'), false, identityMatrix);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            draw(maskProgram);

            // Pass 2: Horizontal Blur
            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]);
            gl.useProgram(blurProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
            gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            draw(blurProgram);

            // Pass 3: Vertical Blur
            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[1]);
            gl.useProgram(blurProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
            gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tempTextures[0]);
            draw(blurProgram);

            // Pass 4: Final Composite
            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]); // 渲染到任意一個臨時FBO
            gl.useProgram(finalProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, identityMatrix);
            gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), 0); // 始終使用最終模式
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tempTextures[1]);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, tempTextures[2]);
            draw(finalProgram);

            // 從 FBO 讀取像素數據
            const pixels = new Uint8Array(imageObject.width * imageObject.height * 4);
            gl.readPixels(0, 0, imageObject.width, imageObject.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            // 清理臨時資源
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            tempFBOs.forEach(fbo => gl.deleteFramebuffer(fbo));
            tempTextures.forEach(texture => gl.deleteTexture(texture));
            gl.deleteTexture(tempOriginalTexture);
            gl.viewport(0, 0, canvas.width, canvas.height); // 恢復視口

            // 將像素數據繪製到 2D canvas 並轉換為 base64
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageObject.width;
            tempCanvas.height = imageObject.height;
            const tempCtx = tempCanvas.getContext('2d');
            const imageData = tempCtx.createImageData(imageObject.width, imageObject.height);
            const data = imageData.data;
            // 翻轉Y軸
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
            return dataUrl.replace(/^data:image\/png;base64,/, ""); // 返回純 base64 數據
        },

        /**
         * 更新批次處理相關的 UI 狀態
         */
        updateUI(isProcessing) {
            const batchProgressContainer = document.getElementById('batch-progress');
            const batchBtn = document.getElementById('batch-btn');
            const startBatchBtn = document.getElementById('start-batch-btn');
            const batchInstructions = document.getElementById('batch-instructions');

            batchProgressContainer.style.display = isProcessing ? 'block' : 'none';
            batchBtn.disabled = isProcessing;
            startBatchBtn.disabled = isProcessing;
            startBatchBtn.style.display = this.queue.length > 0 ? 'block' : 'none';

            if (isProcessing) {
                batchBtn.textContent = '處理中...';
                startBatchBtn.textContent = '處理中...';
            } else {
                batchBtn.textContent = '📂 選擇批次圖片';
                startBatchBtn.textContent = '✨ 開始批次修飾';
                if (this.queue.length === 0) {
                     startBatchBtn.style.display = 'none';
                     batchInstructions.textContent = '選擇多張圖片以開始批次處理。';
                }
            }
        },

        /**
         * 在 UI 上顯示日誌訊息
         */
        log(message) {
            const batchLog = document.getElementById('batch-log');
            if(this.currentIndex === 0) batchLog.textContent = ''; // 新任務開始時清空日誌
            batchLog.textContent += message + '\n';
            batchLog.scrollTop = batchLog.scrollHeight; // 自動滾動到底部
        },

        /**
         * 更新進度條
         */
        updateProgressBar(percentage) {
            const batchProgressBar = document.getElementById('batch-progress-bar');
            batchProgressBar.style.width = `${percentage}%`;
        }
    };

    // 初始化批次處理器
    BatchProcessor.init();
});