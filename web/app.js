import {
  animationStarted,
  AutoPrintRegExp,
  DEFAULT_SCALE_VALUE,
  EventBus,
  generateRandomStringForSandbox,
  getActiveOrFocusedElement,
  getPDFFileNameFromURL,
  isValidRotation,
  isValidScrollMode,
  isValidSpreadMode,
  MAX_SCALE,
  MIN_SCALE,
  noContextMenuHandler,
  normalizeWheelEventDirection,
  parseQueryString,
  PresentationModeState,
  ProgressBar,
  RendererType,
  ScrollMode,
  SpreadMode,
  TextLayerMode,
} from "./ui_utils.js";
import { AppOptions, OptionKind } from "./app_options.js";
import {
  build,
  createPromiseCapability,
  getDocument,
  getFilenameFromUrl,
  GlobalWorkerOptions,
  InvalidPDFException,
  LinkTarget,
  loadScript,
  MissingPDFException,
  OPS,
  PDFWorker,
  PermissionFlag,
  shadow,
  UnexpectedResponseException,
  UNSUPPORTED_FEATURES,
  version,
} from "pdfjs-lib";
import { CursorTool, PDFCursorTools } from "./pdf_cursor_tools.js";
import { PDFRenderingQueue, RenderingStates } from "./pdf_rendering_queue.js";
import { PDFSidebar, SidebarView } from "./pdf_sidebar.js";
import { OverlayManager } from "./overlay_manager.js";
import { PasswordPrompt } from "./password_prompt.js";
import { PDFAttachmentViewer } from "./pdf_attachment_viewer.js";
import { PDFDocumentProperties } from "./pdf_document_properties.js";
import { PDFFindBar } from "./pdf_find_bar.js";
import { PDFFindController } from "./pdf_find_controller.js";
import { PDFHistory } from "./pdf_history.js";
import { PDFLayerViewer } from "./pdf_layer_viewer.js";
import { PDFLinkService } from "./pdf_link_service.js";
import { PDFOutlineViewer } from "./pdf_outline_viewer.js";
import { PDFPresentationMode } from "./pdf_presentation_mode.js";
import { PDFSidebarResizer } from "./pdf_sidebar_resizer.js";
import { PDFThumbnailViewer } from "./pdf_thumbnail_viewer.js";
import { PDFViewer } from "./pdf_viewer.js";
import { SecondaryToolbar } from "./secondary_toolbar.js";
import { Toolbar } from "./toolbar.js";
import { viewerCompatibilityParams } from "./viewer_compatibility.js";
import { ViewHistory } from "./view_history.js";

const DEFAULT_SCALE_DELTA = 1.1;
const DISABLE_AUTO_FETCH_LOADING_BAR_TIMEOUT = 5000; // ms
const FORCE_PAGES_LOADED_TIMEOUT = 10000; // ms
const WHEEL_ZOOM_DISABLED_TIMEOUT = 1000; // ms
const ENABLE_PERMISSIONS_CLASS = "enablePermissions";

const ViewOnLoad = {
  UNKNOWN: -1,
  PREVIOUS: 0, // Default value.
  INITIAL: 1,
};

// Keep these in sync with mozilla-central's Histograms.json.
const KNOWN_VERSIONS = [
  "1.0",
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
  "1.6",
  "1.7",
  "1.8",
  "1.9",
  "2.0",
  "2.1",
  "2.2",
  "2.3",
];
// Keep these in sync with mozilla-central's Histograms.json.
const KNOWN_GENERATORS = [
  "acrobat distiller",
  "acrobat pdfwriter",
  "adobe livecycle",
  "adobe pdf library",
  "adobe photoshop",
  "ghostscript",
  "tcpdf",
  "cairo",
  "dvipdfm",
  "dvips",
  "pdftex",
  "pdfkit",
  "itext",
  "prince",
  "quarkxpress",
  "mac os x",
  "microsoft",
  "openoffice",
  "oracle",
  "luradocument",
  "pdf-xchange",
  "antenna house",
  "aspose.cells",
  "fpdf",
];

class DefaultExternalServices {
  constructor() {
    throw new Error("Cannot initialize DefaultExternalServices.");
  }

  static updateFindControlState(data) {}

  static updateFindMatchesCount(data) {}

  static initPassiveLoading(callbacks) {}

  static fallback(data, callback) {}

  static reportTelemetry(data) {}

  static createDownloadManager(options) {
    throw new Error("Not implemented: createDownloadManager");
  }

  static createPreferences() {
    throw new Error("Not implemented: createPreferences");
  }

  static createL10n(options) {
    throw new Error("Not implemented: createL10n");
  }

  static get supportsIntegratedFind() {
    return shadow(this, "supportsIntegratedFind", false);
  }

  static get supportsDocumentFonts() {
    return shadow(this, "supportsDocumentFonts", true);
  }

  static get supportedMouseWheelZoomModifierKeys() {
    return shadow(this, "supportedMouseWheelZoomModifierKeys", {
      ctrlKey: true,
      metaKey: true,
    });
  }

  static get isInAutomation() {
    return shadow(this, "isInAutomation", false);
  }

  static get scripting() {
    throw new Error("Not implemented: scripting");
  }
}

const PDFViewerApplication = {
  initialBookmark: document.location.hash.substring(1),
  _initializedCapability: createPromiseCapability(),
  fellback: false,
  appConfig: null,
  pdfDocument: null,
  pdfLoadingTask: null,
  printService: null,
  pdfViewer: null, // PDFViewer
  pdfThumbnailViewer: null, //PDFThumbnailViewer
  pdfRenderingQueue: null, // PDFRenderingQueue
  pdfPresentationMode: null, // PDFPresentationMode
  pdfDocumentProperties: null, // PDFDocumentProperties
  pdfLinkService: null, // PDFLinkService
  pdfHistory: null, // PDFHistory
  pdfSidebar: null, // PDFSidebar
  pdfSidebarResizer: null, // PDFSidebarResizer
  pdfOutlineViewer: null, // PDFOutlineViewer
  pdfAttachmentViewer: null, // PDFAttachmentViewer
  pdfLayerViewer: null, // PDFLayerViewer
  pdfCursorTools: null, // PDFCursorTools
  store: null, // ViewHistory
  downloadManager: null, // DownloadManager
  overlayManager: null, // OverlayManager
  preferences: null, // Preferences
  toolbar: null, // Toolbar
  secondaryToolbar: null, // SecondaryToolbar
  eventBus: null, // EventBus
  l10n: null, // IL10n
  isInitialViewSet: false,
  downloadComplete: false,
  isViewerEmbedded: window.parent !== window,
  url: "",
  baseUrl: "",
  externalServices: DefaultExternalServices,
  _boundEvents: {},
  contentDispositionFilename: null,
  triggerDelayedFallback: null,
  _saveInProgress: false,
  _wheelUnusedTicks: 0,
  _idleCallbacks: new Set(),

  // Called once when the document is loaded.
  async initialize(appConfig) {
    this.preferences = this.externalServices.createPreferences();
    this.appConfig = appConfig;

    await this._readPreferences();
    // await this._parseHashParameters();
    await this._initializeL10n();

    await this._initializeViewerComponents();

    // Bind the various event handlers *after* the viewer has been
    // initialized, to prevent errors if an event arrives too soon.
    this.bindEvents();
    // this.bindWindowEvents();

    // We can start UI localization now.
    const appContainer = appConfig.appContainer || document.documentElement;
    this.l10n.translate(appContainer).then(() => {
      // Dispatch the 'localized' event on the `eventBus` once the viewer
      // has been fully initialized and translated.
      this.eventBus.dispatch("localized", { source: this });
    });

    this._initializedCapability.resolve();
  },

  async _readPreferences() {
    if (
      (typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || GENERIC")) &&
      AppOptions.get("disablePreferences")
    ) {
      // Give custom implementations of the default viewer a simpler way to
      // opt-out of having the `Preferences` override existing `AppOptions`.
      return;
    }
    try {
      const prefs = await this.preferences.getAll();
      for (const name in prefs) {
        AppOptions.set(name, prefs[name]);
      }
    } catch (reason) {
      console.error(`_readPreferences: "${reason.message}".`);
    }
  },

  // 从url中解析一些参数，用于改变配置，
  async _parseHashParameters() {
    if (!AppOptions.get("pdfBugEnabled")) {
      return undefined;
    }
    const hash = document.location.hash.substring(1);
    if (!hash) {
      return undefined;
    }
    const hashParams = parseQueryString(hash),
      waitOn = [];

    if ("disableworker" in hashParams && hashParams.disableworker === "true") {
      waitOn.push(loadFakeWorker());
    }
    if ("disablerange" in hashParams) {
      AppOptions.set("disableRange", hashParams.disablerange === "true");
    }
    if ("disablestream" in hashParams) {
      AppOptions.set("disableStream", hashParams.disablestream === "true");
    }
    if ("disableautofetch" in hashParams) {
      AppOptions.set(
        "disableAutoFetch",
        hashParams.disableautofetch === "true"
      );
    }
    if ("disablefontface" in hashParams) {
      AppOptions.set("disableFontFace", hashParams.disablefontface === "true");
    }
    if ("disablehistory" in hashParams) {
      AppOptions.set("disableHistory", hashParams.disablehistory === "true");
    }
    if ("webgl" in hashParams) {
      AppOptions.set("enableWebGL", hashParams.webgl === "true");
    }
    if ("verbosity" in hashParams) {
      AppOptions.set("verbosity", hashParams.verbosity | 0);
    }
    if ("textlayer" in hashParams) {
      switch (hashParams.textlayer) {
        case "off":
          AppOptions.set("textLayerMode", TextLayerMode.DISABLE);
          break;
        case "visible":
        case "shadow":
        case "hover":
          const viewer = this.appConfig.viewerContainer;
          viewer.classList.add("textLayer-" + hashParams.textlayer);
          break;
      }
    }
    if ("pdfbug" in hashParams) {
      AppOptions.set("pdfBug", true);
      AppOptions.set("fontExtraProperties", true);

      const enabled = hashParams.pdfbug.split(",");
      waitOn.push(loadAndEnablePDFBug(enabled));
    }
    // It is not possible to change locale for the (various) extension builds.
    if (
      (typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || GENERIC")) &&
      "locale" in hashParams
    ) {
      AppOptions.set("locale", hashParams.locale);
    }

    return Promise.all(waitOn).catch(reason => {
      console.error(`_parseHashParameters: "${reason.message}".`);
    });
  },


  async _initializeL10n() {
    var par =
      typeof PDFJSDev === "undefined" || PDFJSDev.test("!PRODUCTION || GENERIC")
        ? { locale: AppOptions.get("locale") }
        : null;
    this.l10n = this.externalServices.createL10n(par);
    const dir = await this.l10n.getDirection();
    document.getElementsByTagName("html")[0].dir = dir;
  },

  async _initializeViewerComponents() {
    const appConfig = this.appConfig;


    const eventBus =
      appConfig.eventBus ||
      new EventBus({ isInAutomation: this.externalServices.isInAutomation });
    this.eventBus = eventBus;

    this.overlayManager = new OverlayManager();

    const pdfRenderingQueue = new PDFRenderingQueue();
    pdfRenderingQueue.onIdle = this.cleanup.bind(this);
    this.pdfRenderingQueue = pdfRenderingQueue;

    const pdfLinkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: AppOptions.get("externalLinkTarget"),
      externalLinkRel: AppOptions.get("externalLinkRel"),
      ignoreDestinationZoom: AppOptions.get("ignoreDestinationZoom"),
    });
    this.pdfLinkService = pdfLinkService;


    // const downloadManager = this.externalServices.createDownloadManager();
    // this.downloadManager = downloadManager;

    // 查看 搜索
    // const findController = new PDFFindController({
    //   linkService: pdfLinkService,
    //   eventBus,
    // });
    // this.findController = findController;

    const container = appConfig.mainContainer;
    const viewer = appConfig.viewerContainer;

    // 主要页面
    this.pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      renderingQueue: pdfRenderingQueue,
      linkService: pdfLinkService,
      // downloadManager,
      // findController,
      renderer: AppOptions.get("renderer"),
      enableWebGL: AppOptions.get("enableWebGL"),
      l10n: this.l10n,
      textLayerMode: AppOptions.get("textLayerMode"),
      imageResourcesPath: AppOptions.get("imageResourcesPath"),
      renderInteractiveForms: AppOptions.get("renderInteractiveForms"),
      enablePrintAutoRotate: AppOptions.get("enablePrintAutoRotate"),
      useOnlyCssZoom: AppOptions.get("useOnlyCssZoom"),
      maxCanvasPixels: AppOptions.get("maxCanvasPixels"),
    });
    pdfRenderingQueue.setViewer(this.pdfViewer);
    pdfLinkService.setViewer(this.pdfViewer);

    // 缩略图
    this.pdfThumbnailViewer = new PDFThumbnailViewer({
      container: appConfig.sidebar.thumbnailView,
      eventBus,
      renderingQueue: pdfRenderingQueue,
      linkService: pdfLinkService,
      l10n: this.l10n,
    });
    pdfRenderingQueue.setThumbnailViewer(this.pdfThumbnailViewer);

    // this.pdfHistory = new PDFHistory({
    //   linkService: pdfLinkService,
    //   eventBus,
    // });
    // pdfLinkService.setHistory(this.pdfHistory);
    

    if (!this.supportsIntegratedFind) {
      this.findBar = new PDFFindBar(appConfig.findBar, eventBus, this.l10n);
    }

    // this.pdfDocumentProperties = new PDFDocumentProperties(
    //   appConfig.documentProperties,
    //   this.overlayManager,
    //   eventBus,
    //   this.l10n
    // );

    // this.pdfCursorTools = new PDFCursorTools({
    //   container,
    //   eventBus,
    //   cursorToolOnLoad: AppOptions.get("cursorToolOnLoad"),
    // });

    this.toolbar = new Toolbar(appConfig.toolbar, eventBus, this.l10n);

    this.secondaryToolbar = new SecondaryToolbar(
      appConfig.secondaryToolbar,
      container,
      eventBus
    );
    
    // 带密码的 pdf 文件
    this.passwordPrompt = new PasswordPrompt(
      appConfig.passwordOverlay,
      this.overlayManager,
      this.l10n
    );

    // 大纲视图
    this.pdfOutlineViewer = new PDFOutlineViewer({
      container: appConfig.sidebar.outlineView,
      eventBus,
      linkService: pdfLinkService,
    });


    // 附件
    this.pdfAttachmentViewer = new PDFAttachmentViewer({
      container: appConfig.sidebar.attachmentsView,
      eventBus,
      // downloadManager,
    });


    // 图层
    this.pdfLayerViewer = new PDFLayerViewer({
      container: appConfig.sidebar.layersView,
      eventBus,
      l10n: this.l10n,
    });

    // 侧边栏
    this.pdfSidebar = new PDFSidebar({
      elements: appConfig.sidebar,
      pdfViewer: this.pdfViewer,
      pdfThumbnailViewer: this.pdfThumbnailViewer,
      eventBus,
      l10n: this.l10n,
    });
    this.pdfSidebar.onToggled = this.forceRendering.bind(this);

    // 侧边栏 宽度调整
    this.pdfSidebarResizer = new PDFSidebarResizer(
      appConfig.sidebarResizer,
      eventBus,
      this.l10n
    );
  },

  run(config) {
    this.initialize(config).then(webViewerInitialized);
  },

  get initialized() {
    return this._initializedCapability.settled;
  },

  get initializedPromise() {
    return this._initializedCapability.promise;
  },

  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  },

  get page() {
    return this.pdfViewer.currentPageNumber;
  },

  set page(val) {
    this.pdfViewer.currentPageNumber = val;
  },

  get supportsFullscreen() {
    let support;
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      support =
        document.fullscreenEnabled === true ||
        document.mozFullScreenEnabled === true;
    } else {
      const doc = document.documentElement;
      support = !!(
        doc.requestFullscreen ||
        doc.mozRequestFullScreen ||
        doc.webkitRequestFullScreen
      );

      if (
        document.fullscreenEnabled === false ||
        document.mozFullScreenEnabled === false ||
        document.webkitFullscreenEnabled === false
      ) {
        support = false;
      }
    }
    return shadow(this, "supportsFullscreen", support);
  },

  get supportsIntegratedFind() {
    return this.externalServices.supportsIntegratedFind;
  },

  get supportsDocumentFonts() {
    return this.externalServices.supportsDocumentFonts;
  },

  get loadingBar() {
    const bar = new ProgressBar("#loadingBar");
    return shadow(this, "loadingBar", bar);
  },

  get supportedMouseWheelZoomModifierKeys() {
    return this.externalServices.supportedMouseWheelZoomModifierKeys;
  },

  initPassiveLoading() {
    if (
      typeof PDFJSDev === "undefined" ||
      !PDFJSDev.test("MOZCENTRAL || CHROME")
    ) {
      throw new Error("Not implemented: initPassiveLoading");
    }
    this.externalServices.initPassiveLoading({
      onOpenWithTransport(url, length, transport) {
        PDFViewerApplication.open(url, { length, range: transport });
      },
      onOpenWithData(data) {
        PDFViewerApplication.open(data);
      },
      onOpenWithURL(url, length, originalUrl) {
        let file = url,
          args = null;
        if (length !== undefined) {
          args = { length };
        }
        if (originalUrl !== undefined) {
          file = { url, originalUrl };
        }
        PDFViewerApplication.open(file, args);
      },
      onError(err) {
        PDFViewerApplication.l10n
          .get(
            "loading_error",
            null,
            "An error occurred while loading the PDF."
          )
          .then(msg => {
            PDFViewerApplication.error(msg, err);
          });
      },
      onProgress(loaded, total) {
        PDFViewerApplication.progress(loaded / total);
      },
    });
  },

  setTitleUsingUrl(url = "") {
    this.url = url;
    this.baseUrl = url.split("#")[0];
    let title = getPDFFileNameFromURL(url, "");
    if (!title) {
      try {
        title = decodeURIComponent(getFilenameFromUrl(url)) || url;
      } catch (ex) {
        // decodeURIComponent may throw URIError,
        // fall back to using the unprocessed url in that case
        title = url;
      }
    }
    this.setTitle(title);
  },

  setTitle(title) {
    if (this.isViewerEmbedded) {
      // Embedded PDF viewers should not be changing their parent page's title.
      return;
    }
    document.title = title;
  },

  /**
   * Closes opened PDF document.
   * @returns {Promise} - Returns the promise, which is resolved when all
   *                      destruction is completed.
   */
  async close() {
    const errorWrapper = this.appConfig.errorWrapper.container;
    errorWrapper.setAttribute("hidden", "true");

    if (!this.pdfLoadingTask) {
      return undefined;
    }

    const promise = this.pdfLoadingTask.destroy();
    this.pdfLoadingTask = null;

    if (this.pdfDocument) {
      this.pdfDocument = null;

      this.pdfThumbnailViewer.setDocument(null);
      this.pdfViewer.setDocument(null);
      this.pdfLinkService.setDocument(null);
      // this.pdfDocumentProperties.setDocument(null);
    }
    webViewerResetPermissions();
    this.store = null;
    this.isInitialViewSet = false;
    this.downloadComplete = false;
    this.url = "";
    this.baseUrl = "";
    this.contentDispositionFilename = null;
    this.triggerDelayedFallback = null;
    this._saveInProgress = false;
    for (const callback of this._idleCallbacks) {
      window.cancelIdleCallback(callback);
    }
    this._idleCallbacks.clear();

    this.pdfSidebar.reset();
    this.pdfOutlineViewer.reset();
    this.pdfAttachmentViewer.reset();
    this.pdfLayerViewer.reset();

    if (this.pdfHistory) {
      this.pdfHistory.reset();
    }
    if (this.findBar) {
      this.findBar.reset();
    }
    this.toolbar.reset();
    this.secondaryToolbar.reset();

    if (typeof PDFBug !== "undefined") {
      PDFBug.cleanup();
    }
    return promise;
  },

  /**
   * Opens PDF document specified by URL or array with additional arguments.
   * @param {string|TypedArray|ArrayBuffer} file - PDF location or binary data.
   * @param {Object} [args] - Additional arguments for the getDocument call,
   *                          e.g. HTTP headers ('httpHeaders') or alternative
   *                          data transport ('range').
   * @returns {Promise} - Returns the promise, which is resolved when document
   *                      is opened.
   */
  async open(file, args) {
    if (this.pdfLoadingTask) {
      // We need to destroy already opened document.
      await this.close();
    }
    // Set the necessary global worker parameters, using the available options.
    const workerParameters = AppOptions.getAll(OptionKind.WORKER);
    for (const key in workerParameters) {
      GlobalWorkerOptions[key] = workerParameters[key];
    }

    const parameters = Object.create(null);
    if (typeof file === "string") {
      // URL
      this.setTitleUsingUrl(file);
      parameters.url = file;
    } else if (file && "byteLength" in file) {
      // ArrayBuffer
      parameters.data = file;
    } else if (file.url && file.originalUrl) {
      this.setTitleUsingUrl(file.originalUrl);
      parameters.url = file.url;
    }
    // Set the necessary API parameters, using the available options.
    const apiParameters = AppOptions.getAll(OptionKind.API);
    for (const key in apiParameters) {
      let value = apiParameters[key];

      if (key === "docBaseUrl" && !value) {
        if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("PRODUCTION")) {
          value = document.URL.split("#")[0];
        } else if (PDFJSDev.test("MOZCENTRAL || CHROME")) {
          value = this.baseUrl;
        }
      }
      parameters[key] = value;
    }

    if (args) {
      for (const key in args) {
        const value = args[key];

        if (key === "length") {
          // this.pdfDocumentProperties.setFileSize(value);
        }
        parameters[key] = value;
      }
    }

    const loadingTask = getDocument(parameters);
    this.pdfLoadingTask = loadingTask;

    loadingTask.onPassword = (updateCallback, reason) => {
      this.pdfLinkService.externalLinkEnabled = false;
      this.passwordPrompt.setUpdateCallback(updateCallback, reason);
      this.passwordPrompt.open();
    };

    loadingTask.onProgress = ({ loaded, total }) => {
      this.progress(loaded / total);
    };

    // Listen for unsupported features to trigger the fallback UI.
    loadingTask.onUnsupportedFeature = this.fallback.bind(this);

    return loadingTask.promise.then(
      pdfDocument => {
        this.load(pdfDocument);
      },
      exception => {
        if (loadingTask !== this.pdfLoadingTask) {
          return undefined; // Ignore errors for previously opened PDF files.
        }

        const message = exception?.message;
        let loadingErrorMessage;
        if (exception instanceof InvalidPDFException) {
          // change error message also for other builds
          loadingErrorMessage = this.l10n.get(
            "invalid_file_error",
            null,
            "Invalid or corrupted PDF file."
          );
        } else if (exception instanceof MissingPDFException) {
          // special message for missing PDF's
          loadingErrorMessage = this.l10n.get(
            "missing_file_error",
            null,
            "Missing PDF file."
          );
        } else if (exception instanceof UnexpectedResponseException) {
          loadingErrorMessage = this.l10n.get(
            "unexpected_response_error",
            null,
            "Unexpected server response."
          );
        } else {
          loadingErrorMessage = this.l10n.get(
            "loading_error",
            null,
            "An error occurred while loading the PDF."
          );
        }

        return loadingErrorMessage.then(msg => {
          this.error(msg, { message });
          throw exception;
        });
      }
    );
  },

  // download({ sourceEventType = "download" } = {}) {
  //   function downloadByUrl() {
  //     downloadManager.downloadUrl(url, filename);
  //   }

  //   const url = this.baseUrl;
  //   // Use this.url instead of this.baseUrl to perform filename detection based
  //   // on the reference fragment as ultimate fallback if needed.
  //   const filename =
  //     this.contentDispositionFilename || getPDFFileNameFromURL(this.url);
  //   const downloadManager = this.downloadManager;
  //   downloadManager.onerror = err => {
  //     // This error won't really be helpful because it's likely the
  //     // fallback won't work either (or is already open).
  //     this.error(`PDF failed to download: ${err}`);
  //   };

  //   // When the PDF document isn't ready, or the PDF file is still downloading,
  //   // simply download using the URL.
  //   if (!this.pdfDocument || !this.downloadComplete) {
  //     downloadByUrl();
  //     return;
  //   }

  //   this.pdfDocument
  //     .getData()
  //     .then(function (data) {
  //       const blob = new Blob([data], { type: "application/pdf" });
  //       downloadManager.download(blob, url, filename, sourceEventType);
  //     })
  //     .catch(downloadByUrl); // Error occurred, try downloading with the URL.
  // },

  // save({ sourceEventType = "download" } = {}) {
  //   if (this._saveInProgress) {
  //     return;
  //   }

  //   const url = this.baseUrl;
  //   // Use this.url instead of this.baseUrl to perform filename detection based
  //   // on the reference fragment as ultimate fallback if needed.
  //   const filename =
  //     this.contentDispositionFilename || getPDFFileNameFromURL(this.url);
  //   const downloadManager = this.downloadManager;
  //   downloadManager.onerror = err => {
  //     // This error won't really be helpful because it's likely the
  //     // fallback won't work either (or is already open).
  //     this.error(`PDF failed to be saved: ${err}`);
  //   };

  //   // When the PDF document isn't ready, or the PDF file is still downloading,
  //   // simply download using the URL.
  //   if (!this.pdfDocument || !this.downloadComplete) {
  //     this.download({ sourceEventType });
  //     return;
  //   }

  //   this._saveInProgress = true;
  //   this.pdfDocument
  //     .saveDocument(this.pdfDocument.annotationStorage)
  //     .then(data => {
  //       const blob = new Blob([data], { type: "application/pdf" });
  //       downloadManager.download(blob, url, filename, sourceEventType);
  //     })
  //     .catch(() => {
  //       this.download({ sourceEventType });
  //     })
  //     .finally(() => {
  //       this._saveInProgress = false;
  //     });
  // },

  /**
   * For PDF documents that contain e.g. forms and javaScript, we should only
   * trigger the fallback bar once the user has interacted with the page.
   * @private
   */
  _delayedFallback(featureId) {
    // Ensure that telemetry is always reported, since it's not guaranteed
    // that the fallback bar will be shown (depends on user interaction).
    this.externalServices.reportTelemetry({
      type: "unsupportedFeature",
      featureId,
    });

    if (!this.triggerDelayedFallback) {
      this.triggerDelayedFallback = () => {
        this.fallback(featureId);
        this.triggerDelayedFallback = null;
      };
    }
  },

  fallback(featureId) {
    this.externalServices.reportTelemetry({
      type: "unsupportedFeature",
      featureId,
    });

    // Only trigger the fallback once so we don't spam the user with messages
    // for one PDF.
    if (this.fellback) {
      return;
    }
    this.fellback = true;
    this.externalServices.fallback(
      {
        featureId,
        url: this.baseUrl,
      },
      function response(download) {
        if (!download) {
          return;
        }
        PDFViewerApplication.download({ sourceEventType: "download" });
      }
    );
  },

  /**
   * Show the error box.
   * @param {string} message - A message that is human readable.
   * @param {Object} [moreInfo] - Further information about the error that is
   *                              more technical.  Should have a 'message' and
   *                              optionally a 'stack' property.
   */
  error(message, moreInfo) {
    const moreInfoText = [
      this.l10n.get(
        "error_version_info",
        { version: version || "?", build: build || "?" },
        "PDF.js v{{version}} (build: {{build}})"
      ),
    ];
    if (moreInfo) {
      moreInfoText.push(
        this.l10n.get(
          "error_message",
          { message: moreInfo.message },
          "Message: {{message}}"
        )
      );
      if (moreInfo.stack) {
        moreInfoText.push(
          this.l10n.get(
            "error_stack",
            { stack: moreInfo.stack },
            "Stack: {{stack}}"
          )
        );
      } else {
        if (moreInfo.filename) {
          moreInfoText.push(
            this.l10n.get(
              "error_file",
              { file: moreInfo.filename },
              "File: {{file}}"
            )
          );
        }
        if (moreInfo.lineNumber) {
          moreInfoText.push(
            this.l10n.get(
              "error_line",
              { line: moreInfo.lineNumber },
              "Line: {{line}}"
            )
          );
        }
      }
    }

    if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
      const errorWrapperConfig = this.appConfig.errorWrapper;
      const errorWrapper = errorWrapperConfig.container;
      errorWrapper.removeAttribute("hidden");

      const errorMessage = errorWrapperConfig.errorMessage;
      errorMessage.textContent = message;

      const closeButton = errorWrapperConfig.closeButton;
      closeButton.onclick = function () {
        errorWrapper.setAttribute("hidden", "true");
      };

      const errorMoreInfo = errorWrapperConfig.errorMoreInfo;
      const moreInfoButton = errorWrapperConfig.moreInfoButton;
      const lessInfoButton = errorWrapperConfig.lessInfoButton;
      moreInfoButton.onclick = function () {
        errorMoreInfo.removeAttribute("hidden");
        moreInfoButton.setAttribute("hidden", "true");
        lessInfoButton.removeAttribute("hidden");
        errorMoreInfo.style.height = errorMoreInfo.scrollHeight + "px";
      };
      lessInfoButton.onclick = function () {
        errorMoreInfo.setAttribute("hidden", "true");
        moreInfoButton.removeAttribute("hidden");
        lessInfoButton.setAttribute("hidden", "true");
      };
      moreInfoButton.oncontextmenu = noContextMenuHandler;
      lessInfoButton.oncontextmenu = noContextMenuHandler;
      closeButton.oncontextmenu = noContextMenuHandler;
      moreInfoButton.removeAttribute("hidden");
      lessInfoButton.setAttribute("hidden", "true");
      Promise.all(moreInfoText).then(parts => {
        errorMoreInfo.value = parts.join("\n");
      });
    } else {
      Promise.all(moreInfoText).then(parts => {
        console.error(message + "\n" + parts.join("\n"));
      });
      this.fallback();
    }
  },

  progress(level) {
    if (this.downloadComplete) {
      // Don't accidentally show the loading bar again when the entire file has
      // already been fetched (only an issue when disableAutoFetch is enabled).
      return;
    }
    const percent = Math.round(level * 100);
    // When we transition from full request to range requests, it's possible
    // that we discard some of the loaded data. This can cause the loading
    // bar to move backwards. So prevent this by only updating the bar if it
    // increases.
    if (percent > this.loadingBar.percent || isNaN(percent)) {
      this.loadingBar.percent = percent;

      // When disableAutoFetch is enabled, it's not uncommon for the entire file
      // to never be fetched (depends on e.g. the file structure). In this case
      // the loading bar will not be completely filled, nor will it be hidden.
      // To prevent displaying a partially filled loading bar permanently, we
      // hide it when no data has been loaded during a certain amount of time.
      const disableAutoFetch = this.pdfDocument
        ? this.pdfDocument.loadingParams.disableAutoFetch
        : AppOptions.get("disableAutoFetch");

      if (disableAutoFetch && percent) {
        if (this.disableAutoFetchLoadingBarTimeout) {
          clearTimeout(this.disableAutoFetchLoadingBarTimeout);
          this.disableAutoFetchLoadingBarTimeout = null;
        }
        this.loadingBar.show();

        this.disableAutoFetchLoadingBarTimeout = setTimeout(() => {
          this.loadingBar.hide();
          this.disableAutoFetchLoadingBarTimeout = null;
        }, DISABLE_AUTO_FETCH_LOADING_BAR_TIMEOUT);
      }
    }
  },

  load(pdfDocument) {
    this.pdfDocument = pdfDocument;

    pdfDocument.getDownloadInfo().then(() => {
      this.downloadComplete = true;
      this.loadingBar.hide();

      firstPagePromise.then(() => {
        this.eventBus.dispatch("documentloaded", { source: this });
      });
    });

    // Since the `setInitialView` call below depends on this being resolved,
    // fetch it early to avoid delaying initial rendering of the PDF document.
    const pageLayoutPromise = pdfDocument.getPageLayout().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const pageModePromise = pdfDocument.getPageMode().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const openActionPromise = pdfDocument.getOpenAction().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    });

    this.toolbar.setPagesCount(pdfDocument.numPages, false);
    this.secondaryToolbar.setPagesCount(pdfDocument.numPages);

    let baseDocumentUrl;
    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
      baseDocumentUrl = null;
    } else if (PDFJSDev.test("MOZCENTRAL")) {
      baseDocumentUrl = this.baseUrl;
    } else if (PDFJSDev.test("CHROME")) {
      baseDocumentUrl = location.href.split("#")[0];
    }
    this.pdfLinkService.setDocument(pdfDocument, baseDocumentUrl);
    // this.pdfDocumentProperties.setDocument(pdfDocument, this.url);

    const annotationStorage = pdfDocument.annotationStorage;
    annotationStorage.onSetModified = function () {
      window.addEventListener("beforeunload", beforeUnload);
    };
    annotationStorage.onResetModified = function () {
      window.removeEventListener("beforeunload", beforeUnload);
    };

    const pdfViewer = this.pdfViewer;
    pdfViewer.setDocument(pdfDocument);
    const { firstPagePromise, onePageRendered, pagesPromise } = pdfViewer;

    const pdfThumbnailViewer = this.pdfThumbnailViewer;
    pdfThumbnailViewer.setDocument(pdfDocument);

    const storedPromise = (this.store = new ViewHistory(
      pdfDocument.fingerprint
    ))
      .getMultiple({
        page: null,
        zoom: DEFAULT_SCALE_VALUE,
        scrollLeft: "0",
        scrollTop: "0",
        rotation: null,
        sidebarView: SidebarView.UNKNOWN,
        scrollMode: ScrollMode.UNKNOWN,
        spreadMode: SpreadMode.UNKNOWN,
      })
      .catch(() => {
        /* Unable to read from storage; ignoring errors. */
        return Object.create(null);
      });

    firstPagePromise.then(pdfPage => {
      this.loadingBar.setWidth(this.appConfig.viewerContainer);

      Promise.all([
        animationStarted,
        storedPromise,
        pageLayoutPromise,
        pageModePromise,
        openActionPromise,
      ])
        .then(async ([timeStamp, stored, pageLayout, pageMode, openAction]) => {
          const viewOnLoad = AppOptions.get("viewOnLoad");

          // this._initializePdfHistory({
          //   fingerprint: pdfDocument.fingerprint,
          //   viewOnLoad,
          //   initialDest: openAction && openAction.dest,
          // });
          const initialBookmark = this.initialBookmark;

          // Initialize the default values, from user preferences.
          const zoom = AppOptions.get("defaultZoomValue");
          let hash = zoom ? `zoom=${zoom}` : null;

          let rotation = null;
          let sidebarView = AppOptions.get("sidebarViewOnLoad");
          let scrollMode = AppOptions.get("scrollModeOnLoad");
          let spreadMode = AppOptions.get("spreadModeOnLoad");

          if (stored.page && viewOnLoad !== ViewOnLoad.INITIAL) {
            hash =
              `page=${stored.page}&zoom=${zoom || stored.zoom},` +
              `${stored.scrollLeft},${stored.scrollTop}`;

            rotation = parseInt(stored.rotation, 10);
            // Always let user preference take precedence over the view history.
            if (sidebarView === SidebarView.UNKNOWN) {
              sidebarView = stored.sidebarView | 0;
            }
            if (scrollMode === ScrollMode.UNKNOWN) {
              scrollMode = stored.scrollMode | 0;
            }
            if (spreadMode === SpreadMode.UNKNOWN) {
              spreadMode = stored.spreadMode | 0;
            }
          }
          // Always let the user preference/view history take precedence.
          if (pageMode && sidebarView === SidebarView.UNKNOWN) {
            sidebarView = apiPageModeToSidebarView(pageMode);
          }
          if (pageLayout && spreadMode === SpreadMode.UNKNOWN) {
            spreadMode = apiPageLayoutToSpreadMode(pageLayout);
          }

          this.setInitialView(hash, {
            rotation,
            sidebarView,
            scrollMode,
            spreadMode,
          });
          // this.eventBus.dispatch("documentinit", { source: this });
          // Make all navigation keys work on document load,
          // unless the viewer is embedded in a web page.
          if (!this.isViewerEmbedded) {
            pdfViewer.focus();
          }

          // Currently only the "copy"-permission is supported, hence we delay
          // the `getPermissions` API call until *after* rendering has started.
          this._initializePermissions(pdfDocument);

          // For documents with different page sizes, once all pages are
          // resolved, ensure that the correct location becomes visible on load.
          // (To reduce the risk, in very large and/or slow loading documents,
          //  that the location changes *after* the user has started interacting
          //  with the viewer, wait for either `pagesPromise` or a timeout.)
          await Promise.race([
            pagesPromise,
            new Promise(resolve => {
              setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT);
            }),
          ]);
          if (!initialBookmark && !hash) {
            return;
          }
          if (pdfViewer.hasEqualPageSizes) {
            return;
          }
          this.initialBookmark = initialBookmark;

          // eslint-disable-next-line no-self-assign
          pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
          // Re-apply the initial document location.
          this.setInitialView(hash);
        })
        .catch(() => {
          // Ensure that the document is always completely initialized,
          // even if there are any errors thrown above.
          this.setInitialView();
        })
        .then(function () {
          // At this point, rendering of the initial page(s) should always have
          // started (and may even have completed).
          // To prevent any future issues, e.g. the document being completely
          // blank on load, always trigger rendering here.
          pdfViewer.update();
        });
    });

    // pagesPromise.then(() => {
    //   this._initializeAutoPrint(pdfDocument, openActionPromise);
    // });

    onePageRendered.then(() => {
      pdfDocument.getOutline().then(outline => {
        this.pdfOutlineViewer.render({ outline });
      });
      pdfDocument.getAttachments().then(attachments => {
        this.pdfAttachmentViewer.render({ attachments });
      });
      // Ensure that the layers accurately reflects the current state in the
      // viewer itself, rather than the default state provided by the API.
      pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
        this.pdfLayerViewer.render({ optionalContentConfig, pdfDocument });
      });
      if ("requestIdleCallback" in window) {
        const callback = window.requestIdleCallback(
          () => {
            this._collectTelemetry(pdfDocument);
            this._idleCallbacks.delete(callback);
          },
          { timeout: 1000 }
        );
        this._idleCallbacks.add(callback);
      }
    });

    this._initializePageLabels(pdfDocument);
    this._initializeMetadata(pdfDocument);
    this._initializeJavaScript(pdfDocument);
  },

  /**
   * @private
   */
  async _initializeJavaScript(pdfDocument) {
    const objects = await pdfDocument.getFieldObjects();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the JavaScript data resolved.
    }
    if (!objects || !AppOptions.get("enableScripting")) {
      return;
    }
    const scripting = this.externalServices.scripting;

    window.addEventListener("updateFromSandbox", function (event) {
      const detail = event.detail;
      const id = detail.id;
      if (!id) {
        switch (detail.command) {
          case "println":
            console.log(detail.value);
            break;
          case "clear":
            console.clear();
            break;
          case "alert":
            // eslint-disable-next-line no-alert
            window.alert(detail.value);
            break;
          case "error":
            console.error(detail.value);
            break;
        }
        return;
      }

      const element = document.getElementById(id);
      if (element) {
        element.dispatchEvent(new CustomEvent("updateFromSandbox", { detail }));
      } else {
        const value = detail.value;
        if (value !== undefined && value !== null) {
          // the element hasn't been rendered yet so use annotation storage
          pdfDocument.annotationStorage.setValue(id, detail.value);
        }
      }
    });

    window.addEventListener("dispatchEventInSandbox", function (event) {
      scripting.dispatchEventInSandbox(event.detail);
    });

    const dispatchEventName = generateRandomStringForSandbox(objects);
    const calculationOrder = [];
    scripting.createSandbox({ objects, dispatchEventName, calculationOrder });
  },

  /**
   * A place to fetch data for telemetry after one page is rendered and the
   * viewer is idle.
   * @private
   */
  async _collectTelemetry(pdfDocument) {
    const markInfo = await this.pdfDocument.getMarkInfo();
    if (pdfDocument !== this.pdfDocument) {
      return; // Document was closed while waiting for mark info.
    }
    const tagged = markInfo?.Marked || false;
    this.externalServices.reportTelemetry({
      type: "tagged",
      tagged,
    });
  },

  async _initializeMetadata(pdfDocument) {
    const {
      info,
      metadata,
      contentDispositionFilename,
    } = await pdfDocument.getMetadata();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the metadata resolved.
    }
    this.documentInfo = info;
    this.metadata = metadata;
    this.contentDispositionFilename = contentDispositionFilename;

    // Provides some basic debug information
    console.log(
      `PDF ${pdfDocument.fingerprint} [${info.PDFFormatVersion} ` +
        `${(info.Producer || "-").trim()} / ${(info.Creator || "-").trim()}] ` +
        `(PDF.js: ${version || "-"}` +
        `${this.pdfViewer.enableWebGL ? " [WebGL]" : ""})`
    );

    let pdfTitle;
    const infoTitle = info && info.Title;
    if (infoTitle) {
      pdfTitle = infoTitle;
    }
    const metadataTitle = metadata && metadata.get("dc:title");
    if (metadataTitle) {
      // Ghostscript can produce invalid 'dc:title' Metadata entries:
      //  - The title may be "Untitled" (fixes bug 1031612).
      //  - The title may contain incorrectly encoded characters, which thus
      //    looks broken, hence we ignore the Metadata entry when it
      //    contains characters from the Specials Unicode block
      //    (fixes bug 1605526).
      if (
        metadataTitle !== "Untitled" &&
        !/[\uFFF0-\uFFFF]/g.test(metadataTitle)
      ) {
        pdfTitle = metadataTitle;
      }
    }
    if (pdfTitle) {
      this.setTitle(
        `${pdfTitle} - ${contentDispositionFilename || document.title}`
      );
    } else if (contentDispositionFilename) {
      this.setTitle(contentDispositionFilename);
    }

    if (info.IsXFAPresent && !info.IsAcroFormPresent) {
      console.warn("Warning: XFA is not supported");
      this._delayedFallback(UNSUPPORTED_FEATURES.forms);
    } else if (
      (info.IsAcroFormPresent || info.IsXFAPresent) &&
      !this.pdfViewer.renderInteractiveForms
    ) {
      console.warn("Warning: Interactive form support is not enabled");
      this._delayedFallback(UNSUPPORTED_FEATURES.forms);
    }

    // Telemetry labels must be C++ variable friendly.
    let versionId = "other";
    if (KNOWN_VERSIONS.includes(info.PDFFormatVersion)) {
      versionId = `v${info.PDFFormatVersion.replace(".", "_")}`;
    }
    let generatorId = "other";
    if (info.Producer) {
      const producer = info.Producer.toLowerCase();
      KNOWN_GENERATORS.some(function (generator) {
        if (!producer.includes(generator)) {
          return false;
        }
        generatorId = generator.replace(/[ .-]/g, "_");
        return true;
      });
    }
    let formType = null;
    if (info.IsXFAPresent) {
      formType = "xfa";
    } else if (info.IsAcroFormPresent) {
      formType = "acroform";
    }
    this.externalServices.reportTelemetry({
      type: "documentInfo",
      version: versionId,
      generator: generatorId,
      formType,
    });
  },

  async _initializePageLabels(pdfDocument) {
    const labels = await pdfDocument.getPageLabels();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the page labels resolved.
    }
    if (!labels || AppOptions.get("disablePageLabels")) {
      return;
    }
    const numLabels = labels.length;
    if (numLabels !== this.pagesCount) {
      console.error(
        "The number of Page Labels does not match the number of pages in the document."
      );
      return;
    }
    let i = 0;
    // Ignore page labels that correspond to standard page numbering.
    while (i < numLabels && labels[i] === (i + 1).toString()) {
      i++;
    }
    if (i === numLabels) {
      return;
    }
    const { pdfViewer, pdfThumbnailViewer, toolbar } = this;

    pdfViewer.setPageLabels(labels);
    pdfThumbnailViewer.setPageLabels(labels);

    // Changing toolbar page display to use labels and we need to set
    // the label of the current page.
    toolbar.setPagesCount(numLabels, true);
    toolbar.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel
    );
  },

  async _initializePermissions(pdfDocument) {
    const permissions = await pdfDocument.getPermissions();

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the permissions resolved.
    }
    if (!permissions || !AppOptions.get("enablePermissions")) {
      return;
    }
    // Currently only the "copy"-permission is supported.
    if (!permissions.includes(PermissionFlag.COPY)) {
      this.appConfig.viewerContainer.classList.add(ENABLE_PERMISSIONS_CLASS);
    }
  },

  setInitialView(
    storedHash,
    { rotation, sidebarView, scrollMode, spreadMode } = {}
  ) {
    const setRotation = angle => {
      if (isValidRotation(angle)) {
        this.pdfViewer.pagesRotation = angle;
      }
    };
    const setViewerModes = (scroll, spread) => {
      if (isValidScrollMode(scroll)) {
        this.pdfViewer.scrollMode = scroll;
      }
      if (isValidSpreadMode(spread)) {
        this.pdfViewer.spreadMode = spread;
      }
    };
    this.isInitialViewSet = true;
    this.pdfSidebar.setInitialView(sidebarView);

    setViewerModes(scrollMode, spreadMode);

    if (this.initialBookmark) {
      setRotation(this.initialRotation);
      delete this.initialRotation;

      this.pdfLinkService.setHash(this.initialBookmark);
      this.initialBookmark = null;
    } else if (storedHash) {
      setRotation(rotation);

      this.pdfLinkService.setHash(storedHash);
    }

    // Ensure that the correct page number is displayed in the UI,
    // even if the active page didn't change during document load.
    this.toolbar.setPageNumber(
      this.pdfViewer.currentPageNumber,
      this.pdfViewer.currentPageLabel
    );
    this.secondaryToolbar.setPageNumber(this.pdfViewer.currentPageNumber);

    if (!this.pdfViewer.currentScaleValue) {
      // Scale was not initialized: invalid bookmark or scale was not specified.
      // Setting the default one.
      this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;
    }
  },

  cleanup() {
    if (!this.pdfDocument) {
      return; // run cleanup when document is loaded
    }
    this.pdfViewer.cleanup();
    this.pdfThumbnailViewer.cleanup();

    // We don't want to remove fonts used by active page SVGs.
    if (this.pdfViewer.renderer !== RendererType.SVG) {
      this.pdfDocument.cleanup();
    }
  },

  forceRendering() {
    this.pdfRenderingQueue.printing = !!this.printService;
    this.pdfRenderingQueue.isThumbnailViewEnabled = this.pdfSidebar.isThumbnailViewVisible;
    this.pdfRenderingQueue.renderHighestPriority();
  },

  rotatePages(delta) {
    if (!this.pdfDocument) {
      return;
    }
    const newRotation = (this.pdfViewer.pagesRotation + 360 + delta) % 360;
    this.pdfViewer.pagesRotation = newRotation;
    // Note that the thumbnail viewer is updated, and rendering is triggered,
    // in the 'rotationchanging' event handler.
  },

  requestPresentationMode() {
    if (!this.pdfPresentationMode) {
      return;
    }
    this.pdfPresentationMode.request();
  },

  bindEvents() {
    const { eventBus, _boundEvents } = this;

    // _boundEvents.beforePrint = this.beforePrint.bind(this);
    // _boundEvents.afterPrint = this.afterPrint.bind(this);

    // eventBus._on("resize", webViewerResize);
    // eventBus._on("hashchange", webViewerHashchange);
    // eventBus._on("beforeprint", _boundEvents.beforePrint);
    // eventBus._on("afterprint", _boundEvents.afterPrint);
    eventBus._on("pagerendered", webViewerPageRendered);
    eventBus._on("updateviewarea", webViewerUpdateViewarea);
    eventBus._on("pagechanging", webViewerPageChanging);
    eventBus._on("scalechanging", webViewerScaleChanging);
    // eventBus._on("rotationchanging", webViewerRotationChanging);
    eventBus._on("sidebarviewchanged", webViewerSidebarViewChanged);
    eventBus._on("pagemode", webViewerPageMode);
    // eventBus._on("namedaction", webViewerNamedAction);
    // eventBus._on("presentationmodechanged", webViewerPresentationModeChanged);
    // eventBus._on("presentationmode", webViewerPresentationMode);
    // eventBus._on("print", webViewerPrint);
    // eventBus._on("download", webViewerDownload);
    // eventBus._on("save", webViewerSave);
    eventBus._on("firstpage", webViewerFirstPage);
    eventBus._on("lastpage", webViewerLastPage);
    eventBus._on("nextpage", webViewerNextPage);
    eventBus._on("previouspage", webViewerPreviousPage);

    // eventBus._on("zoomin", webViewerZoomIn);
    // eventBus._on("zoomout", webViewerZoomOut);
    // eventBus._on("zoomreset", webViewerZoomReset);
    eventBus._on("pagenumberchanged", webViewerPageNumberChanged);
    // eventBus._on("scalechanged", webViewerScaleChanged);
    // eventBus._on("rotatecw", webViewerRotateCw);
    // eventBus._on("rotateccw", webViewerRotateCcw);
    // eventBus._on("optionalcontentconfig", webViewerOptionalContentConfig);
    eventBus._on("switchscrollmode", webViewerSwitchScrollMode);
    eventBus._on("scrollmodechanged", webViewerScrollModeChanged);
    eventBus._on("switchspreadmode", webViewerSwitchSpreadMode);
    eventBus._on("spreadmodechanged", webViewerSpreadModeChanged);
    eventBus._on("documentproperties", webViewerDocumentProperties);

    eventBus._on("find", webViewerFind);
    eventBus._on("findfromurlhash", webViewerFindFromUrlHash);
    eventBus._on("updatefindmatchescount", webViewerUpdateFindMatchesCount);
    eventBus._on("updatefindcontrolstate", webViewerUpdateFindControlState);

    // if (AppOptions.get("pdfBug")) {
    //   _boundEvents.reportPageStatsPDFBug = reportPageStatsPDFBug;
    //   eventBus._on("pagerendered", _boundEvents.reportPageStatsPDFBug);
    //   eventBus._on("pagechanging", _boundEvents.reportPageStatsPDFBug);
    // }
    // if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
    //   eventBus._on("fileinputchange", webViewerFileInputChange);
    //   eventBus._on("openfile", webViewerOpenFile);
    // }
  },

  bindWindowEvents() {
    const { eventBus, _boundEvents } = this;

    // _boundEvents.windowResize = () => {
    //   eventBus.dispatch("resize", { source: window });
    // };
    // _boundEvents.windowHashChange = () => {
    //   eventBus.dispatch("hashchange", {
    //     source: window,
    //     hash: document.location.hash.substring(1),
    //   });
    // };
    // _boundEvents.windowBeforePrint = () => {
    //   eventBus.dispatch("beforeprint", { source: window });
    // };
    // _boundEvents.windowAfterPrint = () => {
    //   eventBus.dispatch("afterprint", { source: window });
    // };

    // window.addEventListener("visibilitychange", webViewerVisibilityChange);
    // window.addEventListener("wheel", webViewerWheel, { passive: false });
    // window.addEventListener("touchstart", webViewerTouchStart, {
    //   passive: false,
    // });
    // window.addEventListener("click", webViewerClick);
    // window.addEventListener("keydown", webViewerKeyDown);
    // window.addEventListener("keyup", webViewerKeyUp);
    // window.addEventListener("resize", _boundEvents.windowResize);
    // window.addEventListener("hashchange", _boundEvents.windowHashChange);
    // window.addEventListener("beforeprint", _boundEvents.windowBeforePrint);
    // window.addEventListener("afterprint", _boundEvents.windowAfterPrint);
  },

  accumulateWheelTicks(ticks) {
    // If the scroll direction changed, reset the accumulated wheel ticks.
    if (
      (this._wheelUnusedTicks > 0 && ticks < 0) ||
      (this._wheelUnusedTicks < 0 && ticks > 0)
    ) {
      this._wheelUnusedTicks = 0;
    }
    this._wheelUnusedTicks += ticks;
    const wholeTicks =
      Math.sign(this._wheelUnusedTicks) *
      Math.floor(Math.abs(this._wheelUnusedTicks));
    this._wheelUnusedTicks -= wholeTicks;
    return wholeTicks;
  },
};

async function loadFakeWorker() {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = AppOptions.get("workerSrc");
  }
  if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("PRODUCTION")) {
    window.pdfjsWorker = await import("pdfjs/core/worker.js");
    return undefined;
  }
  return loadScript(PDFWorker.getWorkerSrc());
}

function loadAndEnablePDFBug(enabledTabs) {
  const appConfig = PDFViewerApplication.appConfig;
  return loadScript(appConfig.debuggerScriptPath).then(function () {
    PDFBug.enable(enabledTabs);
    PDFBug.init({ OPS }, appConfig.mainContainer);
  });
}

function webViewerInitialized() {
  const appConfig = PDFViewerApplication.appConfig;
  let file;
  if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
    const queryString = document.location.search.substring(1);
    const params = parseQueryString(queryString);
    file = "file" in params ? params.file : AppOptions.get("defaultUrl");
    // validateFileURL(file);
  } else if (PDFJSDev.test("MOZCENTRAL")) {
    file = window.location.href;
  } else if (PDFJSDev.test("CHROME")) {
    file = AppOptions.get("defaultUrl");
  }

  if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
    const fileInput = document.createElement("input");
    fileInput.id = appConfig.openFileInputName;
    fileInput.className = "fileInput";
    fileInput.setAttribute("type", "file");
    fileInput.oncontextmenu = noContextMenuHandler;
    document.body.appendChild(fileInput);

    if (
      !window.File ||
      !window.FileReader ||
      !window.FileList ||
      !window.Blob
    ) {
      appConfig.toolbar.openFile.setAttribute("hidden", "true");
      appConfig.secondaryToolbar.openFileButton.setAttribute("hidden", "true");
    } else {
      fileInput.value = null;
    }

    fileInput.addEventListener("change", function (evt) {
      const files = evt.target.files;
      if (!files || files.length === 0) {
        return;
      }
      PDFViewerApplication.eventBus.dispatch("fileinputchange", {
        source: this,
        fileInput: evt.target,
      });
    });

    // Enable dragging-and-dropping a new PDF file onto the viewerContainer.
    appConfig.mainContainer.addEventListener("dragover", function (evt) {
      evt.preventDefault();

      evt.dataTransfer.dropEffect = "move";
    });
    appConfig.mainContainer.addEventListener("drop", function (evt) {
      evt.preventDefault();

      const files = evt.dataTransfer.files;
      if (!files || files.length === 0) {
        return;
      }
      PDFViewerApplication.eventBus.dispatch("fileinputchange", {
        source: this,
        fileInput: evt.dataTransfer,
      });
    });
  } else {
    appConfig.toolbar.openFile.setAttribute("hidden", "true");
    appConfig.secondaryToolbar.openFileButton.setAttribute("hidden", "true");
  }

  if (!PDFViewerApplication.supportsDocumentFonts) {
    AppOptions.set("disableFontFace", true);
    PDFViewerApplication.l10n
      .get(
        "web_fonts_disabled",
        null,
        "Web fonts are disabled: unable to use embedded PDF fonts."
      )
      .then(msg => {
        console.warn(msg);
      });
  }

  if (!PDFViewerApplication.supportsPrinting) {
    appConfig.toolbar.print.classList.add("hidden");
    appConfig.secondaryToolbar.printButton.classList.add("hidden");
  }

  if (!PDFViewerApplication.supportsFullscreen) {
    appConfig.toolbar.presentationModeButton.classList.add("hidden");
    appConfig.secondaryToolbar.presentationModeButton.classList.add("hidden");
  }

  if (PDFViewerApplication.supportsIntegratedFind) {
    appConfig.toolbar.viewFind.classList.add("hidden");
  }

  try {
    // webViewerOpenFileViaURL(file);
    PDFViewerApplication.open(file);
  } catch (reason) {
    PDFViewerApplication.l10n
      .get("loading_error", null, "An error occurred while loading the PDF.")
      .then(msg => {
        PDFViewerApplication.error(msg, reason);
      });
  }
}

function webViewerResetPermissions() {
  const { appConfig } = PDFViewerApplication;
  if (!appConfig) {
    return;
  }
  // Currently only the "copy"-permission is supported.
  appConfig.viewerContainer.classList.remove(ENABLE_PERMISSIONS_CLASS);
}

// 页面渲染完毕
function webViewerPageRendered({ pageNumber, timestamp, error }) {
  // console.log("webViewerPageRendered")
  // console.log(pageNumber, timestamp, error)
  // If the page is still visible when it has finished rendering,
  // ensure that the page number input loading indicator is hidden.
  if (pageNumber === PDFViewerApplication.page) {
    PDFViewerApplication.toolbar.updateLoadingIndicatorState(false);
  }

  // Use the rendered page to set the corresponding thumbnail image.
  if (PDFViewerApplication.pdfSidebar.isThumbnailViewVisible) {
    const pageView = PDFViewerApplication.pdfViewer.getPageView(
      /* index = */ pageNumber - 1
    );
    const thumbnailView = PDFViewerApplication.pdfThumbnailViewer.getThumbnail(
      /* index = */ pageNumber - 1
    );
    if (pageView && thumbnailView) {
      thumbnailView.setImage(pageView);
    }
  }

  if (error) {
    PDFViewerApplication.l10n
      .get(
        "rendering_error",
        null,
        "An error occurred while rendering the page."
      )
      .then(msg => {
        PDFViewerApplication.error(msg, error);
      });
  }

  PDFViewerApplication.externalServices.reportTelemetry({
    type: "pageInfo",
    timestamp,
  });
  // It is a good time to report stream and font types.
  PDFViewerApplication.pdfDocument.getStats().then(function (stats) {
    PDFViewerApplication.externalServices.reportTelemetry({
      type: "documentStats",
      stats,
    });
  });
}

// 切换缩略图 大纲 等
function webViewerPageMode({ mode }) {
  console.log(mode);
  // Handle the 'pagemode' hash parameter, see also `PDFLinkService_setHash`.
  let view;
  switch (mode) {
    case "thumbs":
      view = SidebarView.THUMBS;
      break;
    case "bookmarks":
    case "outline": // non-standard
      view = SidebarView.OUTLINE;
      break;
    case "attachments": // non-standard
      view = SidebarView.ATTACHMENTS;
      break;
    case "layers": // non-standard
      view = SidebarView.LAYERS;
      break;
    case "none":
      view = SidebarView.NONE;
      break;
    default:
      console.error('Invalid "pagemode" hash parameter: ' + mode);
      return;
  }
  PDFViewerApplication.pdfSidebar.switchView(view, /* forceOpen = */ true);
}

function webViewerSidebarViewChanged(evt) {
  console.log(evt);
  PDFViewerApplication.pdfRenderingQueue.isThumbnailViewEnabled =
    PDFViewerApplication.pdfSidebar.isThumbnailViewVisible;

  const store = PDFViewerApplication.store;
  if (store && PDFViewerApplication.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    store.set("sidebarView", evt.view).catch(function () {});
  }
}

// 页面位置发生变更
function webViewerUpdateViewarea(evt) {
  // console.log("webViewerUpdateViewarea");
  // console.log(evt);
  const location = evt.location,
    store = PDFViewerApplication.store;

  if (store && PDFViewerApplication.isInitialViewSet) {
    store
      .setMultiple({
        page: location.pageNumber,
        zoom: location.scale,
        scrollLeft: location.left,
        scrollTop: location.top,
        rotation: location.rotation,
      })
      .catch(function () {
        /* unable to write to storage */
      });
  }
  const href = PDFViewerApplication.pdfLinkService.getAnchorUrl(
    location.pdfOpenParams
  );
  PDFViewerApplication.appConfig.toolbar.viewBookmark.href = href;
  PDFViewerApplication.appConfig.secondaryToolbar.viewBookmarkButton.href = href;

  // Show/hide the loading indicator in the page number input element.
  const currentPage = PDFViewerApplication.pdfViewer.getPageView(
    /* index = */ PDFViewerApplication.page - 1
  );
  const loading =
    (currentPage && currentPage.renderingState) !== RenderingStates.FINISHED;
  PDFViewerApplication.toolbar.updateLoadingIndicatorState(loading);
}

function webViewerScrollModeChanged(evt) {
  const store = PDFViewerApplication.store;
  if (store && PDFViewerApplication.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    store.set("scrollMode", evt.mode).catch(function () {});
  }
}

// 视图模式切换完毕
function webViewerSpreadModeChanged(evt) {
  const store = PDFViewerApplication.store;
  if (store && PDFViewerApplication.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    store.set("spreadMode", evt.mode).catch(function () {});
  }
}

function webViewerPresentationMode() {
  PDFViewerApplication.requestPresentationMode();
}
// function webViewerDownloadOrSave(sourceEventType) {
//   if (
//     PDFViewerApplication.pdfDocument &&
//     PDFViewerApplication.pdfDocument.annotationStorage.size > 0
//   ) {
//     PDFViewerApplication.save({ sourceEventType });
//   } else {
//     PDFViewerApplication.download({ sourceEventType });
//   }
// }
function webViewerDownload() {
  webViewerDownloadOrSave("download");
}
function webViewerSave() {
  webViewerDownloadOrSave("save");
}

// 去第一页
function webViewerFirstPage() {
  if (PDFViewerApplication.pdfDocument) {
    PDFViewerApplication.page = 1;
  }
}
// 去最后一页
function webViewerLastPage() {
  if (PDFViewerApplication.pdfDocument) {
    PDFViewerApplication.page = PDFViewerApplication.pagesCount;
  }
}
function webViewerNextPage() {
  PDFViewerApplication.page++;
}
function webViewerPreviousPage() {
  PDFViewerApplication.page--;
}

// 输入一个数字， 跳转到指定页面
function webViewerPageNumberChanged(evt) {
  console.log(evt);
  const pdfViewer = PDFViewerApplication.pdfViewer;
  // Note that for `<input type="number">` HTML elements, an empty string will
  // be returned for non-number inputs; hence we simply do nothing in that case.
  if (evt.value !== "") {
    PDFViewerApplication.pdfLinkService.goToPage(evt.value);
  }

  // Ensure that the page number input displays the correct value, even if the
  // value entered by the user was invalid (e.g. a floating point number).
  if (
    evt.value !== pdfViewer.currentPageNumber.toString() &&
    evt.value !== pdfViewer.currentPageLabel
  ) {
    PDFViewerApplication.toolbar.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel
    );
  }
}

// 滚动模式， 垂直 水平 平铺
function webViewerSwitchScrollMode(evt) {
  PDFViewerApplication.pdfViewer.scrollMode = evt.mode;
}

// 单页 双页  书籍视图
function webViewerSwitchSpreadMode(evt) {
  PDFViewerApplication.pdfViewer.spreadMode = evt.mode;
}

// 文档属性
function webViewerDocumentProperties() {
  PDFViewerApplication.pdfDocumentProperties.open();
}

function webViewerFind(evt) {
  PDFViewerApplication.findController.executeCommand("find" + evt.type, {
    query: evt.query,
    phraseSearch: evt.phraseSearch,
    caseSensitive: evt.caseSensitive,
    entireWord: evt.entireWord,
    highlightAll: evt.highlightAll,
    findPrevious: evt.findPrevious,
  });
}

function webViewerFindFromUrlHash(evt) {
  PDFViewerApplication.findController.executeCommand("find", {
    query: evt.query,
    phraseSearch: evt.phraseSearch,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
  });
}

function webViewerUpdateFindMatchesCount({ matchesCount }) {
  if (PDFViewerApplication.supportsIntegratedFind) {
    PDFViewerApplication.externalServices.updateFindMatchesCount(matchesCount);
  } else {
    PDFViewerApplication.findBar.updateResultsCount(matchesCount);
  }
}

function webViewerUpdateFindControlState({
  state,
  previous,
  matchesCount,
  rawQuery,
}) {
  if (PDFViewerApplication.supportsIntegratedFind) {
    PDFViewerApplication.externalServices.updateFindControlState({
      result: state,
      findPrevious: previous,
      matchesCount,
      rawQuery,
    });
  } else {
    PDFViewerApplication.findBar.updateUIState(state, previous, matchesCount);
  }
}

// 缩放比例发生变化
function webViewerScaleChanging(evt) {
  // console.log("webViewerScaleChanging")
  // console.log(evt)
  PDFViewerApplication.toolbar.setPageScale(evt.presetValue, evt.scale);

  PDFViewerApplication.pdfViewer.update();
}

// 当前处于第几个页面
function webViewerPageChanging({ pageNumber, pageLabel }) {
  // console.log("webViewerPageChanging");
  // console.log(pageNumber, pageLabel);
  PDFViewerApplication.toolbar.setPageNumber(pageNumber, pageLabel);
  PDFViewerApplication.secondaryToolbar.setPageNumber(pageNumber);

  if (PDFViewerApplication.pdfSidebar.isThumbnailViewVisible) {
    PDFViewerApplication.pdfThumbnailViewer.scrollThumbnailIntoView(pageNumber);
  }
}

function beforeUnload(evt) {
  evt.preventDefault();
  evt.returnValue = "";
  return false;
}

/**
 * Converts API PageLayout values to the format used by `PDFViewer`.
 * NOTE: This is supported to the extent that the viewer implements the
 *       necessary Scroll/Spread modes (since SinglePage, TwoPageLeft,
 *       and TwoPageRight all suggests using non-continuous scrolling).
 * @param {string} mode - The API PageLayout value.
 * @returns {number} A value from {SpreadMode}.
 */
function apiPageLayoutToSpreadMode(layout) {
  switch (layout) {
    case "SinglePage":
    case "OneColumn":
      return SpreadMode.NONE;
    case "TwoColumnLeft":
    case "TwoPageLeft":
      return SpreadMode.ODD;
    case "TwoColumnRight":
    case "TwoPageRight":
      return SpreadMode.EVEN;
  }
  return SpreadMode.NONE; // Default value.
}

/**
 * Converts API PageMode values to the format used by `PDFSidebar`.
 * NOTE: There's also a "FullScreen" parameter which is not possible to support,
 *       since the Fullscreen API used in browsers requires that entering
 *       fullscreen mode only occurs as a result of a user-initiated event.
 * @param {string} mode - The API PageMode value.
 * @returns {number} A value from {SidebarView}.
 */
function apiPageModeToSidebarView(mode) {
  switch (mode) {
    case "UseNone":
      return SidebarView.NONE;
    case "UseThumbs":
      return SidebarView.THUMBS;
    case "UseOutlines":
      return SidebarView.OUTLINE;
    case "UseAttachments":
      return SidebarView.ATTACHMENTS;
    case "UseOC":
      return SidebarView.LAYERS;
  }
  return SidebarView.NONE; // Default value.
}

export {
  PDFViewerApplication,
  DefaultExternalServices,
  // PDFPrintServiceFactory,
};
