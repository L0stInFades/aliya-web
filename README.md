# Aliya Web/WASM Prototype

This is a local experimental web reconstruction of the installed Unity game. It uses extracted local assets and a Rust/WASM gameplay core, with Vue kept as the browser UI layer.

## License

This project is licensed under the PolyForm Noncommercial License 1.0.0. Commercial use is not permitted.

## What Is Extracted

- `public/extracted/flowcharts.json`: Fungus Flowchart data exported from Unity prefabs.
- `public/extracted/localization.*.json`: dialogue/localization tables.
- `public/extracted/images/`: Texture2D/Sprite exports, including message images and UI art.
- `public/extracted/audio/`: original FSB audio plus browser-playable WAV transcodes.
- `reverse/Assembly-CSharp/`: decompiled C# reference output in the parent game folder.

## Toolchain

- Rust + `wasm32-unknown-unknown`
- `wasm-pack`
- Python + `UnityPy` + `TypeTreeGeneratorAPI`
- `vgmstream-cli` for FSB to WAV conversion
- `ilspycmd` for C# inspection
- AssetRipper is installed as a fallback GUI/headless tool

## Regenerate Assets

From the game root:

```powershell
py tools\extract_unity_assets.py --clean
py tools\extract_flowcharts.py
```

The Flowchart exporter loads `Aliya_Data/Managed` so custom Fungus commands such as `AliyaMessage`, `PlayerChoice`, `WaitTime`, and `ChangeBGMusic` are decoded with their real fields.

## Build WASM

```powershell
cd web-version\wasm-core
wasm-pack build --target web --out-dir ..\src\wasm\aliya_core --release
```

## Run

```powershell
cd web-version
npm install
npm run dev -- --host 127.0.0.1 --port 3001
```

Then open `http://127.0.0.1:3001/`.

## Desktop Packaging

Desktop builds keep the extracted assets in Electron `extraResources` and skip Vite's normal `public` directory copy. This avoids packaging the same assets once in `dist` and again under `resources/public`.

```powershell
npm run desktop:build:mac -- --arm64 --publish never
```

macOS builds produce both DMG and ZIP artifacts. The ZIP plus `latest-mac.yml` are required for long-term automatic updates through `electron-updater`; the DMG remains the first-install package.

## Current Runtime Coverage

Implemented in Rust/WASM:

- real Flowchart/Block command traversal
- Aliya text and image messages
- player choices and block jumps
- basic `If`/`Else`/`EndIf` choice grouping
- `WaitTime`/`DefaultChoice` wait events
- O2/H2O/ENG/heart-rate constants from `PlayerResMgr`
- background/music events by extracted audio id

Still incomplete for a true 1:1 game:

- full Fungus condition evaluation and variable operators
- all daily insert rules
- radio/EOG/EH interaction minigames
- exact Unity UI animation timing
- save/load parity with Unity `PlayerData`

The prototype is already data-driven by the original local assets, so the remaining work is mainly filling command semantics rather than replacing hardcoded demo dialogue.
