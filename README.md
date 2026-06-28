# Slim Fit Studio

Slim Fit Studio is a macOS Electron app for controlling compatible USB Video Class (UVC) webcams.

It was built to fix indoor-light flicker on the Samsung SlimFit Cam in India. The camera was using a 60 Hz anti-flicker setting by default, while India uses 50 Hz power frequency. That mismatch can cause visible flickering or banding under indoor lighting.

Samsung does not expose this setting in the monitor UI, and macOS does not provide a built-in camera control panel for it. Slim Fit Studio reads the selected camera's UVC controls and lets you set the camera's hardware anti-flicker mode to 50 Hz, plus adjust other controls the camera exposes.

The app is built and tested with the Samsung SlimFit Cam, but the control path is generic: any UVC webcam that exposes the same controls can be selected and adjusted.

## Features

- Set anti-flicker / power-line frequency: 50 Hz, 60 Hz, or Off
- Adjust hardware zoom, brightness, contrast, saturation, and sharpness
- Live camera preview
- Camera source selection
- Preview-only camera flip
- macOS app packaging with a bundled Node/UVC control helper
- Custom app icon

## How it works

The Samsung SlimFit Cam exposes its capabilities as a standard UVC device. Slim Fit Studio asks the camera what controls it supports, reads each control's range and current value, then builds the UI from that data.

The camera reported controls including:

- `power_line_frequency`
- `absolute_zoom`
- `brightness`
- `contrast`
- `saturation`
- `sharpness`

The app uses `uvcc` under the hood to read and set these UVC controls. Electron provides the macOS app shell, while the camera-control server runs as a bundled Node child process.

The anti-flicker values follow the UVC power-line frequency control:

```text
0 = Off
1 = 50 Hz
2 = 60 Hz
```

For the Samsung SlimFit Cam tested here:

```bash
uvcc --vendor 0x4e8 --product 0x20d3 set power_line_frequency 1
```

Slim Fit Studio wraps that lower-level flow with device discovery, a preview, sliders, and macOS packaging.

## Requirements

- macOS
- Samsung SlimFit Cam or another UVC webcam exposing similar controls
- Node.js / npm for development

The packaged app bundles the Node runtime it needs.

## Development

Install dependencies:

```bash
npm install
```

Run the local web server:

```bash
npm start
```

Run the Electron app in development mode:

```bash
npm run app
```

Check connected UVC camera controls:

```bash
npm run doctor
```

Build the macOS app:

```bash
npm run app:build
```

The built app is created at:

```text
dist-app/mac-arm64/Slim Fit Studio.app
```

## Install locally

Build the app:

```bash
npm run app:build
```

Copy it to `/Applications`:

```bash
cp -R "dist-app/mac-arm64/Slim Fit Studio.app" /Applications/
```

The app is unsigned. On first launch, macOS may require right-clicking the app and choosing **Open**.

## Limitations

- Camera flip is preview-only. It does not change the camera's hardware output.
- Background replacement is not a UVC hardware setting and is not supported.
- The current build target is Apple Silicon (`mac-arm64`).
- Controls depend on what the connected camera exposes over UVC.
- Built-in Mac cameras may appear for preview, but often do not expose configurable UVC hardware controls.

## Notes

- Generated folders like `node_modules/` and `dist-app/` are intentionally ignored by Git.

## License

MIT
