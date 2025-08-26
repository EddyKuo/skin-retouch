import { createShader, createProgram } from './webgl-utils.js';
import {
    VERTEX_SHADER_SOURCE,
    BLUR_FRAGMENT_SHADER_SOURCE,
    MASK_FRAGMENT_SHADER_SOURCE,
    FINAL_FRAGMENT_SHADER_SOURCE
} from './shaders.js';

/**
 * webgl-renderer.js
 * 包含所有核心 WebGL 渲染邏輯
 */
export class WebGLRenderer {
    constructor(canvas) {
        this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!this.gl) {
            alert('WebGL 不被支援!');
            throw new Error('WebGL not supported');
        }
        this.canvas = canvas;
        this.programs = {};
        this.buffers = {};
        this.textures = [];
        this.framebuffers = [];
    }

    setup(image) {
        const gl = this.gl;

        // 清理舊資源
        if (this.textures.original) gl.deleteTexture(this.textures.original);
        if (this.textures.fbo) this.textures.fbo.forEach(t => gl.deleteTexture(t));
        if (this.framebuffers.fbo) this.framebuffers.fbo.forEach(f => gl.deleteFramebuffer(f));
        
        this.textures = { fbo: [] };
        this.framebuffers = { fbo: [] };

        // 編譯著色器程序
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
        this.programs.blur = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, BLUR_FRAGMENT_SHADER_SOURCE));
        this.programs.mask = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, MASK_FRAGMENT_SHADER_SOURCE));
        this.programs.final = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, FINAL_FRAGMENT_SHADER_SOURCE));

        // 創建緩衝區
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        this.buffers.texCoord = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        // 創建原始圖片紋理
        this.textures.original = this._createAndSetupTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        // 創建 FBOs
        for (let i = 0; i < 4; i++) {
            const texture = this._createAndSetupTexture(image.width, image.height);
            this.textures.fbo.push(texture);
            const fbo = gl.createFramebuffer();
            this.framebuffers.fbo.push(fbo);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    render(appState) {
        const gl = this.gl;
        const { image, smoothness, detailAmount, colorTolerance, maskBlurRadius, maskExpansion, selectedSkinTones, currentViewMode } = appState;
        if (!image) return;

        const { transformMatrix } = this._getTransformMatrix(appState);
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

        gl.viewport(0, 0, image.width, image.height);

        // Pass 1: 生成硬邊遮罩 -> fbo[3]
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.fbo[3]);
        gl.useProgram(this.programs.mask);
        // --- BUG FIX: Manually set uniforms for the mask program to ensure the array is passed correctly ---
        gl.uniformMatrix4fv(gl.getUniformLocation(this.programs.mask, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(this.programs.mask, 'u_originalImage'), 0);
        gl.uniform1i(gl.getUniformLocation(this.programs.mask, 'u_toneCount'), selectedSkinTones.length);
        gl.uniform1f(gl.getUniformLocation(this.programs.mask, 'u_tolerance'), colorTolerance);
        if (selectedSkinTones.length > 0) {
            gl.uniform3fv(gl.getUniformLocation(this.programs.mask, 'u_skinTones'), selectedSkinTones.flat());
        }
        // --- End of BUG FIX ---
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.original);
        this._draw(this.programs.mask);

        // Pass 2 & 3: 生成低頻層 -> fbo[1]
        this._applyBlur(this.textures.original, this.framebuffers.fbo[0], this.framebuffers.fbo[1], smoothness, image.width, image.height);
        
        // Pass 4 & 5: 模糊遮罩 -> fbo[3]
        this._applyBlur(this.textures.fbo[3], this.framebuffers.fbo[2], this.framebuffers.fbo[3], maskBlurRadius, image.width, image.height);

        // Pass 6: 最終合成到畫布
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(this.programs.final);
        const viewModeMap = { 'final': 0, 'high': 2, 'low': 3 };
        this._setUniforms(this.programs.final, { u_transform: transformMatrix, u_viewMode: viewModeMap[currentViewMode], u_detailAmount: detailAmount, u_maskExpansion: maskExpansion, u_originalImage: 0, u_blurredImage: 1, u_skinMask: 2 });
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.original);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.fbo[1]); // 低頻層
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.fbo[3]); // 模糊遮罩
        
        this._draw(this.programs.final);
    }

    renderMaskPreview(appState) {
        const { image } = appState;
        if (!image) return;
        const { maskPreviewCanvas, maskPreviewCtx } = appState.dom;

        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.fbo[3]);
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
        
        maskPreviewCtx.drawImage(tempCanvas, 0, 0, image.width, image.height,
                               centerShift_x, centerShift_y, image.width * ratio, image.height * ratio);
    }

    getPixelCoordinatesFromEvent(event, appState) {
        const rect = this.canvas.getBoundingClientRect();
        const { aspectCorrectionX, aspectCorrectionY } = this._getTransformMatrix(appState);

        const clipX = (event.clientX - rect.left) / rect.width * 2 - 1;
        const clipY = (event.clientY - rect.top) / rect.height * -2 + 1;

        const tx = appState.panX / (this.canvas.width / 2);
        const ty = -appState.panY / (this.canvas.height / 2);
        const sx = appState.scale * aspectCorrectionX;
        const sy = appState.scale * aspectCorrectionY;
        const quadX = (clipX - tx) / sx;
        const quadY = (clipY - ty) / sy;

        const texX = (quadX + 1) / 2;
        const texY = (quadY + 1) / 2;

        return {
            pixelX: Math.floor(texX * appState.image.width),
            pixelY: Math.floor(texY * appState.image.height)
        };
    }

    // --- Private Helper Methods ---

    _applyBlur(inputTexture, intermediateFBO, outputFBO, radius, width, height) {
        const gl = this.gl;
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
        gl.useProgram(this.programs.blur);
        this._setUniforms(this.programs.blur, { u_transform: identityMatrix, u_radius: radius, u_resolution: [width, height] });

        // Horizontal blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, intermediateFBO);
        gl.uniform2f(gl.getUniformLocation(this.programs.blur, 'u_dir'), 1, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        this._draw(this.programs.blur);

        // Vertical blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
        gl.uniform2f(gl.getUniformLocation(this.programs.blur, 'u_dir'), 0, 1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.fbo[this.framebuffers.fbo.indexOf(intermediateFBO)]);
        this._draw(this.programs.blur);
    }

    _createAndSetupTexture(width, height) {
        const gl = this.gl;
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

    _draw(program) {
        const gl = this.gl;
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    _getTransformMatrix(appState) {
        const { image, scale, panX, panY } = appState;
        const canvasAspect = this.canvas.width / this.canvas.height;
        const imageAspect = image.width / image.height;
        let aspectCorrectionX = 1.0, aspectCorrectionY = 1.0;
        if (canvasAspect > imageAspect) {
            aspectCorrectionX = imageAspect / canvasAspect;
        } else {
            aspectCorrectionY = canvasAspect / imageAspect;
        }
        const sx = scale * aspectCorrectionX;
        const sy = scale * aspectCorrectionY;
        const tx = panX / (this.canvas.width / 2);
        const ty = -panY / (this.canvas.height / 2);
        const transformMatrix = [ sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1 ];
        return { transformMatrix, aspectCorrectionX, aspectCorrectionY };
    }

    _setUniforms(program, uniforms) {
        const gl = this.gl;
        for (const name in uniforms) {
            const location = gl.getUniformLocation(program, name);
            const value = uniforms[name];
            if (location === null) continue;
            if (Array.isArray(value)) {
                if (value.length === 2) gl.uniform2fv(location, value);
                else if (value.length === 3) gl.uniform3fv(location, value);
                else if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) gl.uniform1i(location, value);
                else gl.uniform1f(location, value);
            }
        }
    }
}
