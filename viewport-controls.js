/**
 * viewport-controls.js
 * 處理畫布的縮放與平移事件
 */

let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

function handleWheel(event, appState, renderCallback) {
    event.preventDefault();
    if (!appState.image) return;

    const rect = appState.dom.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const zoomFactor = 1.1;
    const oldScale = appState.scale;

    if (event.deltaY < 0) {
        appState.scale *= zoomFactor;
    } else {
        appState.scale /= zoomFactor;
    }
    appState.scale = Math.max(0.02, Math.min(appState.scale, 50));

    appState.panX = mouseX - (mouseX - appState.panX) * (appState.scale / oldScale);
    appState.panY = mouseY - (mouseY - appState.panY) * (appState.scale / oldScale);

    renderCallback();
}

function handleMouseDown(event) {
    if (event.button !== 0) return;
    isPanning = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
}

function handleMouseMove(event, appState, renderCallback) {
    if (!isPanning) return;
    appState.dom.canvas.style.cursor = 'grabbing';
    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;
    appState.panX += dx;
    appState.panY += dy;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    renderCallback();
}

function handleMouseUp(event, appState) {
    if (event.button !== 0 && event.type !== 'mouseleave') return;
    isPanning = false;
    appState.dom.canvas.style.cursor = 'grab';
}

export function setupViewportControls(appState, renderCallback) {
    const { canvas } = appState.dom;
    canvas.addEventListener('wheel', (e) => handleWheel(e, appState, renderCallback), { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', (e) => handleMouseMove(e, appState, renderCallback));
    canvas.addEventListener('mouseup', (e) => handleMouseUp(e, appState));
    canvas.addEventListener('mouseleave', (e) => handleMouseUp(e, appState));
}
