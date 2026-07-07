# numr-web

Web interface for the numr calculator, powered by WebAssembly.

## Web Component

Use `<numr-calculator>` anywhere:

```html
<script type="module" src="https://numr.cc/numr-calculator.js?v=a9a4ada839"></script>

<numr-calculator></numr-calculator>
```

### Attributes

| Attribute | Description |
|-----------|-------------|
| `content` | Initial content |
| `minimal` | Hide header/footer |
| `readonly` | Non-editable |
| `norates` | Skip exchange rate fetching |
| `autosave` | Persist to localStorage |
| `storage-key` | Custom localStorage key |
| `base-path` | Custom WASM path |

### Events

- `numr-ready` - WASM initialized
- `numr-change` - Content changed (detail: `{ content, results, totals }`)

### Methods

```js
const calc = document.querySelector('numr-calculator');
calc.getContent();     // Get content
calc.setContent('..'); // Set content
calc.clear();          // Clear
calc.refreshRates();   // Refresh exchange rates
calc.focus();          // Focus editor
```

### Theming

```css
numr-calculator {
  --numr-bg-primary: #1a1c1e;
  --numr-bg-secondary: #1f2225;
  --numr-text-primary: #e8eaed;
  --numr-accent: #a8b4f4;
  --numr-success: #7dd3a8;
  --numr-error: #f4a8a8;
}
```

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

`npm run stamp:assets` refreshes the generated `?v=` asset query strings after JS, CSS, icon, or WASM changes.

Desktop smoke test: `bun install && bun run desktop:build` builds `build/dev-macos-arm64/numr-dev.app` on macOS.

## Features

- Real-time calculation as you type
- Syntax highlighting
- Local storage persistence
- Self-contained share links (document in URL hash)
- Save/load .numr files
- Units, currencies, percentages, variables
- Exchange rate fetching (fiat + crypto)

## File Structure

```
numr-web/
├── index.html           # Main app
├── numr-calculator.js   # Web component
├── numr-calculator.d.ts # TypeScript types
├── demo.html            # Component demo
├── app.js               # Main app logic
├── style.css            # Styles
├── pkg/                 # WASM binaries
│   ├── core/            # numr-core
│   └── editor/          # numr-editor
├── Dockerfile
├── nginx.conf
└── build.sh
```
