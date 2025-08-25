# **JavaScript 與 Electron 膚質修飾專案開發指南 (高低頻分離法)**

本指南將引導您使用 JavaScript、Electron 和 WebGL 開發一個專業級的皮膚修飾桌面應用程式。專案核心採用業界標準的**高低頻分離 (Frequency Separation)** 演算法，並整合了**基於膚色選取的遮罩 (Skin Tone Masking)** 與 **GPU 加速**，以實現對參數的即時調整與預覽，打造流暢的使用者體驗。

考量到目前時間（**2025年8月25日**），Electron 和 WebGL 的技術都非常成熟，社群活躍，是建構現代化、高效能桌面應用的絕佳選擇。

## **注意處理路徑**
在windows裡, 路徑分隔為'\'而不是'\', 千萬不要搞錯
必須是filePath.split('\\'), 而不是filePath.split('\').

## **核心概念：高低頻分離 + 膚色遮罩**

此專案的核心演算法旨在將影像的**紋理細節（高頻層）**與**顏色光影（低頻層）**分開處理。透過在不破壞皮膚真實紋理（高頻層）的前提下，去平滑膚色、柔化光影（低頻層），從而達到既自然又完美的修飾效果。

為了讓修飾效果更精準，專案還引入了**膚色遮罩**技術。使用者可以從畫面上選取代表性的膚色，演算法會生成一個遮罩，確保平滑效果**只套用在選定的膚色區域**，避免影響背景、頭髮或眼睛等非皮膚區域。

## **必要的開發工具與技術棧**

| 分類 | 工具 / 技術 | 用途說明 |
| :---- | :---- | :---- |
| **執行環境** | Node.js | Electron 的基礎，提供後端 API 和專案的執行環境。 |
| **應用程式框架** | Electron | **專案的骨架**。讓您能使用網頁技術建立桌面應用程式，並提供存取原生系統功能的 API（如檔案對話方塊）。 |
| **GPU 加速** | WebGL | **實現即時性能的關鍵**。這是瀏覽器內建的 3D 圖形 API，基於 OpenGL ES。我們將用它來執行所有密集的影像處理運算。 |
| **GPU 程式語言** | GLSL | **在 GPU 上執行的演算法**。與 OpenGL 版本相同，您需要編寫 GLSL 著色器來實作高斯模糊、圖層混合等操作。 |
| **UI 介面** | HTML / CSS | 負責應用程式的結構與外觀。您可以自由搭配任何前端框架（如 React, Vue）或使用原生 JavaScript。 |
| **影像操作** | Canvas API | HTML5 的 \<canvas\> 元素是讀取影像像素、顯示 WebGL 內容以及將結果匯出的核心工具。 |
| **環境管理** | npm / yarn | Node.js 的套件管理器，用於安裝 Electron 和其他專案依賴。 |
| **開發環境** | Visual Studio Code | 推薦的程式碼編輯器，對 JavaScript 和 Electron 開發支援極佳。 |

**建立一個基本的 Electron 專案：**

```bash
# 1. 建立專案資料夾並初始化
mkdir skin-retoucher-js && cd skin-retoucher-js
npm init -y

# 2. 安裝 Electron
npm install --save-dev electron

# 3. 在 package.json 的 "scripts" 中加入啟動指令
# "start": "electron ."
```

## **專案開發重點列項**

### **1. 專案結構 (Electron Main vs. Renderer)**

*   **主程序 (Main Process):** `main.js` 檔案。負責建立應用程式視窗 (`BrowserWindow`)、管理應用程式生命週期，並處理所有需要原生權限的操作（如檔案儲存、批次處理的檔案讀寫）。
*   **渲染程序 (Renderer Process):** `index.html` 及由它載入的 `renderer.js`。這是應用程式的 UI 介面，所有的 DOM 操作、WebGL 渲染、使用者互動都在這裡進行。
*   **預載入腳本 (Preload Script):** `preload.js`。在一個隔離的上下文中執行，作為主程序和渲染程序之間安全的橋樑，用於暴露 `ipcRenderer` 等 Node.js API。

### **2. UI 介面佈局 (index.html)**

設計一個功能完善的介面，包含以下核心元素：

*   一個主要的 `<canvas id="gl-canvas">` 作為 WebGL 的繪圖目標。
*   一個 `<canvas id="mask-preview-canvas">` 用於即時預覽生成的膚色遮罩。
*   **核心參數控制滑桿**: 
    *   `smoothness-slider`: 控制高斯模糊半徑，決定皮膚平滑程度。
    *   `detail-slider`: 控制高頻層混合的比例，用於保留或增強皮膚紋理。
    *   `tolerance-slider`: 控制膚色選取的容錯率，決定遮罩範圍的大小。
*   **膚色選取工具**: 
    *   一個色塊區域 (`color-swatches`) 顯示使用者已選取的膚色。
    *   一個「清除色調」按鈕 (`clear-colors-btn`)。
    *   操作提示：透過在主畫布上**按右鍵**來取樣顏色。
*   **除錯檢視模式 (Debug View)**:
    *   一組單選按鈕 (`view-mode-group`)，允許開發者或使用者切換檢視最終結果、高頻層或低頻層，方便微調參數。
*   **批次處理模組 (Batch Processing)**:
    *   獨立的控制區域，包含進度條、日誌輸出區，以及用於選取多個檔案的按鈕。
*   **檔案操作按鈕**: 
    *   `load-btn`: 載入單張圖片。
    *   `save-btn`: 儲存目前處理的圖片。
    *   `batch-btn`: 選取多個圖片以進行批次處理。
*   一個隱藏的 `<input type="file">` 用於觸發檔案選擇。

### **3. 檔案載入流程**

1.  點擊「載入圖片」按鈕時，程式化地觸發隱藏的 `<input type="file">` 的點擊事件。
2.  監聽檔案輸入的 `change` 事件，取得使用者選擇的檔案。
3.  使用 `FileReader` 的 `readAsDataURL` 方法將圖片檔案轉換為 Base64 字串。
4.  建立一個新的 `Image` 物件，將其 `src` 設為該 Base64 字串。
5.  在 `Image` 物件的 `onload` 事件中，表示圖片已載入完成。此時，這個 `Image` 物件就可以被用來建立 WebGL 紋理了。

### **4. 核心演算法 (WebGL)**

這是專案的技術核心，所有操作都在 `renderer.js` 中進行，並透過幀緩衝區 (FBO) 實現多通道渲染管線。

*   **A. 初始化 WebGL**: 從 `<canvas>` 元素取得 WebGL 上下文。
*   **B. 編譯 GLSL Shaders**:
    *   專案包含多個 Fragment Shader，用於不同階段的處理：
        1.  **高斯模糊 (Blur Shader)**: 實現兩次（水平、垂直）高斯模糊，生成低頻層。
        2.  **膚色遮罩 (Mask Shader)**: 根據使用者選取的膚色 (在 HSV 色彩空間進行比較以提高準確性) 和容錯率，生成一個黑白遮罩。
        3.  **最終合成 (Final Shader)**: 這是最關鍵的一步。它接收**原始影像**、**低頻層(模糊影像)** 和 **膚色遮罩** 作為輸入。
            *   在 Shader 內部，透過 `原始影像 - 低頻層` 計算出**高頻層**。
            *   將 `低頻層 + (高頻層 * 細節保留量)` 混合成**平滑後的皮膚紋理**。
            *   最後，使用膚色遮罩作為混合因子，將**平滑後的皮膚**與**原始影像**進行混合 (`mix(original, smoothed, mask)`)，最終只在遮罩指定的區域套用效果。
*   **C. 上傳影像資料**:
    *   建立 WebGL 紋理物件 (`gl.createTexture()`)。
    *   將 `onload` 後的 `Image` 物件作為資料來源，上傳到紋理中 (`gl.texImage2D()`)。
*   **D. 渲染管線 (Pipeline):**
    1.  **Pass 1 (膚色遮罩):** 啟用 FBO 1。執行 **Mask Shader**，將原始影像作為輸入，結果（膚色遮罩）被渲染到 FBO 1 的紋理上。
    2.  **Pass 2 (水平模糊):** 啟用 FBO 2。執行 **Blur Shader**（水平方向），將原始影像紋理作為輸入，結果渲染到 FBO 2 的紋理上。
    3.  **Pass 3 (垂直模糊):** 啟用 FBO 3。執行 **Blur Shader**（垂直方向），將 **FBO 2 的結果紋理**作為輸入，渲染結果（即完整的**低頻層**）儲存在 FBO 3 的紋理上。
    4.  **Pass 4 (最終合成與輸出):** 解除綁定 FBO（渲染到主畫布）。執行 **Final Shader**，它需要三個紋理輸入：原始影像、FBO 3 的低頻層紋理、FBO 1 的膚色遮罩紋理。Shader 內部完成高低頻分離、混合、並根據遮罩輸出最終結果。

### **5. UI 互動性**

*   監聽所有滑桿的 `input` 事件。
*   當事件觸發時，獲取滑桿的當前值，並透過 `gl.uniform` 將新值（如模糊半徑、細節量、容錯率）傳遞給對應的 Shader。
*   立即重新執行一次完整的渲染管線 (Pass 1 -> 4)。由於所有計算都在 GPU 上，這個過程幾乎是瞬時的，使用者能看到**流暢的即時預覽效果**。
*   監聽畫布的右鍵點擊事件 (`contextmenu`)，讀取點擊位置的像素顏色，轉換為 HSV 格式後加入膚色樣本列表，並觸發重新渲染。

### **6. 檔案儲存 (Electron 原生整合)**

專案採用了比原始 `GEMINI.md` 提示更健壯和正確的方法：

1.  在 `renderer.js` 中，當使用者點擊「儲存圖片」按鈕時：
    *   將最終的修飾結果渲染到一個離屏的 2D `<canvas>` 元素上。
    *   呼叫該 canvas 的 `toDataURL('image/png')` 方法，將其內容轉換為 Base64 編碼的 PNG 圖片字串。
    *   移除 Base64 字串的標頭 (`data:image/png;base64,`)。
    *   透過 `preload.js` 暴露的 API (`window.electronAPI.saveImage`) 將這個 Base64 字串傳送給主程序。

2.  在 `main.js` 中，監聽 `save-image` 事件：
    *   呼叫 Electron 的 `dialog.showSaveDialog` 讓使用者選擇儲存路徑和檔名。
    *   如果使用者確定儲存，則將從渲染程序收到的 Base64 字串轉換為 `Buffer` (`Buffer.from(data, 'base64')`)。
    *   使用 Node.js 的 `fs.writeFile` 將 `Buffer` 寫入檔案，生成一個有效的 PNG 圖片。

### **7. 批次處理 (Batch Processing)**

此為專案的進階功能，極大提升了工作效率：

1.  **觸發**: 使用者點擊「Select Images for Batch」按鈕，主程序 (`main.js`) 會開啟一個可以**複選**圖片檔案的對話方塊。
2.  **啟動**: 主程序將選中的檔案路徑列表傳回給渲染程序。渲染程序中的 `BatchProcessor` 模組接管流程。
3.  **離屏渲染**: `BatchProcessor` 會依序處理每一張圖片。對於每張圖，它會在背景執行完整的 WebGL 渲染管線（遮罩 -> 模糊 -> 合成），但**不會顯示在主畫布上**。
4.  **儲存**: 每處理完一張圖片，渲染結果會像單張儲存一樣被轉換為 Base64 字串，並連同原始檔案路徑一起傳送給主程序的 `save-batch-image` 事件監聽器。
5.  **命名與儲存**: 主程序會根據原始檔名，自動產生一個帶有 `_rt` 後綴的新檔名 (例如 `photo.jpg` -> `photo_rt.png`)，並將其儲存在原始檔案相同的資料夾中。
6.  **進度回饋**: 整個過程中，渲染程序會更新 UI 上的進度條和日誌，讓使用者了解目前的處理進度。

遵循以上步驟，您就能有條不紊地開發出一個功能完整、性能卓越的桌面級膚質修飾工具。