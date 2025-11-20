import { createShader, createProgram } from './webgl-utils.js';
import * as Shaders from './shaders.js';

export class SkinRetouchEngine {
    constructor(gl) {
        this.gl = gl;
        this.programs = {};
        this.buffers = {};
        this.textures = [];
        this.framebuffers = [];
        this.width = 0;
        this.height = 0;
        this.originalTexture = null;

        this.init();
    }

    init() {
        const gl = this.gl;

        // Compile Shaders
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, Shaders.vertexShaderSource);
        this.programs.blur = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, Shaders.blurFragmentShaderSource));
        this.programs.mask = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, Shaders.maskFragmentShaderSource));
        this.programs.final = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, Shaders.finalFragmentShaderSource));
        this.programs.preview = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, Shaders.previewFragmentShaderSource));

        // Create Buffers
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        this.buffers.texCoord = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        // Initialize original texture holder
        this.originalTexture = this.createTexture();
    }

    createTexture(width, height) {
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

    resize(width, height) {
        if (this.width === width && this.height === height) return;

        const gl = this.gl;
        this.width = width;
        this.height = height;

        // Ensure we have enough FBOs/Textures (need 5)
        while (this.textures.length < 5) {
            const tex = this.createTexture(width, height);
            this.textures.push(tex);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            this.framebuffers.push(fbo);
        }

        // Resize existing textures
        for (let i = 0; i < 5; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setImage(image) {
        const gl = this.gl;
        this.resize(image.width, image.height);

        gl.bindTexture(gl.TEXTURE_2D, this.originalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }

    renderToScreen(params) {
        const gl = this.gl;
        this.renderPasses(params); // Do the processing passes

        // Final Pass to Screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // Viewport matches canvas size (which might be different from image size due to zoom)
        // But wait, renderPasses sets viewport to image size.
        // We need to set it to canvas size here.
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.runFinalPass(params.transformMatrix || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], params);
    }

    drawMaskPreview(x, y, width, height) {
        const gl = this.gl;
        if (x + width <= 0 || x >= gl.canvas.width || y + height <= 0 || y >= gl.canvas.height) {
            return;
        }

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(x, y, width, height);
        gl.viewport(x, y, width, height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.programs.preview);
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
        gl.uniformMatrix4fv(gl.getUniformLocation(this.programs.preview, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(this.programs.preview, 'u_texture'), 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[4]); // Use Hard Mask (FBO[4])
        this.draw(this.programs.preview);

        gl.disable(gl.SCISSOR_TEST);
    }

    getPixelColor(x, y) {
        const gl = this.gl;
        const tempFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.originalTexture, 0);

        const pixelData = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(tempFBO);

        return [pixelData[0] / 255, pixelData[1] / 255, pixelData[2] / 255];
    }

    renderToTexture(params) {
        this.renderPasses(params);

        const gl = this.gl;
        // Reuse FBO[0] as final output.
        // Note: FBO[0] was used as Intermediate Blur 1 in renderPasses.
        // But after renderPasses is done, we don't need Intermediate Blur 1 anymore.
        // We DO need textures[1] (Low Freq) and textures[3] (Mask).
        // So FBO[0] is free to be overwritten.

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
        gl.viewport(0, 0, this.width, this.height);

        // Use a flip-Y matrix for the final pass.
        // This flips the geometry upside down.
        // Since we draw into an FBO, and gl.readPixels reads from bottom-up,
        // drawing "upside down" means the bottom row of the result will contain
        // the top row of the image.
        // Thus, readPixels will return data in Top-Down order (compatible with Canvas/PNG),
        // avoiding the need for a CPU-side flip loop.
        const flipYMatrix = [1,0,0,0, 0,-1,0,0, 0,0,1,0, 0,0,0,1];
        this.runFinalPass(flipYMatrix, params);

        return this.textures[0];
    }

    // Helper to get data from the last rendered texture (assumes renderToTexture was called)
    getPixelData() {
        const gl = this.gl;
        // Assuming FBO[0] holds the result
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
        const pixels = new Uint8Array(this.width * this.height * 4);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return pixels;
    }

    renderPasses(params) {
        const gl = this.gl;
        const {
            smoothness,
            colorTolerance,
            maskBlurRadius,
            selectedSkinTones
        } = params;

        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

        // Pass 1: Hard Mask -> FBO[4]
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[4]);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.programs.mask);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.programs.mask, 'u_transform'), false, identityMatrix);
        gl.uniform1i(gl.getUniformLocation(this.programs.mask, 'u_originalImage'), 0);
        gl.uniform1i(gl.getUniformLocation(this.programs.mask, 'u_toneCount'), selectedSkinTones.length);
        gl.uniform1f(gl.getUniformLocation(this.programs.mask, 'u_tolerance'), colorTolerance);
        if (selectedSkinTones.length > 0) {
            gl.uniform3fv(gl.getUniformLocation(this.programs.mask, 'u_skinTones'), selectedSkinTones.flat());
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.originalTexture);
        this.draw(this.programs.mask);

        // Pass 2 & 3: Low Frequency -> FBO[1]
        this.applyBlur(this.originalTexture, this.framebuffers[0], this.framebuffers[1], smoothness);

        // Pass 4 & 5: Blurred Mask -> FBO[3]
        this.applyBlur(this.textures[4], this.framebuffers[2], this.framebuffers[3], maskBlurRadius);
    }

    runFinalPass(transformMatrix, params) {
        const gl = this.gl;
        const {
            detailAmount,
            maskExpansion,
            viewMode
        } = params;

        gl.useProgram(this.programs.final);

        // Map viewMode string to int
        const viewModeMap = { 'final': 0, 'high': 2, 'low': 3 };
        const mode = viewModeMap[viewMode] !== undefined ? viewModeMap[viewMode] : 0;

        gl.uniformMatrix4fv(gl.getUniformLocation(this.programs.final, 'u_transform'), false, transformMatrix);
        gl.uniform1i(gl.getUniformLocation(this.programs.final, 'u_viewMode'), mode);
        gl.uniform1f(gl.getUniformLocation(this.programs.final, 'u_detailAmount'), detailAmount);
        gl.uniform1f(gl.getUniformLocation(this.programs.final, 'u_maskExpansion'), maskExpansion);

        gl.uniform1i(gl.getUniformLocation(this.programs.final, 'u_originalImage'), 0);
        gl.uniform1i(gl.getUniformLocation(this.programs.final, 'u_blurredImage'), 1);
        gl.uniform1i(gl.getUniformLocation(this.programs.final, 'u_skinMask'), 2);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.originalTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[1]); // Low Freq
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[3]); // Mask

        this.draw(this.programs.final);
    }

    applyBlur(inputTexture, intermediateFBO, outputFBO, radius) {
        const gl = this.gl;
        const identityMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

        gl.useProgram(this.programs.blur);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.programs.blur, 'u_transform'), false, identityMatrix);
        gl.uniform1f(gl.getUniformLocation(this.programs.blur, 'u_radius'), radius);
        gl.uniform2f(gl.getUniformLocation(this.programs.blur, 'u_resolution'), this.width, this.height);

        // Horizontal
        gl.bindFramebuffer(gl.FRAMEBUFFER, intermediateFBO);
        gl.viewport(0, 0, this.width, this.height);
        gl.uniform2f(gl.getUniformLocation(this.programs.blur, 'u_dir'), 1, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        this.draw(this.programs.blur);

        // Vertical
        gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
        gl.viewport(0, 0, this.width, this.height);
        gl.uniform2f(gl.getUniformLocation(this.programs.blur, 'u_dir'), 0, 1);
        // The input for the second pass is the texture attached to intermediateFBO
        let textureIndex = this.framebuffers.indexOf(intermediateFBO);
        if (textureIndex === -1) {
             console.error("Unknown FBO passed to applyBlur");
             return;
        }

        gl.bindTexture(gl.TEXTURE_2D, this.textures[textureIndex]);
        this.draw(this.programs.blur);
    }

    draw(program) {
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

    cleanup() {
        const gl = this.gl;
        if (this.originalTexture) gl.deleteTexture(this.originalTexture);
        this.textures.forEach(t => gl.deleteTexture(t));
        this.framebuffers.forEach(f => gl.deleteFramebuffer(f));
        gl.deleteBuffer(this.buffers.position);
        gl.deleteBuffer(this.buffers.texCoord);
        Object.values(this.programs).forEach(p => gl.deleteProgram(p));
    }
}
