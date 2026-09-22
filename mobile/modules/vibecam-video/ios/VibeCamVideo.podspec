Pod::Spec.new do |s|
  s.name             = 'VibeCamVideo'
  s.version          = '1.0.0'
  s.summary          = 'Offline digicam video looks for VibeCam'
  s.homepage         = 'https://github.com/haydenteh5526/vibe-cam'
  s.license          = { :type => 'MIT' }
  s.author           = { 'VibeCam' => 'rigbyx68@gmail.com' }
  s.source           = { :git => 'https://github.com/haydenteh5526/vibe-cam.git' }
  s.platform         = :ios, '15.1'
  s.swift_version    = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files     = '**/*.{h,m,mm,swift}'
end
