/**
 * utils.js
 * 存放輔助函式，例如顏色空間轉換
 */

/**
 * 將 RGB 顏色值轉換為 HSV.
 * 轉換公式參考自 http://en.wikipedia.org/wiki/HSV_color_space.
 * r, g, b 的範圍是 [0, 1]，返回的 h, s, v 範圍也是 [0, 1].
 *
 * @param   Number  r       紅色值
 * @param   Number  g       綠色值
 * @param   Number  b       藍色值
 * @return  Array           [h, s, v]
 */
export function rgbToHsv(r, g, b) {
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max == 0 ? 0 : d / max;
    if (max == min) {
        h = 0; // achromatic
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, v];
}

/**
 * 將 HSV 顏色值轉換為 RGB.
 * 轉換公式參考自 http://en.wikipedia.org/wiki/HSV_color_space.
 * h, s, v 的範圍是 [0, 1]，返回的 r, g, b 範圍也是 [0, 1].
 *
 * @param   Number  h       色相
 * @param   Number  s       飽和度
 * @param   Number  v       明度
 * @return  Array           [r, g, b]
 */
export function hsvToRgb(h, s, v) {
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
