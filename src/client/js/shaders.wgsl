// LuminaHDR WebGPU Shader Pipeline
// High Dynamic Range floating-point rendering, color space transforms, and heatmap visualization

struct Uniforms {
  exposure: f32,       // 2.0 ^ ev
  gainMapWeight: f32,  // 0.0 to 1.0
  renderMode: u32,     // 0 = Full HDR, 1 = SDR Clamped, 2 = Heatmap, 3 = Split
  splitX: f32,         // 0.0 to 1.0 split position
};

@group(0) @binding(0) var hdrTexture: texture_2d<f32>;
@group(0) @binding(1) var hdrSampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var uv = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}

// False-color luminance heatmap mapping (Nits visualization)
fn luminanceHeatmap(lum: f32) -> vec3<f32> {
  // lum = 1.0 is ~203 nits (SDR Reference White)
  if (lum <= 1.0) {
    // SDR Range (0 - 203 nits): Muted grayscale
    let g = lum * 0.45;
    return vec3<f32>(g, g, g);
  } else if (lum <= 2.5) {
    // Moderate HDR Highlights (203 - 500 nits): Emerald to Cyan
    let t = (lum - 1.0) / 1.5;
    return mix(vec3<f32>(0.0, 0.8, 0.4), vec3<f32>(0.0, 0.9, 1.0), t);
  } else if (lum <= 5.0) {
    // High Dynamic Range (500 - 1000 nits): Yellow to Orange
    let t = (lum - 2.5) / 2.5;
    return mix(vec3<f32>(1.0, 0.9, 0.0), vec3<f32>(1.0, 0.45, 0.0), t);
  } else {
    // Extreme Specular Highlights (> 1000 nits): Magenta to Pure White
    let t = clamp((lum - 5.0) / 5.0, 0.0, 1.0);
    return mix(vec3<f32>(1.0, 0.0, 0.7), vec3<f32>(1.0, 1.0, 1.0), t);
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  var sample = textureSample(hdrTexture, hdrSampler, input.uv);
  
  // Apply linear exposure compensation
  var color = sample.rgb * uniforms.exposure;

  // Split Screen Comparison (Mode 3)
  var isLeftSplit = false;
  if (uniforms.renderMode == 3u) {
    if (input.uv.x < uniforms.splitX) {
      isLeftSplit = true;
    }
  }

  // SDR Clamping Mode (Mode 1 or Left Split)
  if (uniforms.renderMode == 1u || isLeftSplit) {
    color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(color, sample.a);
  }

  // False-Color HDR Heatmap Mode (Mode 2)
  if (uniforms.renderMode == 2u) {
    let luminance = dot(color, vec3<f32>(0.2627, 0.6780, 0.0593)); // Rec.2020 Luma
    let heatmapColor = luminanceHeatmap(luminance);
    return vec4<f32>(heatmapColor, 1.0);
  }

  // Mode 0: Full Unclamped Extended Dynamic Range
  // Values > 1.0 output directly to the rgba16float extended canvas to drive HDR display brightness!
  return vec4<f32>(color, sample.a);
}
