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



const PDFViewerApplication = {
  // initialBookmark: document.location.hash.substring(1),
  // _initializedCapability: createPromiseCapability(),
  // fellback: false,
  appConfig: null,
  pdfDocument: null,
  pdfLoadingTask: null,
  // printService: null,
  pdfViewer: null, // PDFViewer
  pdfThumbnailViewer: null, //PDFThumbnailViewer
  pdfRenderingQueue: null, // PDFRenderingQueue
  pdfPresentationMode: null, // PDFPresentationMode
  pdfDocumentProperties: null, // PDFDocumentProperties
  pdfLinkService: null, // PDFLinkService
  // pdfHistory: null, // PDFHistory
  pdfSidebar: null, // PDFSidebar
  pdfSidebarResizer: null, // PDFSidebarResizer
  pdfOutlineViewer: null, // PDFOutlineViewer
  pdfAttachmentViewer: null, // PDFAttachmentViewer
  pdfLayerViewer: null, // PDFLayerViewer
  // pdfCursorTools: null, // PDFCursorTools
  store: null, // ViewHistory
  // downloadManager: null, // DownloadManager
  overlayManager: null, // OverlayManager
  // preferences: null, // Preferences
  toolbar: null, // Toolbar
  // secondaryToolbar: null, // SecondaryToolbar
  eventBus: null, // EventBus
  // l10n: null, // IL10n
  isInitialViewSet: false,
  // downloadComplete: false,
  // isViewerEmbedded: window.parent !== window,
  url: "",
  baseUrl: "",
  // externalServices: DefaultExternalServices,
  // _boundEvents: {},
  // contentDispositionFilename: null,
  // triggerDelayedFallback: null,
  // _saveInProgress: false,
  // _wheelUnusedTicks: 0,
  // _idleCallbacks: new Set(),

  async initialize(appConfig) {
    this.appConfig = appConfig;
    await this._initializeViewerComponents();
    this.bindEvents();
  },

  async _initializeViewerComponents() {
    const appConfig = this.appConfig;

    const eventBus = appConfig.eventBus || new EventBus();
    this.eventBus = eventBus;

    // 带密码的pdf
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

    // 查看 搜索
    // const findController = new PDFFindController({
    //   linkService: pdfLinkService,
    //   eventBus,
    // });
    // this.findController = findController;

    const container = appConfig.mainContainer;
    const viewer = appConfig.viewerContainer;

    // 主页面
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
      // l10n: this.l10n,
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
    });
    pdfRenderingQueue.setThumbnailViewer(this.pdfThumbnailViewer);

    this.toolbar = new Toolbar(appConfig.toolbar, eventBus);

    // 带密码的 pdf 文件
    this.passwordPrompt = new PasswordPrompt(appConfig.passwordOverlay, this.overlayManager);

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
    });

    // 图层
    this.pdfLayerViewer = new PDFLayerViewer({
      container: appConfig.sidebar.layersView,
      eventBus,
    });

    // 侧边栏
    this.pdfSidebar = new PDFSidebar({
      elements: appConfig.sidebar,
      pdfViewer: this.pdfViewer,
      pdfThumbnailViewer: this.pdfThumbnailViewer,
      eventBus,
    });
    // this.pdfSidebar.onToggled = this.forceRendering.bind(this);

    // 侧边栏 宽度调整
    this.pdfSidebarResizer = new PDFSidebarResizer(appConfig.sidebarResizer, eventBus);
  },

  run(config) {
    console.log("debug 01");
    this.initialize(config)
      .then(() => {
        console.log("init...");
      })
      .then(() => {
        const queryString = document.location.search.substring(1);
        const params = parseQueryString(queryString) || {};
        var file = params.file || AppOptions.get("defaultUrl");

        try {
          console.log("open file");
          this.open(file);
        } catch (err) {
          console.log(err);
        }
      });
  },

  // get initialized() {
  //   return this._initializedCapability.settled;
  // },

  // get initializedPromise() {
  //   return this._initializedCapability.promise;
  // },

  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  },

  get page() {
    return this.pdfViewer.currentPageNumber;
  },

  set page(val) {
    this.pdfViewer.currentPageNumber = val;
  },


  setTitleUsingUrl(url = "") {
    this.url = url;
    this.baseUrl = url.split("#")[0];
    let title = getPDFFileNameFromURL(url, "");
    document.title = title;
  },

  async open(file, args) {
    // WORKER 的配置
    const workerParameters = AppOptions.getAll(OptionKind.WORKER);
    for (const key in workerParameters) {
      GlobalWorkerOptions[key] = workerParameters[key];
    }

    this.setTitleUsingUrl(file);

    const parameters = Object.create(null);
    parameters.url = file;

    if (args) {
      for (const key in args) {
        const value = args[key];
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


    return loadingTask.promise.then(
      pdfDocument => {
        this.load(pdfDocument);
      },
      exception => {
        console.log(exception);
      }
    );
  },


  load(pdfDocument) {
    this.pdfDocument = pdfDocument;

    this.pdfLinkService.setDocument(pdfDocument, null);

    const pdfViewer = this.pdfViewer;
    pdfViewer.setDocument(pdfDocument);
    const pdfThumbnailViewer = this.pdfThumbnailViewer;

    const { firstPagePromise, onePageRendered, pagesPromise } = pdfViewer;

    pdfThumbnailViewer.setDocument(pdfDocument);

    this.store = new ViewHistory(pdfDocument.fingerprint);

    var storedPromise = this.store
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
        return Object.create(null);
      });

    console.log(this.store);
    console.log(storedPromise);

    firstPagePromise.then(pdfPage => {
      pdfViewer.update();
    });

    onePageRendered.then(() => {
      pdfDocument.getOutline().then(outline => {
        this.pdfOutlineViewer.render({ outline });
      });
      pdfDocument.getAttachments().then(attachments => {
        this.pdfAttachmentViewer.render({ attachments });
      });
      pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
        this.pdfLayerViewer.render({ optionalContentConfig, pdfDocument });
      });
    });
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
    // this.pdfRenderingQueue.printing = !!this.printService;
    this.pdfRenderingQueue.isThumbnailViewEnabled = this.pdfSidebar.isThumbnailViewVisible;
    this.pdfRenderingQueue.renderHighestPriority();
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
    // eventBus._on("updatefindmatchescount", webViewerUpdateFindMatchesCount);
    // eventBus._on("updatefindcontrolstate", webViewerUpdateFindControlState);

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
};


// 页面渲染完毕
function webViewerPageRendered({ pageNumber, timestamp, error }) {
  // If the page is still visible when it has finished rendering,
  // ensure that the page number input loading indicator is hidden.
  if (pageNumber === PDFViewerApplication.page) {
    PDFViewerApplication.toolbar.updateLoadingIndicatorState(false);
  }

  // Use the rendered page to set the corresponding thumbnail image.
  if (PDFViewerApplication.pdfSidebar.isThumbnailViewVisible) {
    const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNumber - 1);
    const thumbnailView = PDFViewerApplication.pdfThumbnailViewer.getThumbnail(pageNumber - 1);
    if (pageView && thumbnailView) {
      thumbnailView.setImage(pageView);
    }
  }

  // PDFViewerApplication.externalServices.reportTelemetry({
  //   type: "pageInfo",
  //   timestamp,
  // });
  // // It is a good time to report stream and font types.
  // PDFViewerApplication.pdfDocument.getStats().then(function (stats) {
  //   debugger
  //   PDFViewerApplication.externalServices.reportTelemetry({
  //     type: "documentStats",
  //     stats,
  //   });
  // });
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
  PDFViewerApplication.pdfRenderingQueue.isThumbnailViewEnabled = PDFViewerApplication.pdfSidebar.isThumbnailViewVisible;

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
  const href = PDFViewerApplication.pdfLinkService.getAnchorUrl(location.pdfOpenParams);
  PDFViewerApplication.appConfig.toolbar.viewBookmark.href = href;
  // PDFViewerApplication.appConfig.secondaryToolbar.viewBookmarkButton.href = href;

  // Show/hide the loading indicator in the page number input element.
  const currentPage = PDFViewerApplication.pdfViewer.getPageView(/* index = */ PDFViewerApplication.page - 1);
  const loading = (currentPage && currentPage.renderingState) !== RenderingStates.FINISHED;
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
  if (evt.value !== pdfViewer.currentPageNumber.toString() && evt.value !== pdfViewer.currentPageLabel) {
    PDFViewerApplication.toolbar.setPageNumber(pdfViewer.currentPageNumber, pdfViewer.currentPageLabel);
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
  // PDFViewerApplication.secondaryToolbar.setPageNumber(pageNumber);

  if (PDFViewerApplication.pdfSidebar.isThumbnailViewVisible) {
    PDFViewerApplication.pdfThumbnailViewer.scrollThumbnailIntoView(pageNumber);
  }
}

export {
  PDFViewerApplication,
  // DefaultExternalServices,
  // PDFPrintServiceFactory,
};
