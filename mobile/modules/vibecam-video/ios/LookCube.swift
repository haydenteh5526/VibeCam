import CoreImage
import Foundation

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
}
