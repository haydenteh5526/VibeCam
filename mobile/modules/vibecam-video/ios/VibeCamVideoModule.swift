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
    // iOS 16 adds preview-sized buffers and movie/data-output coexistence. Older
    // iPhones keep the raw preview instead of allocating full-sensor frame pools.
    Constants(["hasLiveColourPreview": ProcessInfo.processInfo.isOperatingSystemAtLeast(
      OperatingSystemVersion(majorVersion: 16, minorVersion: 0, patchVersion: 0)
    )])
    View(LiveColourView.self) {
      Events("onStatus")
      Prop("cubeBase64") { (view: LiveColourView, cube: String) in view.cubeBase64 = cube }
    }

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
          guard let data = LookCube.decode(cubeBase64) else {
            throw VideoLookError.invalidLook
          }
          cube = data
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
        let colourContext = CIContext(options: LookCube.contextOptions)
        exporter.videoComposition = AVVideoComposition(asset: asset, applyingCIFiltersWithHandler: { request in
          guard let filter = LookCube.filter(cubeData) else {
            request.finish(with: VideoLookError.invalidLook)
            return
          }
          filter.setValue(request.sourceImage, forKey: kCIInputImageKey)
          guard let frame = filter.outputImage else {
            request.finish(with: VideoLookError.invalidLook)
            return
          }
          request.finish(with: frame.cropped(to: request.sourceImage.extent), context: colourContext)
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
