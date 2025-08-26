import { WebGLRenderer } from './webgl-renderer.js';
import { setupUIHandlers } from './ui-handlers.js';
import { setupViewportControls } from './viewport-controls.js';
import { BatchProcessor } from './batch-processor.js';
import { initDraggable } from './draggable.js';

/**
 * renderer.js
 * 應用程式主入口
 * 負責初始化、狀態管理和模組協調
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM 已完全加載和解析，開始初始化應用程式...");

    // 1. 獲取所有需要的 DOM 元素
    const dom = {
        canvas: document.getElementById('gl-canvas'),
        canvasContainer: document.querySelector('.canvas-container'),
        radiusSlider: document.getElementById('radius-slider'),
        radiusValueSpan: document.getElementById('radius-value'),
        detailSlider: document.getElementById('detail-slider'),
        detailValueSpan: document.getElementById('detail-value'),
        toleranceSlider: document.getElementById('tolerance-slider'),
        toleranceValueSpan: document.getElementById('tolerance-value'),
        expansionSlider: document.getElementById('expansion-slider'),
        expansionValueSpan: document.getElementById('expansion-value'),
        colorSwatchesContainer: document.getElementById('color-swatches'),
        clearColorsBtn: document.getElementById('clear-colors-btn'),
        viewModeGroup: document.getElementById('view-mode-group'),
        loadBtn: document.getElementById('load-btn'),
        saveBtn: document.getElementById('save-btn'),
        fileInput: document.getElementById('file-input'),
        previewContainer: document.querySelector('.preview-container'),
        maskPreviewCanvas: document.getElementById('mask-preview-canvas'),
        maskPreviewCtx: document.getElementById('mask-preview-canvas').getContext('2d'),
    };

    // 2. 初始化 WebGL Renderer
    const renderer = new WebGLRenderer(dom.canvas);

    // 3. 建立一個集中的應用程式狀態 (appState) 物件
    const appState = {
        dom, // 將 DOM 元素引用儲存在狀態中
        image: null,
        // 處理參數
        smoothness: 0.1 + (parseFloat(dom.radiusSlider.value) / 100) * 15,
        detailAmount: parseFloat(dom.detailSlider.value) / 100.0,
        colorTolerance: parseFloat(dom.toleranceSlider.value) / 100.0,
        maskExpansion: parseFloat(dom.expansionSlider.value) / 200.0, // 轉換為 0.0 - 0.5
        maskBlurRadius: 5.0, // 固定的遮罩模糊半徑
        selectedSkinTones: [],
        currentViewMode: 'final',
        // 視口狀態
        scale: 1.0,
        panX: 0.0,
        panY: 0.0,
    };

    // 4. 初始化批次處理器
    const batchProcessor = new BatchProcessor(appState, renderer.gl);
    batchProcessor.init();

    // 5. 設置 UI 事件處理器
    setupUIHandlers(appState, renderer, batchProcessor);

    // 6. 設置視口控制 (縮放/平移)
    setupViewportControls(appState, () => renderer.render(appState));

    // 7. 啟用預覽視窗的拖曳功能
    initDraggable(dom.previewContainer, dom.previewContainer.querySelector('p'));
    
    console.log("應用程式初始化完成。");
});