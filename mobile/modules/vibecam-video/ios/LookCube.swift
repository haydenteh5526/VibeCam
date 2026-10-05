import CoreImage
import Foundation
import Metal

/// The PNG strips and video tables both store red fastest, then green, then blue.
enum LookCube {
  static let size = 17
  static let colourSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  // Tables index encoded sRGB values, just like the photo shader. Core Image's
  // default linear working space would feed different coordinates into the cube.
  static let contextOptions: [CIContextOption: Any] = [
    .workingColorSpace: colourSpace, .outputColorSpace: colourSpace, .cacheIntermediates: false
  ]

  static func decode(_ base64: String) -> Data? {
    guard let rgb = Data(base64Encoded: base64), rgb.count == size * size * size * 3 else { return nil }
    var values = [Float32]()
    values.reserveCapacity(size * size * size * 4)
    for i in stride(from: 0, to: rgb.count, by: 3) {
      values.append(Float32(rgb[i]) / 255)
      values.append(Float32(rgb[i + 1]) / 255)
      values.append(Float32(rgb[i + 2]) / 255)
      values.append(1)
    }
    return values.withUnsafeBytes { Data($0) }
  }

  static func filter(_ data: Data) -> CIFilter? {
    guard let filter = CIFilter(name: "CIColorCubeWithColorSpace") else { return nil }
    filter.setValue(size, forKey: "inputCubeDimension")
    filter.setValue(data, forKey: "inputCubeData")
    filter.setValue(colourSpace, forKey: "inputColorSpace")
    return filter
  }

  static func renderPreview(_ input: CIImage, context: CIContext, texture: MTLTexture, commands: MTLCommandBuffer) {
    let size = CGSize(width: texture.width, height: texture.height)
    let scale = max(size.width / input.extent.width, size.height / input.extent.height)
    var image = input.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    image = image.transformed(by: CGAffineTransform(translationX: (size.width - image.extent.width) / 2 - image.extent.minX,
                                                     y: (size.height - image.extent.height) / 2 - image.extent.minY))
    context.render(image, to: texture, commandBuffer: commands,
                   bounds: CGRect(origin: .zero, size: size), colorSpace: colourSpace)
  }
}
