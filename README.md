# Skin Retoucher Pro

![Project Banner](./Skin%20Retoucher.png) <!-- 您可以替換成自己的專案橫幅圖片 -->

A professional-grade desktop application for skin retouching, built with Electron and WebGL. This tool leverages the power of GPU acceleration to provide a real-time, non-destructive workflow based on the industry-standard **Frequency Separation** technique.

## Features

- **Frequency Separation**: Intelligently separates skin texture (high frequency) from color and tone (low frequency) for natural-looking results.
- **Selective Skin Masking**: Uses the HSV color space to create precise skin masks. Simply right-click on the image to select up to 10 skin tone samples.
- **Real-time GPU Processing**: All image processing is done on the GPU using WebGL, allowing for instant feedback as you adjust parameters.
- **Adjustable Parameters**:
    - **Smoothness**: Controls the intensity of the low-frequency blur to smooth out skin tones.
    - **Detail Amount**: Blends the original texture back in to retain a natural skin look.
    - **Color Tolerance**: Adjusts the sensitivity of the skin tone selection.
- **Interactive Viewport**:
    - **Pan**: Hold the left mouse button and drag to move around the image.
    - **Zoom**: Use the mouse wheel to zoom in and out, centered on your cursor.
- **Debug Views**: Isolate and view specific layers (Skin Mask, High Frequency, Low Frequency) to fine-tune your results.
- **Cross-Platform**: Built with Electron, it can be packaged for Windows, macOS, and Linux.

## Tech Stack

- **Application Framework**: [Electron](https://www.electronjs.org/)
- **Real-time Rendering**: [WebGL](https://get.webgl.org/)
- **GPU Shading Language**: GLSL
- **Core Environment**: [Node.js](https://nodejs.org/)
- **UI**: HTML5 / CSS3 / JavaScript (ES Modules)

## Getting Started

Follow these instructions to get a local copy up and running.

### Prerequisites

- [Node.js](https://nodejs.org/) (which includes npm) installed on your system.

### Installation

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/your-username/skin-retoucher-pro.git
    cd skin-retoucher-pro
    ```

2.  **Install dependencies:**
    ```sh
    npm install
    ```

### Running the Application

To start the application in development mode, run:

```sh
npm start
```

## How to Use

1.  **Load Image**: Click the "Load Image" button to open a picture.
2.  **Select Skin Tones**: **Right-click** on different areas of the skin in the image. You can add up to 10 samples.
3.  **Adjust Tolerance**: Use the "Color Tolerance" slider to expand or shrink the masked area. Use the "Skin Mask" debug view to see the result.
4.  **Adjust Smoothness**: Increase the "Smoothness" slider to even out skin color and tone.
5.  **Retain Details**: Adjust the "Detail Amount" slider to bring back natural skin texture. A value between 50-80% is usually recommended.
6.  **Pan & Zoom**: Use the left mouse button to drag and the mouse wheel to zoom for detailed work.
7.  **Save Image**: Once you are satisfied, click the "Save Image" button to save your work.

---

*This project was developed with guidance from the Gemini AI model.*
