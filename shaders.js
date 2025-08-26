/**
 * shaders.js
 * 存放所有 GLSL 著色器原始碼
 */

// 頂點著色器：處理頂點位置和紋理座標
export const VERTEX_SHADER_SOURCE = `
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
export const BLUR_FRAGMENT_SHADER_SOURCE = `
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
        // 減少循環次數以提高性能，對於中等模糊半徑效果依然很好
        for (float i = -12.0; i <= 12.0; i += 1.0) {
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
export const MASK_FRAGMENT_SHADER_SOURCE = `
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
export const FINAL_FRAGMENT_SHADER_SOURCE = `
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
