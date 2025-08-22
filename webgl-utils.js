/**
 * Creates a shader of the given type, uploads the source and compiles it.
 * @param {WebGLRenderingContext} gl The WebGLRenderingContext to use.
 * @param {number} type The type of shader to create (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
 * @param {string} source The shader source code.
 * @returns {WebGLShader} The created shader.
 */
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
        return shader;
    }

    console.error(`Error compiling shader type ${type}:`);
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return undefined;
}

/**
 * Creates a program, attaches shaders, links it.
 * @param {WebGLRenderingContext} gl The WebGLRenderingContext to use.
 * @param {WebGLShader} vertexShader A vertex shader.
 * @param {WebGLShader} fragmentShader A fragment shader.
 * @returns {WebGLProgram} The created program.
 */
function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
        return program;
    }

    console.error("Error linking program:");
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return undefined;
}

export { createShader, createProgram };