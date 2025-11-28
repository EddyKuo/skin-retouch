
export const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    uniform mat4 u_transform;
    void main() {
        gl_Position = u_transform * vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

export const blurFragmentShaderSource = `
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
        // Optimization: We could use fewer samples with linear interpolation,
        // but for now we keep the logic but extracting it.
        for (float i = -12.0; i <= 12.0; i += 1.0) {
            float weight = (1.0 / (2.5066 * sigma)) * exp(-0.5 * (i * i) / (sigma * sigma));
            vec2 offset = u_dir * i / u_resolution;
            color += texture2D(u_image, uv + offset) * weight;
            total += weight;
        }
        gl_FragColor = color / total;
    }
`;

export const maskFragmentShaderSource = `
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

export const previewFragmentShaderSource = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
        gl_FragColor = texture2D(u_texture, v_texCoord);
    }
`;

export const finalFragmentShaderSource = `
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
