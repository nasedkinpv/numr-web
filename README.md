# numr-web

Web interface for the numr calculator, powered by WebAssembly.

## Quick Start

```bash
npm run serve
# Open http://localhost:8080
```

## Docker Deployment

```bash
docker build -t numr-web .
docker run -p 3000:3000 numr-web
```

## Development

### Prerequisites (for rebuilding WASM)

- [Rust](https://rustup.rs/) (stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

### Rebuilding WASM

Requires the main [numr](https://github.com/nasedkinpv/numr) repository:

```bash
# Clone with submodule
git clone --recursive https://github.com/nasedkinpv/numr
cd numr/numr-web

# Build WASM packages
./build.sh
# or
npm run build
```

## Features

- Real-time calculation as you type
- Syntax highlighting
- Local storage persistence
- Save/load .numr files
- Units, currencies, percentages, variables
- Exchange rate fetching (fiat + crypto)

## File Structure

```
numr-web/
├── index.html      # Main HTML page
├── style.css       # Styling
├── app.js          # Application
├── Dockerfile      # Docker deployment
├── nginx.conf      # Nginx config
├── pkg/            # WASM binaries (committed)
│   ├── core/       # numr-core WASM
│   └── editor/     # numr-editor WASM
└── build.sh        # WASM build script
```
