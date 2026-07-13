FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html demo.html app.js numr-calculator.js style.css /usr/share/nginx/html/
COPY favicon.ico favicon.png favicon.svg apple-touch-icon.png og-image.png numr-wordmark.svg /usr/share/nginx/html/
COPY pkg/core/numr_core.js pkg/core/numr_core_bg.wasm /usr/share/nginx/html/pkg/core/
COPY pkg/editor/numr_editor.js pkg/editor/numr_editor_bg.wasm /usr/share/nginx/html/pkg/editor/
EXPOSE 3000
