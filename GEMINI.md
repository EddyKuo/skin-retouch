# **JavaScript 與 Electron 膚質修飾專案開發指南 (高低頻分離法)**

本指南將引導您使用 JavaScript、Electron 和 WebGL 開發一個專業級的皮膚修飾桌面應用程式。專案核心採用業界標準的**高低頻分離 (Frequency Separation)** 演算法，並整合 **GPU 加速**，以實現對參數的即時調整與預覽，打造流暢的使用者體驗。

考量到目前時間（**2025年8月22日**），Electron 和 WebGL 的技術都非常成熟，社群活躍，是建構現代化、高效能桌面應用的絕佳選擇。

## **核心概念：高低頻分離**

此專案的核心演算法旨在將影像的\*\*紋理細節（高頻層）**與**顏色光影（低頻層）\*\*分開處理。透過在不破壞皮膚真實紋理（高頻層）的前提下，去平滑膚色、柔化光影（低頻層），從而達到既自然又完美的修飾效果。

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

\# 1\. 建立專案資料夾並初始化  
mkdir skin-retoucher-js && cd skin-retoucher-js  
npm init \-y

\# 2\. 安裝 Electron  
npm install \--save-dev electron

\# 3\. 在 package.json 的 "scripts" 中加入啟動指令  
\# "start": "electron ."

## **專案開發重點列項**

### **1\. 專案結構 (Electron Main vs. Renderer)**

* **主程序 (Main Process):** main.js 檔案。負責建立應用程式視窗 (BrowserWindow)、管理應用程式生命週期，並處理所有需要原生權限的操作（如檔案儲存對話方塊）。  
* **渲染程序 (Renderer Process):** index.html 及由它載入的 renderer.js。這是應用程式的 UI 介面，所有的 DOM 操作、WebGL 渲染都在這裡進行。

### **2\. UI 介面佈局 (index.html)**

設計一個簡潔的介面，包含以下核心元素：

* 一個 \<canvas id="gl-canvas"\>\</canvas\> 作為 WebGL 的繪圖目標。  
* 一個 \<input type="range" id="radius-slider"\> 滑桿，用於即時控制高斯模糊的半徑。  
* \<button id="load-btn"\>載入圖片\</button\> 和 \<button id="save-btn"\>儲存圖片\</button\>。  
* 一個隱藏的 \<input type="file" id="file-input"\> 用於觸發檔案選擇。

### **3\. 檔案載入流程**

1. 點擊「載入圖片」按鈕時，程式化地觸發隱藏的 \<input type="file"\> 的點擊事件。  
2. 監聽檔案輸入的 change 事件，取得使用者選擇的檔案。  
3. 使用 URL.createObjectURL() 將檔案轉換為一個 URL。  
4. 建立一個新的 Image 物件，將其 src 設為該 URL。  
5. 在 Image 物件的 onload 事件中，表示圖片已載入完成。此時，這個 Image 物件就可以被用來建立 WebGL 紋理了。

### **4\. 核心演算法 (WebGL)**

這是專案的技術核心，所有操作都在 renderer.js 中進行。

* **A. 初始化 WebGL**: 從 \<canvas\> 元素取得 WebGL 上下文。  
  const canvas \= document.getElementById('gl-canvas');  
  const gl \= canvas.getContext('webgl');

* **B. 編譯 GLSL Shaders**:  
  * 將 GLSL 程式碼（頂點著色器和片段著色器）作為字串載入。  
  * 編寫一個輔助函式，用於編譯 Shader 並連結成 WebGL Program。  
  * 您至少需要**兩個** Fragment Shader：一個用於**高斯模糊**，一個用於**圖層混合**。  
* **C. 上傳影像資料**:  
  * 建立 WebGL 紋理物件 (gl.createTexture())。  
  * 將 onload 後的 Image 物件作為資料來源，上傳到紋理中 (gl.texImage2D())。  
* **D. 使用幀緩衝區 (FBO) 進行多通道渲染**:  
  * **FBO 是 GPU 中的離屏畫布**，是實現高低頻分離的關鍵。您需要建立至少兩個 FBO。  
  * **渲染管線 (Pipeline):**  
    1. **Pass 1 (水平模糊):** 啟用 FBO 1。執行高斯模糊 Shader（設定為水平方向），將原始影像紋理作為輸入，結果會被渲染到 FBO 1 的紋理附件上。  
    2. **Pass 2 (垂直模糊):** 啟用 FBO 2。執行高斯模糊 Shader（設定為垂直方向），將 **FBO 1 的結果紋理**作為輸入，渲染結果（即完整的**低頻層**）會被儲存在 FBO 2 的紋理附件上。  
    3. **Pass 3 (圖層混合與輸出):** 解除綁定 FBO（現在渲染到主畫布）。執行圖層混合 Shader，它需要**兩個紋理輸入**：原始影像紋理和 FBO 2 的低頻層紋理。在此 Shader 中完成高低頻分離的加減運算，並將最終結果繪製到畫面上。

### **5\. UI 互動性**

* 監聽滑桿的 input 事件。  
* 當事件觸發時，獲取滑桿的當前值。  
* 透過 gl.uniform1f() 將這個值（模糊半徑）傳遞給高斯模糊 Shader 的 uniform 變數。  
* 立即重新執行一次完整的渲染管線 (Pass 1 \-\> Pass 2 \-\> Pass 3)。由於所有計算都在 GPU 上，這個過程幾乎是瞬時的，使用者能看到**流暢的即時預覽效果**。

### **6\. 檔案儲存 (Electron 原生整合)**

1. 在 renderer.js 中，當使用者點擊「儲存圖片」按鈕時：  
   * 確保最終的修飾結果已被渲染到一個 FBO 上。  
   * 使用 gl.readPixels() 從 FBO 中讀取像素數據到一個 Uint8Array。  
   * 透過 Electron 的 ipcRenderer 將這個 Uint8Array 傳送給主程序：  
     // renderer.js  
     const { ipcRenderer } \= require('electron');  
     ipcRenderer.send('save-image', { data: pixelArray, width, height });

2. 在 main.js 中，監聽此事件，並呼叫原生儲存對話方塊：  
   // main.js  
   const { ipcMain, dialog } \= require('electron');  
   const fs \= require('fs');

   ipcMain.on('save-image', async (event, args) \=\> {  
       const { filePath } \= await dialog.showSaveDialog({  
           filters: \[{ name: 'Images', extensions: \['png'\] }\]  
       });  
       if (filePath) {  
           // 注意：直接儲存 raw pixels 需要額外處理成 PNG 格式  
           // 簡單的方法是先在 renderer 端畫到 2D canvas 再轉成 base64 傳過來  
           // 或者在 main 端使用 sharp 等函式庫進行轉換  
           // 以下為簡化示意  
           const buffer \= Buffer.from(args.data);  
           fs.writeFile(filePath, buffer, (err) \=\> {  
               if (err) console.error("儲存失敗:", err);  
           });  
       }  
   });

   * **提示**：將原始像素陣列（Uint8Array）直接寫入檔案不會生成有效的圖片格式。最簡單的方法是在渲染程序中，將最終結果繪製到一個 2D canvas，然後使用 canvas.toDataURL() 轉為 Base64 字串，再將此字串傳給主程序進行解碼和儲存。

遵循以上步驟，您就能有條不紊地開發出一個功能完整、性能卓越的桌面級膚質修飾工具。