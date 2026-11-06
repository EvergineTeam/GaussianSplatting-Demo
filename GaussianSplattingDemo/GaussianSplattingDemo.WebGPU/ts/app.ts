class App {
  containerId!: string;
  canvasId!: string;
  program: Program;
  module: EvergineModule;
  static requestAnimationFrameCallback: ((d: any) => void) | undefined;

  // --- GPU frame pacing (WebGPU) ---
  // requestAnimationFrame fires at display rate whether or not the GPU is keeping up, so
  // submitting on every tick lets the GPU queue grow: the loop then counts frames that are
  // never presented (inflated fps plus input lag). Bounding the frames in flight keeps the
  // queue short, the reported rate honest and the view responsive.
  // Set to 0 to opt out and submit on every tick, as before.
  static maxFramesInFlight = 2;
  static readonly pacingTimeoutMs = 1000;
  static framesInFlight = 0;
  private static pacingListenerAttached = false;

  constructor(assemblyName: string, className: string, module: EvergineModule) {
    this.program = new Program(assemblyName, className);
    this.module = module;
  }

  startEvergine(
    containerId = "evergine-canvas-container",
    canvasId = "evergine-canvas"
  ) {
    this.containerId = containerId;
    this.canvasId = canvasId;

    let container = document.getElementById(this.containerId) as HTMLDivElement;
    if (!container) {
      alert(
        "Initialization failed: canvas container '" +
        this.containerId +
        "' not found."
      );
    }

    let canvas = document.createElement("canvas") as HTMLCanvasElement;
    canvas.id = this.canvasId;
    canvas.tabIndex = 1;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // As a default initial behavior, pop up an alert when webgl context is lost. To make your
    // application robust, you may want to override this behavior before shipping!
    // See http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.15.2
    canvas.addEventListener(
      "webglcontextlost",
      function (e) {
        alert("WebGL context lost. You will need to reload the page.");
        e.preventDefault();
      },
      false
    );

    this.module.canvas = canvas;
    container.appendChild(canvas);

    this.updateCanvasSize();
    window.addEventListener("resize", this.resizeAppSize.bind(this));

    App.setupFramePacing();

    this.waitAndRun();
  }

  destroyEvergine() {
    let container = document.getElementById(this.containerId) as HTMLDivElement;
    container.replaceChildren();
    this.program.Destroy(this.canvasId);
  }

  waitAndRun() {
    startAssetsDownloadIfNeeded();
    if (areAllAssetsLoaded()) {
      console.log("Running...");
      this.program.Run(this.canvasId);
    } else {
      setTimeout(this.waitAndRun.bind(this), 100);
    }
  }

  resizeAppSize() {
    this.updateCanvasSize();
    this.program.UpdateCanvasSize(this.canvasId);
  }

  // Reuses the device published by index.html before starting Evergine.
  private static getGpuDevice(): any {
    const blazor = (globalThis as any).Blazor;
    return (
      blazor?.runtime?.Module?.preinitializedWebGPUDevice ??
      (globalThis as any).Module?.preinitializedWebGPUDevice
    );
  }

  private static setupFramePacing() {
    if (App.pacingListenerAttached) {
      return;
    }

    App.pacingListenerAttached = true;

    // While the tab is hidden onSubmittedWorkDone() may never resolve, so the counter is
    // reset on the way back to avoid a permanently stalled loop.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        App.framesInFlight = 0;
      }
    });
  }

  static shouldSkipFrameForPacing(): boolean {
    return (
      App.maxFramesInFlight > 0 &&
      !!App.getGpuDevice() &&
      App.framesInFlight >= App.maxFramesInFlight
    );
  }

  static markFrameSubmitted() {
    if (App.maxFramesInFlight <= 0) {
      return;
    }

    let device = App.getGpuDevice();
    if (!device?.queue?.onSubmittedWorkDone) {
      return;
    }

    App.framesInFlight++;

    // Release the slot exactly once, whether the GPU reports completion, reports an error,
    // or never answers at all.
    let released = false;
    let release = () => {
      if (released) {
        return;
      }

      released = true;
      App.framesInFlight = Math.max(0, App.framesInFlight - 1);
    };

    device.queue.onSubmittedWorkDone().then(release, release);
    setTimeout(release, App.pacingTimeoutMs);
  }

  static hideSplash() {
    let splash = document.getElementById("splash");
    fadeOut(splash, 400, (el) => {
      el.remove();
    });
  }

  updateCanvasSize() {
    let devicePixelRatio = window.devicePixelRatio || 1;

    this.module.canvas.style.width = window.innerWidth + "px";
    this.module.canvas.style.height = window.innerHeight + "px";
    this.module.canvas.width = window.innerWidth * devicePixelRatio;
    this.module.canvas.height = window.innerHeight * devicePixelRatio;
  }

  warnUnsupportedBrowser() {
    App.hideSplash();
    let unsupportedBrowserErrorMessage = "Browser not supported";

    // Supposing Canvas2D is available
    let evergineCanvas = document.getElementById(
      this.canvasId
    ) as HTMLCanvasElement;
    evergineCanvas.setAttribute("style", "image-rendering: crisp-edges");
    let context = evergineCanvas.getContext("2d")!;
    context.fillStyle = "black";
    context.font = "16pt Arial";
    context.fillText(unsupportedBrowserErrorMessage, 4, 20);
  }
}
