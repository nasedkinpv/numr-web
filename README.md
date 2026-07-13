# numr-web

Web interface and reusable custom element for [numr](https://github.com/nasedkinpv/numr), powered by the `numr-core` and `numr-editor` WebAssembly packages.

## Web Component

Use `<numr-calculator>` anywhere:

```html
<script type="module" src="https://numr.cc/numr-calculator.js?v=a3d2481f30"></script>

<numr-calculator></numr-calculator>
```

### Attributes

| Attribute | Description |
|---|---|
| `content` | Initial document content |
| `minimal` | Hide header and footer |
| `readonly` | Make the editor non-editable |
| `norates` | Skip cached and network exchange-rate loading |
| `autosave` | Persist the document to `localStorage` |
| `storage-key` | Override the autosave key |
| `base-path` | Override the base URL containing `pkg/core` and `pkg/editor` |

### Events

- `numr-ready`: WASM initialization completed.
- `numr-change`: Content or evaluation changed. `event.detail` is `{ content, results, totals }`.

### Methods

```js
const calc = document.querySelector("numr-calculator");
calc.getContent();
calc.setContent("price = $100\n+ 20%");
calc.clear();
calc.refreshRates();
calc.focus();
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

The package contains a self-contained web-component bundle, its TypeScript declaration, and both generated WASM packages under `pkg/core` and `pkg/editor`. Consumers do not need CDN runtime dependencies or a separate WASM download as long as they preserve this package layout or set `base-path` to an equivalent layout.

## Quick Start

The committed `pkg/` directory is ready to serve:

```bash
npm run check
npm run serve
# Open http://localhost:8080
```

To regenerate WASM first, use `npm run build` before `npm run serve`.

## Architecture

The standalone web app, native Electrobun view, and `<numr-calculator>` share one browser runtime:

- `NumrEditor` owns the CodeMirror document, native platform keymap, history, virtualized visible-line highlighting, line/error gutter, result gutter, and the single scroll surface.
- `NumrSession` wraps generated WASM classes, validates/parses their JSON payloads, and exposes document results, totals, variables, tokens, the core currency catalog, and rate application as plain JavaScript values.
- `RatesService` owns cache freshness, 10-second request timeouts, concurrent fiat/crypto requests, partial-provider success, coalesced refreshes, and request cleanup. Crypto provider IDs come from the core catalog; the local list is only a compatibility fallback for older WASM packages.
- `token-view` maps trusted tokenizer output to safe DOM nodes and CodeMirror decoration ranges without HTML injection.
- `wasm-loader` shares module imports and removes rejected imports from its cache so retries can recover.

The custom element is a native Shadow DOM element, not a second editor implementation. Bun builds local CodeMirror dependencies into the two committed browser entrypoints, so numr.cc, npm consumers, and Electrobun never depend on a runtime CDN.

## Development

### Repository Layout

`numr-web` is a separate Git repository, not a submodule. The build expects it beside the main workspace's `crates/` directory:

```bash
git clone https://github.com/nasedkinpv/numr.git
git clone https://github.com/nasedkinpv/numr-web.git numr/numr-web
cd numr/numr-web
```

This is also the layout created by web CI.

### Prerequisites

- Rust 1.88 or newer with the `wasm32-unknown-unknown` target
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- Node.js 22 or newer
- Bun 1.3 or newer

### Checks and Builds

```bash
# JavaScript syntax, version synchronization, and contract tests
npm run check

# Clean and rebuild both locked WASM packages and local browser bundles;
# then refresh generated asset query strings
npm run build

# Static local server
npm run serve
```

The core and editor builds use `--no-default-features --features wasm --locked`. Native Rust release builds optimize for runtime speed; these web entrypoints override `opt-level` to `z`, followed by `wasm-opt -Oz`, to keep artifacts small. `npm run build:frontend` rebuilds the browser entrypoints and asset stamps without rebuilding WASM; use it for the fast JavaScript/CSS loop when the committed WASM artifacts are already current.

`npm run check:versions` requires the main Cargo workspace, this package, `electrobun.config.ts`, and both generated WASM package manifests to use the same version. `npm run build` performs that check after regenerating the WASM manifests, so it works directly after a version bump.

Generated `pkg/` bindings and asset stamps are committed. CI rebuilds them and fails on any diff, so review and commit generated changes together with the source interface that produced them.

### Desktop development

```bash
bun install

# Fast loop for TypeScript, HTML, and CSS changes using the existing WASM build
npm run desktop:dev

# Regenerate WASM first after changing numr-core or numr-editor
npm run desktop:dev:fresh

# Reproducible stable package build, including a fresh WASM build
npm run desktop:build
```

`desktop:check` refreshes the shared browser bundle and bundles the native Bun and browser entrypoints independently before
Electrobun starts. `desktop:build:quick` produces the same stable package for local checks
when the committed `pkg/` artifacts are already current.

The desktop shell is controlled from its tray menu. It uses a frameless,
rounded transparent window with an in-app Hide button; on macOS it runs as an
accessory app without a Dock icon. Quit remains explicit in both the application
and tray menus.

## Docker Deployment

```bash
docker build -t numr-web .
docker run -p 3000:3000 numr-web
```

## Features

- Real-time document evaluation and syntax highlighting
- Variables, continuations, units, currencies, percentages, and grouped totals
- Local document persistence and self-contained share links
- Save/load `.numr` files
- Cached fiat and crypto exchange rates
- Reusable custom element with TypeScript declarations

## File Structure

```text
numr-web/
├── app.js                    # Standalone app view
├── numr-calculator.js        # Reusable custom element
├── numr-calculator.d.ts      # TypeScript public interface
├── src/
│   ├── web/app.js            # Standalone/desktop product shell
│   ├── component/            # Thin native custom element
│   └── shared/
│       ├── numr-editor.js    # Shared editor, gutters, keymap, viewport rendering
│       ├── numr-session.js   # Stable WASM adapter
│       ├── rates-service.js  # Browser rate/cache policy
│       ├── token-view.js     # Safe semantic-token DOM/ranges
│       └── wasm-loader.js    # Shared generated-module loading
├── tests/                    # Node contract tests
├── scripts/                  # Version and asset checks
├── pkg/
│   ├── core/                 # Generated numr-core WASM package
│   └── editor/               # Generated numr-editor WASM package
├── Dockerfile
└── nginx.conf
```
