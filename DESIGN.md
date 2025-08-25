# Design & Architecture Document

This document outlines the technical architecture, core algorithms, and design decisions made during the development of the Skin Retoucher Pro application.

## 1. Core Concept: Frequency Separation

The fundamental technique used is **Frequency Separation**. This method decomposes the image into two distinct layers:

1.  **Low-Frequency Layer (Color/Tone)**: This layer contains the broad color and tonal information of the image. We generate it by applying a **Gaussian Blur** to the original image. The `Smoothness` slider in the UI directly controls the sigma (standard deviation) of this blur.

2.  **High-Frequency Layer (Texture/Details)**: This layer contains the fine details and texture, such as pores, hair, and fine lines. It's calculated by taking the difference between the original image and the low-frequency (blurred) layer:
    `High Frequency = Original Image - Low-Frequency Layer`

By manipulating these layers independently (e.g., smoothing the low-frequency layer) and then recombining them, we can achieve high-quality retouching without destroying the natural skin texture.

## 2. Application Architecture

The application uses a standard Electron architecture, separating the Node.js backend (Main Process) from the browser-based frontend (Renderer Process).

-   **Main Process (`main.js`)**:
    -   Responsible for creating and managing the application window (`BrowserWindow`).
    -   Handles native operating system interactions, such as opening the "Save File" dialog.
    -   Listens for events from the Renderer Process via Inter-Process Communication (IPC).

-   **Renderer Process (`renderer.js`, `index.html`)**:
    -   Manages the entire user interface and user interactions.
    -   Hosts the `<canvas>` element where all WebGL rendering occurs.
    -   Contains all the core image processing logic, implemented in WebGL and GLSL.

-   **Preload Script (`preload.js`)**:
    -   Acts as a secure bridge between the Main and Renderer processes.
    -   Uses the `contextBridge` to expose a safe, limited API (e.g., `window.electronAPI.saveImage`) to the Renderer, avoiding the security risks of enabling full Node.js integration in the frontend.

## 3. WebGL Rendering Pipeline

The core of the application is a multi-pass rendering pipeline that leverages Framebuffer Objects (FBOs) to perform calculations offscreen. All processing is done at the original image's resolution to maintain quality.

The pipeline executes in the following order:

#### Pass 1: Skin Mask Generation
-   **Input**: Original Image Texture, user-selected skin tones (as a `uniform` array of HSV values), and the `tolerance` value. When the user right-clicks to select an 11th tone, the oldest of the 10 previous tones is automatically discarded, ensuring the array always holds the 10 most recent selections.
-   **Shader**: `maskFragmentShader.glsl`
-   **Process**: For each pixel of the input image, the shader:
    1.  Converts the pixel's color from RGB to HSV.
    2.  Calculates the difference in Hue and Saturation between the pixel and each of the selected skin tones.
    3.  If the difference is within the `tolerance` threshold for any of the selected tones, the output for that pixel is `1.0` (white). Otherwise, it's `0.0` (black).
-   **Output**: A black-and-white Skin Mask Texture, rendered into an FBO.

#### Pass 2 & 3: Low-Frequency Layer Generation (Two-Pass Gaussian Blur)
To efficiently generate the blurred (low-frequency) layer, we use a separable Gaussian blur, which is significantly faster than a single, large 2D kernel.
-   **Pass 2 (Horizontal Blur)**:
    -   **Input**: Original Image Texture.
    -   **Shader**: `blurFragmentShader.glsl` (with `u_dir` set to `(1.0, 0.0)`).
    -   **Output**: A horizontally blurred texture, rendered into an FBO.
-   **Pass 3 (Vertical Blur)**:
    -   **Input**: The horizontally blurred texture from Pass 2.
    -   **Shader**: `blurFragmentShader.glsl` (with `u_dir` set to `(0.0, 1.0)`).
    -   **Output**: The final, fully blurred Low-Frequency Texture, rendered into a separate FBO.

#### Pass 4: Final Composition & Display
This is the final stage where all the generated layers are combined and displayed on the screen.
-   **Input**: Original Texture, Low-Frequency Texture, Skin Mask Texture, and UI parameters (`detailAmount`, `viewMode`).
-   **Shader**: `finalFragmentShader.glsl`
-   **Process**:
    1.  Calculates the High-Frequency layer in real-time: `highPass = original - lowFrequency`.
    2.  Calculates the smoothed skin color: `smoothedSkin = lowFrequency + highPass * detailAmount`.
    3.  Blends the original image with the smoothed skin using the mask: `finalColor = mix(original, smoothedSkin, mask)`. This ensures that smoothing is only applied to the areas defined by the skin mask.
    4.  The shader also contains logic to switch to **Debug Views**, outputting just the mask, high-pass, or low-pass layer if requested.
-   **Output**: The final image is rendered to the main canvas visible to the user. The `u_transform` matrix is applied in the vertex shader at this stage to handle user pan and zoom.

## 4. Viewport and Coordinate Systems

-   **Aspect Ratio Correction**: The application's canvas always matches the container's dimensions. To prevent image distortion, a transformation matrix (`u_transform`) is calculated. This matrix applies an aspect ratio correction factor, effectively letterboxing or pillarboxing the image so it's always displayed at its native aspect ratio.
-   **Pan & Zoom**: User interactions (mouse drag, wheel) update `scale`, `panX`, and `panY` state variables. These are then used to build the `u_transform` matrix, which is passed to the vertex shader during the final composition pass.
-   **Color Picking Coordinate Transformation**: To ensure accurate color picking at any zoom or pan level, the screen coordinates from a right-click event must be converted back to the original image's texture coordinates. This is achieved by calculating and applying the mathematical inverse of the `u_transform` matrix to the mouse's clip-space coordinates. This robustly maps the on-screen position back to the correct pixel on the source image.
