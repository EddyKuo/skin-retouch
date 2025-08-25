/**
 * 建立一個指定類型的著色器，上傳原始碼並進行編譯。
 * @param {WebGLRenderingContext} gl WebGL 上下文。
 * @param {number} type 要建立的著色器類型 (gl.VERTEX_SHADER 或 gl.FRAGMENT_SHADER)。
 * @param {string} source 著色器的 GLSL 原始碼。
 * @returns {WebGLShader | undefined} 成功時返回建立的著色器，失敗時返回 undefined。
 */
function createShader(gl, type, source) {
    // 建立著色器物件
    const shader = gl.createShader(type);
    // 提供原始碼
    gl.shaderSource(shader, source);
    // 編譯著色器
    gl.compileShader(shader);

    // 檢查編譯是否成功
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
        return shader;
    }

    // 如果編譯失敗，印出錯誤資訊
    console.error(`編譯著色器失敗 (類型: ${type}):`);
    console.error(gl.getShaderInfoLog(shader));
    // 刪除失敗的著色器以釋放資源
    gl.deleteShader(shader);
    return undefined;
}

/**
 * 建立一個 WebGL 程序，附加頂點和片段著色器，並進行連結。
 * @param {WebGLRenderingContext} gl WebGL 上下文。
 * @param {WebGLShader} vertexShader 頂點著色器。
 * @param {WebGLShader} fragmentShader 片段著色器。
 * @returns {WebGLProgram | undefined} 成功時返回建立的程序，失敗時返回 undefined。
 */
function createProgram(gl, vertexShader, fragmentShader) {
    // 建立 WebGL 程序物件
    const program = gl.createProgram();
    // 附加著色器
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    // 連結程序
    gl.linkProgram(program);

    // 檢查連結是否成功
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
        return program;
    }

    // 如果連結失敗，印出錯誤資訊
    console.error("連結 WebGL 程序失敗:");
    console.error(gl.getProgramInfoLog(program));
    // 刪除失敗的程序以釋放資源
    gl.deleteProgram(program);
    return undefined;
}

// 導出這兩個輔助函式，以便在其他模組中使用
export { createShader, createProgram };
