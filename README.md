# numr-web

Web interface and reusable custom element for [numr](https://github.com/nasedkinpv/numr), powered by the `numr-core` and `numr-editor` WebAssembly packages.

## Web Component

Use `<numr-calculator>` anywhere:

```html
<script type="module" src="https://numr.cc/numr-calculator.js?v=d088827366"></script>

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

The package file list includes the web component, its TypeScript declaration, shared runtime modules, and both generated WASM packages under `pkg/core` and `pkg/editor`. Consumers do not need a separate WASM download as long as they preserve this package layout or set `base-path` to an equivalent layout.

## Quick Start

The committed `pkg/` directory is ready to serve:

```bash
npm run check
npm run serve
# Open http://localhost:8080
```

To regenerate WASM first, use `npm run build` before `npm run serve`.

## Architecture

Both the standalone app and `<numr-calculator>` use the same small adapters:

- `NumrSession` wraps generated WASM classes, validates/parses their JSON payloads, and exposes document results, totals, variables, tokens, the core currency catalog, and rate application as plain JavaScript values.
- `RatesService` owns cache freshness, 10-second request timeouts, concurrent fiat/crypto requests, partial-provider success, coalesced refreshes, and request cleanup. Crypto provider IDs come from the core catalog; the local list is only a compatibility fallback for older WASM packages.
- `token-renderer` owns escaped semantic-token HTML so the app and component cannot drift.
- `wasm-loader` shares module imports and removes rejected imports from its cache so retries can recover.

Views own DOM and product behavior; shared adapters own generated-WASM and rate-provider contracts.

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

### Checks and Builds

```bash
# JavaScript syntax, version synchronization, and contract tests
npm run check

# Clean and rebuild both locked, no-default-feature WASM packages;
# then refresh generated asset query strings
npm run build

# Static local server
npm run serve
```

The core and editor builds use `--no-default-features --features wasm --locked`. Native Rust release builds optimize for runtime speed; these web entrypoints override `opt-level` to `z`, followed by `wasm-opt -Oz`, to keep artifacts small.

`npm run check:versions` requires the main Cargo workspace, this package, `electrobun.config.ts`, and both generated WASM package manifests to use the same version. `npm run build` performs that check after regenerating the WASM manifests, so it works directly after a version bump.

Generated `pkg/` bindings and asset stamps are committed. CI rebuilds them and fails on any diff, so review and commit generated changes together with the source interface that produced them.

Desktop smoke test on macOS:

```bash
bun install
bun run desktop:build
```

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
├── src/shared/
│   ├── numr-session.js       # Stable WASM adapter
│   ├── rates-service.js      # Browser rate/cache policy
│   ├── token-renderer.js     # Shared safe token HTML
│   └── wasm-loader.js        # Shared generated-module loading
├── tests/                    # Node contract tests
├── scripts/                  # Version and asset checks
├── pkg/
│   ├── core/                 # Generated numr-core WASM package
│   └── editor/               # Generated numr-editor WASM package
├── build.sh
├── Dockerfile
└── nginx.conf
```
