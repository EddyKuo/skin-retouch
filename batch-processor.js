import { createShader, createProgram } from './webgl-utils.js';
import {
    VERTEX_SHADER_SOURCE,
    BLUR_FRAGMENT_SHADER_SOURCE,
    MASK_FRAGMENT_SHADER_SOURCE,
    FINAL_FRAGMENT_SHADER_SOURCE
} from './shaders.js';

/**
 * BatchProcessor.js
 * 處理所有批次處理相關的邏輯
 */
export class BatchProcessor {
    constructor(appState, gl) {
        this.appState = appState;
        this.gl = gl;
        this.queue = [];
        this.currentIndex = 0;
        this.isProcessing = false;

        // 批次處理也需要自己的 WebGL 程序
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
        this.blurShader = createShader(gl, gl.FRAGMENT_SHADER, BLUR_FRAGMENT_SHADER_SOURCE);
        this.maskShader = createShader(gl, gl.FRAGMENT_SHADER, MASK_FRAGMENT_SHADER_SOURCE);
        this.finalShader = createShader(gl, gl.FRAGMENT_SHADER, FINAL_FRAGMENT_SHADER_SOURCE);

        this.blurProgram = createProgram(gl, this.vertexShader, this.blurShader);
        this.maskProgram = createProgram(gl, this.vertexShader, this.maskShader);
        this.finalProgram = createProgram(gl, this.vertexShader, this.finalShader);
    }

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
    }

    handleBatchClick() {
        if (this.isProcessing) return;
        if (this.appState.selectedSkinTones.length === 0) {
            alert('開始批次處理前，請先選取至少一個膚色樣本。');
            return;
        }
        window.electronAPI.openFolderDialog();
    }

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
    }

    stop() {
        this.isProcessing = false;
        this.updateUI(false);
    }

    processNext() {
        if (this.currentIndex >= this.queue.length) {
            this.log('\n🎉 批次處理完成!');
            this.stop();
            this.updateProgressBar(100);
            return;
        }

        const filePath = this.queue[this.currentIndex];
        const fileName = filePath.split('\\').pop();
        this.log(`正在處理 ${fileName} (${this.currentIndex + 1}/${this.queue.length})...
`);
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
    }

    renderImageOffscreen(imageObject) {
        const gl = this.gl;
        const { smoothness, detailAmount, colorTolerance, maskBlurRadius, selectedSkinTones } = this.appState;

        const createAndSetupTexture = (width, height) => {
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
        };

        const tempOriginalTexture = createAndSetupTexture();
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageObject);

        const tempFBOs = [gl.createFramebuffer(), gl.createFramebuffer(), gl.createFramebuffer(), gl.createFramebuffer()];
        const tempTextures = [
            createAndSetupTexture(imageObject.width, imageObject.height),
            createAndSetupTexture(imageObject.width, imageObject.height),
            createAndSetupTexture(imageObject.width, imageObject.height),
            createAndSetupTexture(imageObject.width, imageObject.height)
        ];
        for (let i = 0; i < 4; i++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempTextures[i], 0);
        }

        gl.viewport(0, 0, imageObject.width, imageObject.height);
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

        const draw = (program) => {
            const positionLocation = gl.getAttribLocation(program, 'a_position');
            const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
            gl.enableVertexAttribArray(positionLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(texCoordLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        };

        // --- 執行渲染管線 ---
        // Pass 1: Mask (Hard-edge) -> tempTextures[3]
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[3]);
        gl.useProgram(this.maskProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.maskProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(this.maskProgram, 'u_originalImage'), 0);
        gl.uniform1i(gl.getUniformLocation(this.maskProgram, 'u_toneCount'), selectedSkinTones.length);
        gl.uniform1f(gl.getUniformLocation(this.maskProgram, 'u_tolerance'), colorTolerance);
        if (selectedSkinTones.length > 0) {
            gl.uniform3fv(gl.getUniformLocation(this.maskProgram, 'u_skinTones'), selectedSkinTones.flat());
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        draw(this.maskProgram);

        // Pass 2: Horizontal Blur (Low-pass) -> tempTextures[0]
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]);
        gl.useProgram(this.blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1f(gl.getUniformLocation(this.blurProgram, 'u_radius'), smoothness);
        gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_resolution'), imageObject.width, imageObject.height);
        gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_dir'), 1, 0);
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        draw(this.blurProgram);

        // Pass 3: Vertical Blur (Low-pass) -> tempTextures[1]
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[1]);
        gl.useProgram(this.blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_dir'), 0, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[0]);
        draw(this.blurProgram);

        // Pass 4: Horizontal Blur Mask -> tempTextures[2]
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[2]);
        gl.useProgram(this.blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1f(gl.getUniformLocation(this.blurProgram, 'u_radius'), maskBlurRadius);
        gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_dir'), 1, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[3]);
        draw(this.blurProgram);

        // Pass 5: Vertical Blur Mask -> tempTextures[3] (re-use)
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[3]);
        gl.useProgram(this.blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_dir'), 0, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[2]);
        draw(this.blurProgram);

        // Pass 6: Final Composite -> tempFBOs[0] (re-use)
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]);
        gl.useProgram(this.finalProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.finalProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_viewMode'), 0);
        gl.uniform1f(gl.getUniformLocation(this.finalProgram, 'u_detailAmount'), detailAmount);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_originalImage'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[1]);
        gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_blurredImage'), 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[3]);
        gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_skinMask'), 2);
        draw(this.finalProgram);

        const pixels = new Uint8Array(imageObject.width * imageObject.height * 4);
        gl.readPixels(0, 0, imageObject.width, imageObject.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        tempFBOs.forEach(fbo => gl.deleteFramebuffer(fbo));
        tempTextures.forEach(texture => gl.deleteTexture(texture));
        gl.deleteTexture(tempOriginalTexture);
        gl.deleteBuffer(positionBuffer);
        gl.deleteBuffer(texCoordBuffer);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

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
    }

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
    }

    log(message) {
        const batchLog = document.getElementById('batch-log');
        if(this.currentIndex === 0) batchLog.textContent = '';
        batchLog.textContent += message + '\n';
        batchLog.scrollTop = batchLog.scrollHeight;
    }

    updateProgressBar(percentage) {
        const batchProgressBar = document.getElementById('batch-progress-bar');
        batchProgressBar.style.width = `${percentage}%`;
    }
}
