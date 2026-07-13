#!/usr/bin/env swift

import AppKit
import Foundation

// TODO(desktop): Delete this generator when the temporary SF Symbol is replaced by our SVG tray icon.
let outputPath = CommandLine.arguments.dropFirst().first
    ?? "desktop/numr-tray-sf-template.png"

guard let symbol = NSImage(
    systemSymbolName: "plus.forwardslash.minus",
    accessibilityDescription: "numr"
) else {
    fputs("SF Symbol plus.forwardslash.minus is unavailable\n", stderr)
    exit(1)
}

let configuration = NSImage.SymbolConfiguration(
    pointSize: 28,
    weight: .medium,
    scale: .medium
)

guard let configuredSymbol = symbol.withSymbolConfiguration(configuration),
      let bitmap = NSBitmapImageRep(
          bitmapDataPlanes: nil,
          pixelsWide: 44,
          pixelsHigh: 44,
          bitsPerSample: 8,
          samplesPerPixel: 4,
          hasAlpha: true,
          isPlanar: false,
          colorSpaceName: .deviceRGB,
          bytesPerRow: 0,
          bitsPerPixel: 0
      ),
      let context = NSGraphicsContext(bitmapImageRep: bitmap)
else {
    fputs("Unable to create the tray icon bitmap\n", stderr)
    exit(1)
}

bitmap.size = NSSize(width: 44, height: 44)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 44, height: 44).fill()
configuredSymbol.draw(
    in: NSRect(x: 5, y: 5, width: 34, height: 34),
    from: .zero,
    operation: .sourceOver,
    fraction: 1
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Unable to encode the tray icon as PNG\n", stderr)
    exit(1)
}

try png.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
