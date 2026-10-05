import CoreImage
import Foundation

struct Fixture: Decodable {
  struct Look: Decodable { let name: String; let cube: String; let expected: [[Double]] }
  let pixels: [[UInt8]]
  let looks: [Look]
}

@main enum NativeLookSmoke {
  static func main() throws {
    let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    let width = fixture.pixels.count
    let input = fixture.pixels.flatMap { $0 + [255] }
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
  }
}
