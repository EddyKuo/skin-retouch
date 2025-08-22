# Future Development Roadmap

This document outlines potential new features and improvements to enhance the capabilities of the Skin Retoucher Pro application. These are organized by priority and complexity.

## High Priority Features

### 1. 🖌️ Healing & Cloning Brush
-   **Description**: A brush-based tool to remove small imperfections like blemishes, spots, or stray hairs. The tool would intelligently sample surrounding textures and tones to seamlessly blend the corrected area.
-   **User Interface**:
    -   Add a "Healing Brush" tool to the control panel.
    -   Provide sliders for `Brush Size` and `Brush Hardness`.
-   **Technical Implementation**:
    -   Requires a "ping-pong" framebuffer system to apply brush strokes iteratively.
    -   A new GLSL fragment shader (`healingFragmentShader`) would need to be developed to handle the texture sampling and blending logic (e.g., averaging, Poisson blending).

### 2. ✨ Dodge & Burn Tool
-   **Description**: Non-destructive brush tools to manually lighten (Dodge) or darken (Burn) specific areas of the image. This is essential for enhancing contours, depth, and facial structure.
-   **User Interface**:
    -   Add "Dodge" and "Burn" tool modes.
    -   Provide a slider for `Exposure` or `Strength` to control the intensity of the effect.
-   **Technical Implementation**:
    -   Utilizes the same ping-pong framebuffer system as the healing brush.
    -   The `dodgeAndBurnShader` would apply a simple multiplicative color adjustment based on the brush's position and strength.

## Medium Priority Features

### 3. 🎨 Advanced Color Correction
-   **Description**: Tools to correct and unify skin tones across different areas of the face. This would allow users to reduce redness, neutralize yellow casts, or generally even out the complexion.
-   **User Interface**:
    -   Add a new panel for "Color Correction".
    -   Include targeted sliders like `Red Hue Shift`, `Yellow Saturation`, etc.
-   **Technical Implementation**:
    -   Can be implemented as an additional pass in the final composition shader.
    -   The `colorCorrectionShader` would perform color transformations in HSV/HSL space on pixels that fall within a specific color range.

### 4. 👁️ Localized Sharpening Brush
-   **Description**: A brush tool to apply sharpening selectively to specific features like eyes, eyebrows, and lips, making them pop without affecting the skin's softness.
-   **User Interface**:
    -   Add a "Sharpening Brush" tool.
    -   Provide a slider for `Strength` or `Amount`.
-   **Technical Implementation**:
    -   Uses the ping-pong framebuffer system.
    -   The `sharpeningShader` would implement an Unsharp Mask algorithm, enhancing local contrast based on the brush's position.

## Quality of Life & Architectural Improvements

### 5. 💾 Advanced Save Options
-   **Description**: Implement a true offscreen rendering pipeline for saving files. This would ensure that the output is always the full, original resolution of the image, regardless of the current zoom or pan state in the viewport.
-   **Technical Implementation**:
    -   Create a dedicated offscreen canvas and WebGL context when the save button is clicked.
    -   Re-run the entire processing pipeline on this offscreen context at full resolution.
    -   Extract the final image data from the offscreen canvas.

### 6. ↩️ Undo/Redo History
-   **Description**: Implement a state management system to track user actions (e.g., slider adjustments, color selections, brush strokes). This would allow users to undo and redo their changes.
-   **Technical Implementation**:
    -   Requires creating a "history stack" (an array of state objects).
    -   Each significant user action would push a new state object onto the stack.
    -   "Undo" would pop from the stack and restore the previous state, while "Redo" would move forward. This would be a significant architectural change.
