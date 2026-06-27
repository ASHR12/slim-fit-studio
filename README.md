# Slim Fit Studio

Slim Fit Studio is a small macOS Electron app for controlling a Samsung SlimFit Cam over USB Video Class (UVC) hardware controls.

It was built to fix indoor-light flicker on the Samsung SlimFit Cam in India. The camera was using a 60 Hz anti-flicker setting by default, while India uses 50 Hz power frequency. Slim Fit Studio lets you switch the camera's `power_line_frequency` to 50 Hz and adjust other exposed camera controls.

## Features

- Set anti-flicker / power-line frequency: 50 Hz, 60 Hz, or Off
- Adjust hardware zoom, brightness, contrast, saturation, and sharpness
- Live camera preview
- Camera source selection
- Preview-only camera flip
- Native macOS Electron app packaging

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

## Personal macOS install

After building, copy the app into `/Applications`:

```bash
cp -R "dist-app/mac-arm64/Slim Fit Studio.app" /Applications/
```

This app is unsigned and intended for personal use. On first launch, macOS may require right-clicking the app and choosing **Open**.

## Notes

- The camera flip option only affects the preview inside Slim Fit Studio. It does not change the camera's hardware output.
- The app is packaged for Apple Silicon (`mac-arm64`).
- Generated folders like `node_modules/` and `dist-app/` are intentionally ignored by Git.
