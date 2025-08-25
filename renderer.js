import { createShader, createProgram } from './webgl-utils.js';

// --- DOM Elements ---
const canvas = document.getElementById('gl-canvas');
const canvasContainer = document.querySelector('.canvas-container');
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

// --- WebGL & State Variables ---
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
let image = null;
let smoothness = 0.1 + (parseFloat(radiusSlider.value) / 100) * 15;
let detailAmount = parseFloat(detailSlider.value) / 100.0;
let colorTolerance = parseFloat(toleranceSlider.value) / 100.0;
let selectedSkinTones = [];
let currentViewMode = 'final';

// --- Viewport State ---
let scale = 1.0;
let panX = 0.0;
let panY = 0.0;
let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

let originalTexture, blurProgram, maskProgram, finalProgram;
let positionBuffer, texCoordBuffer;
let textures = [], framebuffers = [];

// --- Shaders (GLSL) ---
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
        for (float i = -15.0; i <= 15.0; i += 1.0) {
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
    uniform int u_viewMode; // 0: Final, 1: Mask, 2: High, 3: Low

    void main() {
        if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
            gl_FragColor = vec4(0.1, 0.1, 0.1, 1.0); // Background color
            return;
        }
        vec4 original = texture2D(u_originalImage, v_texCoord);
        vec4 blurred = texture2D(u_blurredImage, v_texCoord);
        float mask = texture2D(u_skinMask, v_texCoord).r;

        if (u_viewMode == 1) { // Skin Mask
            gl_FragColor = vec4(vec3(mask), 1.0);
            return;
        }
        vec3 highPass = original.rgb - blurred.rgb;
        if (u_viewMode == 2) { // High Frequency
            gl_FragColor = vec4(highPass + 0.5, 1.0);
            return;
        }
        if (u_viewMode == 3) { // Low Frequency
            gl_FragColor = blurred;
            return;
        }
        vec3 smoothedSkin = blurred.rgb + highPass * u_detailAmount;
        vec3 finalColor = mix(original.rgb, smoothedSkin, mask);
        gl_FragColor = vec4(finalColor, original.a);
    }
`;

// --- Event Listeners ---
loadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);
radiusSlider.addEventListener('input', handleSliderChange);
detailSlider.addEventListener('input', handleSliderChange);
toleranceSlider.addEventListener('input', handleSliderChange);
clearColorsBtn.addEventListener('click', handleClearColors);
viewModeGroup.addEventListener('change', (event) => {
    currentViewMode = event.target.value;
    render();
});
saveBtn.addEventListener('click', handleSave);
canvas.addEventListener('wheel', handleWheel, { passive: false });
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', handleMouseUp);
canvas.addEventListener('mouseleave', handleMouseUp);
canvas.addEventListener('contextmenu', handleContextMenu);

// --- Main Functions ---
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
    }
    if (image) render();
}

function handleClearColors() {
    selectedSkinTones = [];
    updateColorSwatches();
    if (image) render();
}

function handleContextMenu(event) {
    event.preventDefault();
    if (!image) return;

    // New logic: If 10 tones are already selected, remove the oldest one.
    if (selectedSkinTones.length >= 10) {
        selectedSkinTones.shift(); // Removes the first element from the array
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
}

function handleSave() {
    if (!image) return;

    // --- Full Resolution Save Logic ---

    // 1. Create a temporary FBO to render the full-size image to.
    const finalFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
    const finalTexture = createAndSetupTexture(gl, image.width, image.height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, finalTexture, 0);

    // 2. Temporarily set the viewport to the image's full resolution.
    gl.viewport(0, 0, image.width, image.height);

    // 3. Run the entire rendering pipeline, targeting the FBO.
    // We use an identity matrix for the transform to ignore pan & zoom.
    const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    
    // Pass 1: Skin Mask
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[2]);
    gl.useProgram(maskProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(maskProgram, 'u_transform'), false, identityMatrix);
    // ... (rest of mask uniforms are already set)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, originalTexture);
    draw(maskProgram);

    // Pass 2 & 3: Gaussian Blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]); // H-Blur
    gl.useProgram(blurProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
    gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0);
    gl.bindTexture(gl.TEXTURE_2D, originalTexture);
    draw(blurProgram);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1]); // V-Blur
    gl.useProgram(blurProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
    gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[0]);
    draw(blurProgram);

    // Pass 4: Final Composite to our temporary FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
    gl.useProgram(finalProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, identityMatrix);
    gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), 0); // Force final view
    // ... (rest of final program uniforms are set)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, originalTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[1]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures[2]);
    draw(finalProgram);

    // 4. Read the pixel data from the FBO.
    const pixels = new Uint8Array(image.width * image.height * 4);
    gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // 5. Clean up WebGL resources.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(finalFBO);
    gl.deleteTexture(finalTexture);

    // 6. Restore the viewport to the canvas size for normal display.
    gl.viewport(0, 0, canvas.width, canvas.height);

    // 7. Use a 2D canvas to convert the raw pixel data to a PNG.
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = image.width;
    tempCanvas.height = image.height;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = tempCtx.createImageData(image.width, image.height);
    
    // Flip the image vertically as WebGL's origin is bottom-left.
    const data = imageData.data;
    for (let i = 0; i < image.height; i++) {
        for (let j = 0; j < image.width; j++) {
            const srcIndex = (i * image.width + j) * 4;
            const destIndex = ((image.height - 1 - i) * image.width + j) * 4;
            data[destIndex] = pixels[srcIndex];
            data[destIndex + 1] = pixels[srcIndex + 1];
            data[destIndex + 2] = pixels[srcIndex + 2];
            data[destIndex + 3] = pixels[srcIndex + 3];
        }
    }
    tempCtx.putImageData(imageData, 0, 0);

    // 8. Get the Base64 data and send it to the main process.
    const dataUrl = tempCanvas.toDataURL('image/png');
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    window.electronAPI.saveImage({ data: base64Data });
}

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
    if (event.button !== 0) return;
    isPanning = false;
    canvas.style.cursor = 'grab';
}

function setupWebGL() {
    if (!gl) { alert('WebGL is not supported!'); return; }

    if (originalTexture) gl.deleteTexture(originalTexture);
    textures.forEach(t => gl.deleteTexture(t));
    framebuffers.forEach(f => gl.deleteFramebuffer(f));
    textures = [];
    framebuffers = [];

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const blurShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);
    const maskShader = createShader(gl, gl.FRAGMENT_SHADER, maskFragmentShaderSource);
    const finalShader = createShader(gl, gl.FRAGMENT_SHADER, finalFragmentShaderSource);

    blurProgram = createProgram(gl, vertexShader, blurShader);
    maskProgram = createProgram(gl, vertexShader, maskShader);
    finalProgram = createProgram(gl, vertexShader, finalShader);

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    originalTexture = createAndSetupTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    for (let i = 0; i < 3; i++) { // 0: H-Blur, 1: V-Blur (final blur), 2: Mask
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
    gl.useProgram(blurProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
    gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), smoothness);
    gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), image.width, image.height);
    gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0);
    gl.bindTexture(gl.TEXTURE_2D, originalTexture);
    draw(blurProgram);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1]);
    gl.useProgram(blurProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
    gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[0]);
    draw(blurProgram);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.1, 0.1, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(finalProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, transformMatrix);
    const viewModeMap = { 'final': 0, 'mask': 1, 'high': 2, 'low': 3 };
    gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), viewModeMap[currentViewMode]);
    gl.uniform1f(gl.getUniformLocation(finalProgram, 'u_detailAmount'), detailAmount);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, originalTexture);
    gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_originalImage'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[1]);
    gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_blurredImage'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures[2]);
    gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_skinMask'), 2);
    
    draw(finalProgram);
}

function getTransformMatrix() {
    const canvasAspect = canvas.width / canvas.height;
    const imageAspect = image.width / image.height;
    let aspectCorrectionX = 1.0;
    let aspectCorrectionY = 1.0;
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

    // Get the forward transformation values
    const tx = panX / (canvas.width / 2);
    const ty = -panY / (canvas.height / 2);
    const sx = scale * aspectCorrectionX;
    const sy = scale * aspectCorrectionY;

    // Apply the inverse transformation: pos_quad = (pos_clip - T) / S
    const quadX = (clipX - tx) / sx;
    const quadY = (clipY - ty) / sy;

    // Convert from quad space (-1 to 1) to texture space (0 to 1)
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