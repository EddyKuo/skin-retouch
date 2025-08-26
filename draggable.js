/**
 * draggable.js
 * 提供讓 HTML 元素可拖曳的功能
 */
export function initDraggable(element, handle) {
    let isDragging = false;
    let offsetX, offsetY;

    // 當在拖曳 handle 上按下左鍵時
    handle.addEventListener('mousedown', (e) => {
        // 只響應左鍵
        if (e.button !== 0) return;

        isDragging = true;
        
        // 計算滑鼠點擊位置相對於元素左上角的偏移量
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;

        // 防止拖曳時選取到文字
        e.preventDefault();
    });

    // 當滑鼠在整個文件中移動時
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // 計算元素新的左上角位置
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

        // 確保元素不會被拖出父容器（畫布容器）的邊界
        const parentRect = element.parentElement.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        newX = Math.max(0, newX); // 限制左邊界
        newY = Math.max(0, newY); // 限制上邊界
        newX = Math.min(parentRect.width - elementRect.width, newX);  // 限制右邊界
        newY = Math.min(parentRect.height - elementRect.height, newY); // 限制下邊界

        // 更新元素的位置
        element.style.left = `${newX}px`;
        element.style.top = `${newY}px`;
        
        // 拖曳時移除絕對定位的 bottom 和 right，改用 top 和 left
        element.style.bottom = 'auto';
        element.style.right = 'auto';
    });

    // 當在整個文件中放開滑鼠左鍵時
    document.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        isDragging = false;
    });
}
