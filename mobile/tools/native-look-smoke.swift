import CoreImage
import Foundation
import CoreVideo
import Metal

struct Fixture: Decodable {
  struct Look: Decodable { let name: String; let cube: String; let expected: [[Double]] }
  let pixels: [[UInt8]]
  let looks: [Look]
}

@main enum NativeLookSmoke {
  static func main() throws {
    let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    let width = fixture.pixels.count
    let input: [UInt8] = fixture.pixels.flatMap { $0 + [UInt8(255)] }
    let image = CIImage(bitmapData: Data(input), bytesPerRow: width * 4, size: CGSize(width: width, height: 1),
                        format: .RGBA8, colorSpace: LookCube.colourSpace)
    let context = CIContext(options: LookCube.contextOptions)
    precondition(LookCube.decode("invalid") == nil)
    precondition(LookCube.decode(Data([0, 0, 0]).base64EncodedString()) == nil)
    for look in fixture.looks {
      let filter = LookCube.filter(LookCube.decode(look.cube)!)!
      filter.setValue(image, forKey: kCIInputImageKey)
      var output = [UInt8](repeating: 0, count: width * 4)
      context.render(filter.outputImage!, toBitmap: &output, rowBytes: width * 4,
                     bounds: image.extent, format: .RGBA8, colorSpace: LookCube.colourSpace)
      var maxError = 0.0
      for i in 0..<width {
        for channel in 0..<3 { maxError = max(maxError, abs(Double(output[i * 4 + channel]) - look.expected[i][channel])) }
        precondition(output[i * 4 + 3] == 255)
      }
      print("\(look.name): native colour maximum channel error \(maxError)/255 across \(width) colours")
      guard maxError < 3 else { throw NSError(domain: "Native colour differs from photo LUT", code: 1) }
    }
    try checkPreviewTexture()
  }

  static func checkPreviewTexture() throws {
    // Exercise the exact pixel-buffer -> aspect-fill -> Metal path used by the
    // live view. Different corners detect accidental vertical/horizontal flips.
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      throw NSError(domain: "Native preview test needs Metal", code: 2)
    }
    let context = CIContext(mtlCommandQueue: queue, options: LookCube.contextOptions)
    let colours: [[UInt8]] = [[40, 70, 200, 255], [190, 100, 30, 255], [80, 210, 50, 255], [200, 90, 160, 255]] // BGRA
    for (width, height) in [(24, 32), (32, 24)] {
      var optional: CVPixelBuffer?
      let result = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
                                      [kCVPixelBufferMetalCompatibilityKey: true] as CFDictionary, &optional)
      guard result == kCVReturnSuccess, let pixel = optional else { throw NSError(domain: "No preview buffer", code: 3) }
      CVPixelBufferLockBaseAddress(pixel, [])
      let bytes = CVPixelBufferGetBaseAddress(pixel)!.assumingMemoryBound(to: UInt8.self)
      let row = CVPixelBufferGetBytesPerRow(pixel)
      for y in 0..<height { for x in 0..<width {
        let colour = colours[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)]
        for c in 0..<4 { bytes[y * row + x * 4 + c] = colour[c] }
      } }
      CVPixelBufferUnlockBaseAddress(pixel, [])
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: 12, height: 16, mipmapped: false)
      descriptor.storageMode = .shared
      descriptor.usage = [.shaderRead, .shaderWrite, .renderTarget]
      let texture = device.makeTexture(descriptor: descriptor)!
      let command = queue.makeCommandBuffer()!
      let image = CIImage(cvPixelBuffer: pixel, options: [.colorSpace: LookCube.colourSpace])
      LookCube.renderPreview(image, context: context, texture: texture, commands: command)
      command.commit(); command.waitUntilCompleted()
      guard command.status == .completed else { throw command.error ?? NSError(domain: "Metal render failed", code: 4) }
      var rendered = [UInt8](repeating: 0, count: 12 * 16 * 4)
      texture.getBytes(&rendered, bytesPerRow: 12 * 4, from: MTLRegionMake2D(0, 0, 12, 16), mipmapLevel: 0)
      for (index, point) in [(1, 1), (10, 1), (1, 14), (10, 14)].enumerated() {
        let offset = (point.1 * 12 + point.0) * 4
        for c in 0..<4 {
          guard abs(Int(rendered[offset + c]) - Int(colours[index][c])) <= 2 else {
            throw NSError(domain: "Preview corner \(index): \(Array(rendered[offset..<(offset + 4)])), expected \(colours[index])", code: 5)
          }
        }
      }
      print("Native preview: \(width)x\(height) camera buffer -> 12x16 Metal texture preserves all four corners")
    }
  }
}
