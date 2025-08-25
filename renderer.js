// --- Batch Processor Module (MCP Context7: State Isolation) ---

const BatchProcessor = {
    queue: [],
    currentIndex: 0,
    isProcessing: false,

    init() {
        const batchBtn = document.getElementById('batch-btn');
        batchBtn.addEventListener('click', this.handleBatchClick.bind(this));

        window.electronAPI.onFolderSelected(this.start.bind(this));
        window.electronAPI.onImageSaved((filePath) => {
            this.log(`✅ Saved: ${filePath.split('\').pop()}`);
            this.processNext();
        });
        window.electronAPI.onBatchError((errorMessage) => {
            this.log(`❌ Error: ${errorMessage}`);
            this.stop();
        });
    },

    handleBatchClick() {
        if (this.isProcessing) return;
        if (selectedSkinTones.length === 0) {
            alert('Please select at least one skin tone before starting a batch process.');
            return;
        }
        window.electronAPI.openFolderDialog();
    },

    start(files) {
        if (!files || files.length === 0) {
            alert('No image files found in the selected folder.');
            return;
        }
        this.queue = files;
        this.currentIndex = 0;
        this.isProcessing = true;
        this.updateUI(true);
        this.log(`Starting batch process for ${files.length} images...\n`);
        this.processNext();
    },

    stop() {
        this.isProcessing = false;
        this.updateUI(false);
    },

    processNext() {
        if (this.currentIndex >= this.queue.length) {
            this.log('\n🎉 Batch processing complete!');
            this.stop();
            this.updateProgressBar(100);
            return;
        }

        const filePath = this.queue[this.currentIndex];
        const fileName = filePath.split('\').pop();
        this.log(`Processing ${fileName} (${this.currentIndex + 1}/${this.queue.length})...`);
        this.updateProgressBar((this.currentIndex / this.queue.length) * 100);

        const img = new Image();
        img.onload = () => {
            const base64Data = this.renderImageOffscreen(img);
            window.electronAPI.saveBatchImage({ data: base64Data, originalPath: filePath });
            this.currentIndex++;
        };
        img.onerror = () => {
            this.log(`❌ Failed to load image: ${fileName}`);
            this.currentIndex++;
            this.processNext();
        };
        img.src = "file://" + filePath;
    },

    renderImageOffscreen(imageObject) {
        // This function is stateless and side-effect free.
        // It creates and destroys all its WebGL resources.
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
        
        // Pass 1: Skin Mask
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[2]);
        gl.useProgram(maskProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(maskProgram, 'u_transform'), false, identityMatrix);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        draw(maskProgram);

        // Pass 2 & 3: Gaussian Blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]);
        gl.useProgram(blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 1, 0);
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        draw(blurProgram);

        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[1]);
        gl.useProgram(blurProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(blurProgram, 'u_transform'), false, identityMatrix);
        gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_dir'), 0, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[0]);
        draw(blurProgram);

        // Pass 4: Final Composite
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBOs[0]); // Reuse FBO 0 for final output
        gl.useProgram(finalProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(finalProgram, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(finalProgram, 'u_viewMode'), 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempOriginalTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[1]);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, tempTextures[2]);
        draw(finalProgram);

        const pixels = new Uint8Array(imageObject.width * imageObject.height * 4);
        gl.readPixels(0, 0, imageObject.width, imageObject.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Cleanup
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        tempFBOs.forEach(fbo => gl.deleteFramebuffer(fbo));
        tempTextures.forEach(texture => gl.deleteTexture(texture));
        gl.deleteTexture(tempOriginalTexture);
        gl.viewport(0, 0, canvas.width, canvas.height);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageObject.width;
        tempCanvas.height = imageObject.height;
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(imageObject.width, imageObject.height);
        const data = imageData.data;
        for (let i = 0; i < imageObject.height; i++) {
            for (let j = 0; j < imageObject.height; j++) {
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
        batchProgressContainer.style.display = isProcessing ? 'block' : 'none';
        batchBtn.disabled = isProcessing;
        batchBtn.textContent = isProcessing ? 'Processing...' : '📦 Batch Process';
    },

    log(message) {
        const batchLog = document.getElementById('batch-log');
        batchLog.textContent += message + '\n';
        batchLog.scrollTop = batchLog.scrollHeight;
    },

    updateProgressBar(percentage) {
        const batchProgressBar = document.getElementById('batch-progress-bar');
        batchProgressBar.style.width = `${percentage}%`;
    }
};

BatchProcessor.init();
