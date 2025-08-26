// 從輔助模組中引入 WebGL 著色器和程序創建函式
import { createShader, createProgram } from './webgl-utils.js';

// 當整個 HTML 文件被完全加載和解析後，執行初始化程式碼
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM 已完全加載和解析");

    // --- DOM 元素獲取 ---
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
    const maskPreviewCanvas = document.getElementById('mask-preview-canvas');
    const maskPreviewCtx = maskPreviewCanvas.getContext('2d');

    // --- WebGL 與狀態變數初始化 ---
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    let image = null;
    let smoothness = 0.1 + (parseFloat(radiusSlider.value) / 100) * 15;
    let detailAmount = parseFloat(detailSlider.value) / 100.0;
    let colorTolerance = parseFloat(toleranceSlider.value) / 100.0;
    let maskExpansion = parseFloat(expansionSlider.value) / 200.0; // 轉換為 0.0 - 0.5
    const maskBlurRadius = 5.0;
    let selectedSkinTones = [];
    let currentViewMode = 'final';

    // --- 視口狀態變數 ---
    let scale = 1.0;
    let panX = 0.0;
    let panY = 0.0;
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // --- WebGL 資源變數 ---
    let originalTexture, blurProgram, maskProgram, finalProgram;
    let positionBuffer, texCoordBuffer;
    let textures = [], framebuffers = [];

    // --- GLSL 著色器原始碼 ---
    const vertexShaderSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        uniform mat4 u_transform;
        void main() {
            gl_Position = u_transform * vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `;

    const blurFragmentShaderSource = `
        precision highp float;
        uniform sampler2D u_image;
        uniform vec2 u_resolution;
        uniform float u_radius;
        uniform vec2 u_dir;
        varying vec2 v_texCoord;
        void main() {
            vec2 uv = v_texCoord;
            vec4 color = vec4(0.0);
            float total = 0.0;
            float sigma = u_radius;
            if (sigma < 0.1) {
                gl_FragColor = texture2D(u_image, uv);
                return;
            }
            for (float i = -12.0; i <= 12.0; i += 1.0) {
                float weight = (1.0 / (2.5066 * sigma)) * exp(-0.5 * (i * i) / (sigma * sigma));
                vec2 offset = u_dir * i / u_resolution;
                color += texture2D(u_image, uv + offset) * weight;
                total += weight;
            }
            gl_FragColor = color / total;
        }
    `;

    const maskFragmentShaderSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_originalImage;
        uniform vec3 u_skinTones[10];
        uniform int u_toneCount;
        uniform float u_tolerance;

        vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }

        float hueDiff(float h1, float h2) {
            float d = abs(h1 - h2);
            return min(d, 1.0 - d);
        }

        void main() {
            if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }
            vec3 pixelRGB = texture2D(u_originalImage, v_texCoord).rgb;
            vec3 pixelHSV = rgb2hsv(pixelRGB);
            float mask = 0.0;
            for (int i = 0; i < 10; i++) {
                if (i >= u_toneCount) break;
                vec3 toneHSV = u_skinTones[i];
                float hDiff = hueDiff(pixelHSV.x, toneHSV.x);
                float sDiff = abs(pixelHSV.y - toneHSV.y);
                if (hDiff < u_tolerance && sDiff < u_tolerance * 1.5) {
                    mask = 1.0;
                    break;
                }
            }
            gl_FragColor = vec4(vec3(mask), 1.0);
        }
    `;

    const finalFragmentShaderSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_originalImage;
        uniform sampler2D u_blurredImage;
        uniform sampler2D u_skinMask;
        uniform float u_detailAmount;
        uniform float u_maskExpansion;
        uniform int u_viewMode;

        void main() {
            if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
                gl_FragColor = vec4(0.1, 0.1, 0.1, 1.0);
                return;
            }
            vec4 original = texture2D(u_originalImage, v_texCoord);
            vec4 blurred = texture2D(u_blurredImage, v_texCoord);
            float mask = texture2D(u_skinMask, v_texCoord).r;
            mask = smoothstep(0.5 - u_maskExpansion, 0.5 + u_maskExpansion, mask);
            vec3 highPass = original.rgb - blurred.rgb;

            if (u_viewMode == 2) {
                gl_FragColor = vec4(highPass + 0.5, 1.0);
                return;
            }
            if (u_viewMode == 3) {
                gl_FragColor = blurred;
                return;
            }

            vec3 smoothedSkin = blurred.rgb + highPass * u_detailAmount;
            vec3 finalColor = mix(original.rgb, smoothedSkin, mask);
            gl_FragColor = vec4(finalColor, original.a);
        }
    `;

    // --- 事件監聽器 ---
    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    radiusSlider.addEventListener('input', handleSliderChange);
    detailSlider.addEventListener('input', handleSliderChange);
    toleranceSlider.addEventListener('input', handleSliderChange);
    expansionSlider.addEventListener('input', handleSliderChange);
    clearColorsBtn.addEventListener('click', handleClearColors);
    saveBtn.addEventListener('click', handleSave);
    viewModeGroup.addEventListener('change', (event) => {
        currentViewMode = event.target.value;
        render();
    });
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);

    // --- 主要功能函式 ---
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                image = img;
                selectedSkinTones = [];
                updateColorSwatches();
                scale = 1.0;
                panX = 0.0;
                panY = 0.0;
                canvas.width = canvasContainer.clientWidth;
                canvas.height = canvasContainer.clientHeight;
                gl.viewport(0, 0, canvas.width, canvas.height);
                setupWebGL();
                render();
                renderMaskPreview();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

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
        } else if (event.target === expansionSlider) {
            maskExpansion = parseFloat(event.target.value) / 200.0;
            expansionValueSpan.textContent = event.target.value;
        }
        if (image) {
            render();
            if (event.target === toleranceSlider || event.target === expansionSlider) {
                renderMaskPreview();
            }
        }
    }

    function handleClearColors() {
        selectedSkinTones = [];
        updateColorSwatches();
        if (image) {
            render();
            renderMaskPreview();
        }
    }

    function handleContextMenu(event) {
        event.preventDefault();
        if (!image) return;
        if (selectedSkinTones.length >= 10) {
            selectedSkinTones.shift();
        }
        const { pixelX, pixelY } = getPixelCoordinatesFromEvent(event);
        if (pixelX < 0 || pixelX >= image.width || pixelY < 0 || pixelY >= image.height) return;

        const tempFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, originalTexture, 0);
        const pixelData = new Uint8Array(4);
        gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(tempFBO);

        const rgb = [pixelData[0] / 255, pixelData[1] / 255, pixelData[2] / 255];
        const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
        selectedSkinTones.push(hsv);
        updateColorSwatches();
        render();
        renderMaskPreview();
    }

    function handleSave() {
        if (!image) return;
        const base64Data = BatchProcessor.renderImageOffscreen(image);
        window.electronAPI.saveImage({ data: base64Data });
    }

    // --- 視口控制 ---
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
        scale = Math.max(0.02, Math.min(scale, 50));
        panX = mouseX - (mouseX - panX) * (scale / oldScale);
        panY = mouseY - (mouseY - panY) * (scale / oldScale);
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

    // --- WebGL 核心 ---
    function setupWebGL() {
        if (!gl) { alert('WebGL 不被支援!'); return; }
        if (originalTexture) gl.deleteTexture(originalTexture);
        textures.forEach(t => gl.deleteTexture(t));
        framebuffers.forEach(f => gl.deleteFramebuffer(f));
        textures = [];
        framebuffers = [];

        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        blurProgram = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource));
        maskProgram = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, maskFragmentShaderSource));
        finalProgram = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, finalFragmentShaderSource));

        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        originalTexture = createAndSetupTexture(gl);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        for (let i = 0; i < 4; i++) {
            const texture = createAndSetupTexture(gl, image.width, image.height);
            textures.push(texture);
            const fbo = gl.createFramebuffer();
            framebuffers.push(fbo);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function render() {
        if (!image) return;
        const { transformMatrix } = getTransformMatrix();
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
        gl.viewport(0, 0, image.width, image.height);

        // Pass 1: 生成硬邊遮罩 -> fbo[3]
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[3]);
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

        // Pass 2 & 3: 生成低頻層 -> fbo[1]
        applyBlur(originalTexture, framebuffers[0], framebuffers[1], smoothness, image.width, image.height);
        
        // Pass 4 & 5: 模糊遮罩 -> fbo[3]
        applyBlur(textures[3], framebuffers[2], framebuffers[3], maskBlurRadius, image.width, image.height);

        // Pass 6: 最終合成
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(finalProgram);
        const viewModeMap = { 'final': 0, 'high': 2, 'low': 3 };
        gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, transformMatrix);
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), viewModeMap[currentViewMode]);
        gl.uniform1f(gl.getUniformLocation(finalProgram, 'u_detailAmount'), detailAmount);
        gl.uniform1f(gl.getUniformLocation(finalProgram, 'u_maskExpansion'), maskExpansion);
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_originalImage'), 0);
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_blurredImage'), 1);
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_skinMask'), 2);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, originalTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures[1]);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, textures[3]);
        draw(finalProgram);
    }
    
    function applyBlur(inputTexture, intermediateFBO, outputFBO, radius, width, height) {
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
        gl.useProgram(blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), radius);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), width, height);

        // Horizontal
        gl.bindFramebuffer(gl.FRAMEBUFFER, intermediateFBO);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        draw(blurProgram);

        // Vertical
        gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1);
        gl.bindTexture(gl.TEXTURE_2D, textures[framebuffers.indexOf(intermediateFBO)]);
        draw(blurProgram);
    }

    function renderMaskPreview() {
        if (!image) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[3]);
        const pixels = new Uint8Array(image.width * image.height * 4);
        gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(image.width, image.height);
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

        maskPreviewCtx.clearRect(0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);
        const hRatio = maskPreviewCanvas.width / image.width;
        const vRatio = maskPreviewCanvas.height / image.height;
        const ratio = Math.min(hRatio, vRatio);
        const centerShift_x = (maskPreviewCanvas.width - image.width * ratio) / 2;
        const centerShift_y = (maskPreviewCanvas.height - image.height * ratio) / 2;
        maskPreviewCtx.drawImage(tempCanvas, 0, 0, image.width, image.height, centerShift_x, centerShift_y, image.width * ratio, image.height * ratio);
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

    function createAndSetupTexture(gl, width, height) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (width && height) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        return texture;
    }

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
        },
        handleBatchClick() {
            if (this.isProcessing) return;
            if (selectedSkinTones.length === 0) {
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
            const tempOriginalTexture = createAndSetupTexture(gl);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageObject);

            const tempFBOs = [gl.createFramebuffer(), gl.createFramebuffer(), gl.createFramebuffer(), gl.createFramebuffer()];
            const tempTextures = [
                createAndSetupTexture(gl, imageObject.width, imageObject.height),
                createAndSetupTexture(gl, imageObject.width, imageObject.height),
                createAndSetupTexture(gl, imageObject.width, imageObject.height),
                createAndSetupTexture(gl, imageObject.width, imageObject.height)
            ];
            for (let i = 0; i < 4; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[i]);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempTextures[i], 0);
            }

            gl.viewport(0, 0, imageObject.width, imageObject.height);
            const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
            
            const tempPositionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, tempPositionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
            const tempTexCoordBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, tempTexCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

            const tempDraw = (program) => {
                const posLoc = gl.getAttribLocation(program, 'a_position');
                const texLoc = gl.getAttribLocation(program, 'a_texCoord');
                gl.enableVertexAttribArray(posLoc);
                gl.bindBuffer(gl.ARRAY_BUFFER, tempPositionBuffer);
                gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(texLoc);
                gl.bindBuffer(gl.ARRAY_BUFFER, tempTexCoordBuffer);
                gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            };

            // --- Full Render Pipeline ---
            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[3]);
            gl.useProgram(maskProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(maskProgram, 'u_transform'), false, identityMatrix);
            gl.uniform1i(gl.getUniformLocation(maskProgram, 'u_originalImage'), 0);
            gl.uniform1i(gl.getUniformLocation(maskProgram, 'u_toneCount'), selectedSkinTones.length);
            gl.uniform1f(gl.getUniformLocation(maskProgram, 'u_tolerance'), colorTolerance);
            if (selectedSkinTones.length > 0) {
                gl.uniform3fv(gl.getUniformLocation(maskProgram, 'u_skinTones'), selectedSkinTones.flat());
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            tempDraw(maskProgram);

            const tempApplyBlur = (inputTex, interFBO, outFBO, radius) => {
                gl.useProgram(blurProgram);
                gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
                gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), radius);
                gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), imageObject.width, imageObject.height);
                gl.bindFramebuffer(gl.FRAMEBUFFER, interFBO);
                gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, inputTex);
                tempDraw(blurProgram);
                gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO);
                gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1);
                gl.bindTexture(gl.TEXTURE_2D, tempTextures[tempFBOs.indexOf(interFBO)]);
                tempDraw(blurProgram);
            };

            tempApplyBlur(tempOriginalTexture, tempFBOs[0], tempFBOs[1], smoothness);
            tempApplyBlur(tempTextures[3], tempFBOs[2], tempFBOs[3], maskBlurRadius);

            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]);
            gl.useProgram(finalProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, identityMatrix);
            gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), 0);
            gl.uniform1f(gl.getUniformLocation(finalProgram, 'u_detailAmount'), detailAmount);
            gl.uniform1f(gl.getUniformLocation(finalProgram, 'u_maskExpansion'), maskExpansion);
            gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_originalImage'), 0);
            gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_blurredImage'), 1);
            gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_skinMask'), 2);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tempTextures[1]);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, tempTextures[3]);
            tempDraw(finalProgram);

            const pixels = new Uint8Array(imageObject.width * imageObject.height * 4);
            gl.readPixels(0, 0, imageObject.width, imageObject.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            tempFBOs.forEach(fbo => gl.deleteFramebuffer(fbo));
            tempTextures.forEach(texture => gl.deleteTexture(texture));
            gl.deleteTexture(tempOriginalTexture);
            gl.deleteBuffer(tempPositionBuffer);
            gl.deleteBuffer(tempTexCoordBuffer);
            gl.viewport(0, 0, canvas.width, canvas.height);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageObject.width;
            tempCanvas.height = imageObject.height;
            const tempCtx = tempCanvas.getContext('2d');
            const imageData = tempCtx.createImageData(imageObject.width, imageObject.height);
            const data = imageData.data;
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