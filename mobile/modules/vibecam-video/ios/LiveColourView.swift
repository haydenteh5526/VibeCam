import AVFoundation
import CoreImage
import ExpoModulesCore
import Metal
import QuartzCore
import UIKit

private final class ColourSurface: UIView {
  override class var layerClass: AnyClass { CAMetalLayer.self }
  var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
}

/// Adds one optional output to Expo's existing session. All session mutations use
/// its public sessionQueue; photos, audio and movie recording remain owned by Expo.
private final class PreviewFrames: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let output = AVCaptureVideoDataOutput()
  private let session: AVCaptureSession
  private let sessionQueue: DispatchQueue
  private let frames = DispatchQueue(label: "vibecam.preview.frames", qos: .userInitiated)
  private let slot = DispatchSemaphore(value: 1)
  private var lastFrame = 0.0 // Only accessed on the frame queue.
  weak var view: LiveColourView?

  init(camera: EXCameraInterface, view: LiveColourView) {
    session = camera.session
    sessionQueue = camera.sessionQueue
    self.view = view
    super.init()
  }

  func start() {
    sessionQueue.async { [self] in
      output.alwaysDiscardsLateVideoFrames = true
      output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      if #available(iOS 16.0, *) {
        output.automaticallyConfiguresOutputBufferDimensions = false
        output.deliversPreviewSizedOutputBuffers = true
      }
      session.beginConfiguration()
      guard session.canAddOutput(output) else {
        session.commitConfiguration()
        DispatchQueue.main.async { [weak self] in self?.view?.unavailable(self) }
        return
      }
      session.addOutput(output)
      if let connection = output.connection(with: .video) {
        // VibeCam locks its UI and camera preview to portrait.
        if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
        if connection.isVideoMirroringSupported {
          connection.automaticallyAdjustsVideoMirroring = false
          connection.isVideoMirrored = session.inputs.compactMap { $0 as? AVCaptureDeviceInput }
            .contains { $0.device.position == .front }
        }
      }
      output.setSampleBufferDelegate(self, queue: frames)
      session.commitConfiguration()
    }
  }

  func stop() {
    sessionQueue.async { [self] in
      output.setSampleBufferDelegate(nil, queue: nil)
      if session.outputs.contains(output) {
        session.beginConfiguration()
        session.removeOutput(output)
        session.commitConfiguration()
      }
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    guard now - lastFrame >= 1.0 / 24, slot.wait(timeout: .now()) == .success else { return }
    lastFrame = now
    guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { slot.signal(); return }
    // At most one retained camera buffer / GPU command, including work waiting on
    // the UI thread. Drop new frames instead of building a queue behind capture.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard let view else { slot.signal(); return }
      view.draw(pixel, from: self) { [self] in slot.signal() }
    }
  }
}

final class LiveColourView: ExpoView {
  let onStatus = EventDispatcher()
  var cubeBase64 = "" {
    didSet {
      guard cubeBase64 != oldValue else { return }
      filter = LookCube.decode(cubeBase64).flatMap(LookCube.filter)
      revision += 1
      surface.isHidden = true
      report("loading")
      DispatchQueue.main.async { [weak self] in self?.start() }
    }
  }
  private let surface = ColourSurface()
  private var context: CIContext?
  private var commands: MTLCommandQueue?
  private var filter: CIFilter?
  private var source: PreviewFrames?
  private var watchdog: Timer?
  private var lastPresented = 0.0
  private var revision = 0
  private var status = ""
  private var lifecycleObservers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    surface.isHidden = true
    addSubview(surface)
    lifecycleObservers = [
      NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.stop()
        self?.report("loading")
      },
      NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.start() }
    ]
    if let device = MTLCreateSystemDefaultDevice() {
      let layer = surface.metalLayer
      layer.device = device
      layer.pixelFormat = .bgra8Unorm
      layer.framebufferOnly = false
      layer.colorspace = LookCube.colourSpace
      layer.maximumDrawableCount = 2
      commands = device.makeCommandQueue()
      context = CIContext(mtlDevice: device, options: LookCube.contextOptions)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    surface.frame = bounds
    let scale = min(UIScreen.main.scale, 1280 / max(1, max(bounds.width, bounds.height)))
    surface.metalLayer.drawableSize = CGSize(width: max(1, (bounds.width * scale).rounded()),
                                             height: max(1, (bounds.height * scale).rounded()))
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { stop(); return }
    // Resolve our camera sibling after Fabric finishes mounting this finder.
    DispatchQueue.main.async { [weak self] in self?.start() }
  }

  private func start() {
    guard window != nil, source == nil, UIApplication.shared.applicationState == .active else { return }
    guard context != nil, commands != nil, filter != nil,
          let camera = cameraSibling() else { report("unavailable"); return }
    let frames = PreviewFrames(camera: camera, view: self)
    source = frames
    lastPresented = CACurrentMediaTime()
    frames.start()
    watchdog = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self, CACurrentMediaTime() - lastPresented > 1.5 else { return }
      // Never leave a frozen styled frame obscuring the working camera.
      unavailable(source)
    }
  }

  private func cameraSibling() -> EXCameraInterface? {
    func find(_ node: UIView) -> EXCameraInterface? {
      if let camera = node as? EXCameraInterface { return camera }
      for child in node.subviews where child !== self {
        if let camera = find(child) { return camera }
      }
      return nil
    }
    // CameraScreen keeps an uncollapsible parent around these two sibling views.
    // No React tags or legacy bridge lookup (unavailable in bridgeless Fabric).
    return superview.flatMap(find)
  }

  private func stop() {
    watchdog?.invalidate(); watchdog = nil
    source?.stop(); source = nil
    surface.isHidden = true
    context?.clearCaches()
  }

  fileprivate func unavailable(_ frames: PreviewFrames?) {
    guard frames === source else { return }
    stop()
    report("unavailable")
  }

  private func report(_ value: String) {
    guard status != value else { return }
    status = value
    onStatus(["status": value])
  }

  fileprivate func draw(_ pixel: CVPixelBuffer, from frames: PreviewFrames, done: @escaping () -> Void) {
    guard frames === source, window != nil, let filter, let context,
          bounds.width > 0, bounds.height > 0,
          let buffer = commands?.makeCommandBuffer(), let drawable = surface.metalLayer.nextDrawable()
    else { done(); return }
    let version = revision
    filter.setValue(CIImage(cvPixelBuffer: pixel), forKey: kCIInputImageKey)
    guard var image = filter.outputImage else { done(); unavailable(frames); return }
    // Do not let the reusable filter retain an extra camera buffer after this draw.
    filter.setValue(nil, forKey: kCIInputImageKey)
    let size = surface.metalLayer.drawableSize
    let scale = max(size.width / image.extent.width, size.height / image.extent.height)
    image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    image = image.transformed(by: CGAffineTransform(translationX: (size.width - image.extent.width) / 2 - image.extent.minX,
                                                     y: (size.height - image.extent.height) / 2 - image.extent.minY))
    context.render(image, to: drawable.texture, commandBuffer: buffer,
                   bounds: CGRect(origin: .zero, size: size), colorSpace: LookCube.colourSpace)
    buffer.present(drawable)
    buffer.addCompletedHandler { [weak self] command in
      // Explicitly keep the source buffer alive until Core Image finishes using it.
      withExtendedLifetime(pixel) { done() }
      DispatchQueue.main.async { [weak self] in
        guard let self, frames === source, version == revision else { return }
        guard command.status == .completed else { unavailable(frames); return }
        lastPresented = CACurrentMediaTime()
        surface.isHidden = false
        report("live")
      }
    }
    buffer.commit()
  }

  deinit {
    watchdog?.invalidate(); source?.stop()
    lifecycleObservers.forEach { NotificationCenter.default.removeObserver($0) }
  }
}
