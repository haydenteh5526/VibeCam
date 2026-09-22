import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

private enum VideoLookError: LocalizedError {
  case invalidSource
  case invalidLook
  case noVideoTrack
  case exportUnavailable
  case exportFailed
  case thumbnailFailed

  var errorDescription: String? {
    switch self {
    case .invalidSource: return "The recorded video is no longer available."
    case .invalidLook: return "The selected camera look could not be loaded."
    case .noVideoTrack: return "The recording contains no video."
    case .exportUnavailable: return "This iPhone cannot export the styled video."
    case .exportFailed: return "The styled video could not be exported. Your original is safe in Film Roll."
    case .thumbnailFailed: return "The video was saved, but its thumbnail could not be created."
    }
  }
}

public class VibeCamVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VibeCamVideo")

    // The full-resolution camera file and the same 17-point colour cube used by photos
    // remain on device. AVFoundation also carries the original audio track into the MP4.
    AsyncFunction("renderAsync") { (sourceUri: String, cameraId: String, cubeBase64: String, promise: Promise) in
      do {
        guard let source = URL(string: sourceUri), source.isFileURL,
              FileManager.default.fileExists(atPath: source.path) else { throw VideoLookError.invalidSource }
        let asset = AVURLAsset(url: source)
        guard !asset.tracks(withMediaType: .video).isEmpty else { throw VideoLookError.noVideoTrack }

        let cube: Data?
        if cameraId == "original" {
          cube = nil
        } else {
          guard let rgb = Data(base64Encoded: cubeBase64), rgb.count == 17 * 17 * 17 * 3 else {
            throw VideoLookError.invalidLook
          }
          var values = [Float32]()
          values.reserveCapacity(17 * 17 * 17 * 4)
          for i in stride(from: 0, to: rgb.count, by: 3) {
            values.append(Float32(rgb[i]) / 255)
            values.append(Float32(rgb[i + 1]) / 255)
            values.append(Float32(rgb[i + 2]) / 255)
            values.append(1)
          }
          cube = values.withUnsafeBytes { Data($0) }
        }

        if cube == nil {
          do { promise.resolve(["uri": source.absoluteString, "thumbnailUri": try self.makeThumbnail(source).absoluteString]) }
          catch { promise.reject(error) }
          return
        }

        let output = FileManager.default.temporaryDirectory.appendingPathComponent("vibecam_\(UUID().uuidString).mp4")
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720),
              exporter.supportedFileTypes.contains(.mp4) else { throw VideoLookError.exportUnavailable }

        let cubeData = cube!
        let colourSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        exporter.videoComposition = AVVideoComposition(asset: asset, applyingCIFiltersWithHandler: { request in
          guard let filter = CIFilter(name: "CIColorCubeWithColorSpace") else {
            request.finish(with: VideoLookError.invalidLook)
            return
          }
          filter.setValue(request.sourceImage, forKey: kCIInputImageKey)
          filter.setValue(17, forKey: "inputCubeDimension")
          filter.setValue(cubeData, forKey: "inputCubeData")
          filter.setValue(colourSpace, forKey: "inputColorSpace")
          guard let frame = filter.outputImage else {
            request.finish(with: VideoLookError.invalidLook)
            return
          }
          request.finish(with: frame.cropped(to: request.sourceImage.extent), context: nil)
        })
        exporter.outputURL = output
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true
        exporter.exportAsynchronously {
          guard exporter.status == .completed else {
            try? FileManager.default.removeItem(at: output)
            promise.reject(exporter.error ?? VideoLookError.exportFailed)
            return
          }
          do {
            let thumbnail = try self.makeThumbnail(output)
            promise.resolve(["uri": output.absoluteString, "thumbnailUri": thumbnail.absoluteString])
          } catch {
            // Export succeeded. Keep the video; the app can still save/share it.
            promise.resolve(["uri": output.absoluteString, "thumbnailUri": ""])
          }
        }
      } catch {
        promise.reject(error)
      }
    }
  }

  private func makeThumbnail(_ url: URL) throws -> URL {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 480, height: 480)
    let frame = try generator.copyCGImage(at: .zero, actualTime: nil)
    guard let bytes = UIImage(cgImage: frame).jpegData(compressionQuality: 0.82) else {
      throw VideoLookError.thumbnailFailed
    }
    let output = FileManager.default.temporaryDirectory.appendingPathComponent("vibecam_thumb_\(UUID().uuidString).jpg")
    try bytes.write(to: output, options: .atomic)
    return output
  }
}
