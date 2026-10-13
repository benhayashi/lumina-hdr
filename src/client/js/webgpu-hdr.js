/**
 * LuminaHDR WebGPU Extended Range Pipeline
 * Configures 16-bit floating point canvas and renders HDR textures with WGSL shaders
 */

export class WebGPUHDRRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.sampler = null;
    this.uniformBuffer = null;
    this.bindGroupLayout = null;
    this.currentTexture = null;
    this.currentBindGroup = null;

    this.exposureEV = 0.0;
    this.renderMode = 0; // 0=HDR, 1=SDR, 2=Heatmap, 3=Split
    this.splitX = 0.5;
    this.isReady = false;
  }

  async init() {
    if (!navigator.gpu) {
      console.warn('[WebGPU] navigator.gpu not available in this environment');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      this.context = this.canvas.getContext('webgpu');

      // Configure rgba16float extended dynamic range canvas
      const config = {
        device: this.device,
        format: 'rgba16float',
        colorSpace: 'display-p3',
        alphaMode: 'premultiplied',
        toneMapping: { mode: 'extended' }
      };

      try {
        this.context.configure(config);
      } catch (e) {
        // Fallback without extended if browser older
        delete config.toneMapping;
        this.context.configure(config);
      }

      // Load WGSL shader
      const shaderRes = await fetch('/js/shaders.wgsl');
      const shaderCode = await shaderRes.text();
      const shaderModule = this.device.createShaderModule({ code: shaderCode });

      // Create Sampler
      this.sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
      });

      // Create Uniform Buffer (4 floats = 16 bytes)
      this.uniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      // Bind Group Layout
      this.bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
      });

      // Pipeline Layout
      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      });

      // Render Pipeline
      this.pipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main'
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format: 'rgba16float' }]
        },
        primitive: {
          topology: 'triangle-strip'
        }
      });

      this.isReady = true;
      this.updateUniforms();
      return true;
    } catch (err) {
      console.error('[WebGPU] Init failed:', err);
      return false;
    }
  }

  updateUniforms() {
    if (!this.device || !this.uniformBuffer) return;
    const array = new ArrayBuffer(16);
    const floatView = new Float32Array(array);
    const uintView = new Uint32Array(array);

    floatView[0] = Math.pow(2.0, this.exposureEV); // exposure factor
    floatView[1] = 1.0;                           // gainMapWeight
    uintView[2] = this.renderMode;                // renderMode (0, 1, 2, 3)
    floatView[3] = this.splitX;                    // splitX

    this.device.queue.writeBuffer(this.uniformBuffer, 0, array);
  }

  loadFloatData(width, height, float32Data) {
    if (!this.device || !this.isReady) return;

    this.canvas.width = width;
    this.canvas.height = height;

    this.currentTexture = this.device.createTexture({
      size: [width, height],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    this.device.queue.writeTexture(
      { texture: this.currentTexture },
      float32Data.buffer,
      { bytesPerRow: width * 16 },
      [width, height]
    );

    this.currentBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.currentTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.render();
  }

  setExposure(ev) {
    this.exposureEV = ev;
    this.updateUniforms();
    this.render();
  }

  setRenderMode(mode) {
    this.renderMode = mode;
    this.updateUniforms();
    this.render();
  }

  setSplitX(ratio) {
    this.splitX = ratio;
    this.updateUniforms();
    this.render();
  }

  render() {
    if (!this.device || !this.currentBindGroup || !this.pipeline) return;

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.currentBindGroup);
    passEncoder.draw(4);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}
