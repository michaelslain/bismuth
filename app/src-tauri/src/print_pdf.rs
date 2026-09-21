// print_pdf.rs — off-screen WebKit print-to-PDF.
//
// Why this exists (issue #9): the export path used to rasterize the document with html2canvas
// and slice the raster into Letter pages at cut points measured from the LIVE DOM. html2canvas
// does not reproduce browser layout — a `<tr>` painted ~25 css px below its DOM position, KaTeX
// glyphs off the baseline, `≠` rendered as a boxed glyph, heading letter-spacing collapsed
// (`Problem1` instead of `Problem 1`) — so a DOM-legal cut stop routinely landed inside painted
// ink. The fix (Task 1's spike, GO verdict) is to print the SAME document through the desktop
// app's own WebKit engine: `NSPrintOperation` does WebKit's real pagination (a line box is never
// split) and yields real, selectable, correctly-shaped text. `createPDFWithConfiguration:` was
// tried and rejected — it yields one long unpaginated page. No Google Chrome dependency is
// introduced here; `core/src/render/htmlRaster.ts`'s Chrome-based `printToPDF` stays CLI-only and
// is never called from this path.
//
// NEVER-ON-SCREEN invariant. Every AppKit/WebKit object this module creates is off-screen for its
// entire life: the `WKWebView` is never attached to a window that is shown, and the `NSWindow`
// used only as `runOperationModalForWindow:`'s target is created at (-20000, -20000), borderless,
// `defer: true`, and is never sent `makeKeyAndOrderFront:`/`orderFront:`. The spike measured
// `isVisible == false` and zero on-screen windows for our pid (`CGWindowListCopyWindowInfo`)
// before, during and after every print. This module must never change that: no `orderFront`, no
// `makeKeyAndOrderFront`, no `setIsVisible(true)`, and the app's own `NSApplication` activation
// policy is never touched here (Tauri already owns that).
//
// Threading. The `#[tauri::command]` `print_pdf` is `async`, but it immediately hands the real
// work to `mac_impl::print_pdf_blocking` via `tauri::async_runtime::spawn_blocking`, so it never
// runs on an async-runtime worker thread — every AppKit/WebKit call below MUST run on the main
// thread (Cocoa's hard rule), and blocking that spawned thread while it polls is fine precisely
// because it isn't one of the async runtime's workers. Each step hops to the main thread via
// `AppHandle::run_on_main_thread`, which only SCHEDULES a closure and returns immediately; this
// worker polls a small shared slot (`on_main`) with a short `std::thread::sleep` between hops
// until the result lands or the 60s deadline passes. `tokio` is not a direct dependency of this
// crate and is not added for this. `print_pdf_blocking` also serializes concurrent calls through
// `PRINT_LOCK` — see the doc comment there.
//
// The `WKWebView` and the off-screen `NSWindow` are `MainThreadOnly` objc2 types (not `Send`), so
// they never cross a thread boundary directly — they live in a `thread_local!` slot for the
// operation's lifetime, touched only from inside `run_on_main_thread` closures. Only small `Send`
// values (bools, an `i8` status, a background-colour string) cross back to the async worker.

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn print_pdf(
    _app: tauri::AppHandle,
    _html: String,
    _title: String,
) -> Result<tauri::ipc::Response, String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSBackingStoreType, NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob,
        NSPrintingPaginationMode, NSWindow, NSWindowStyleMask,
    };
    use objc2_core_foundation::{
        CFDictionary, CFRetained, CFString, CFURL, CFURLPathStyle, CGPoint, CGRect, CGSize,
    };
    use objc2_core_graphics::{
        kCGPDFContextCreator, kCGPDFContextTitle, CGColor, CGContext, CGPDFContextBeginPage,
        CGPDFContextClose, CGPDFContextCreateWithURL, CGPDFContextEndPage, CGPDFDocument,
        CGPDFPage,
    };
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

    /// Matches `PRINT_READY_TITLE` in `app/src/export/printCss.ts` — the TS side has already
    /// injected `WEBKIT_PRINT_HEAD` (which sets this once `document.fonts.ready` resolves) before
    /// calling `invoke('print_pdf', …)`, so this module only needs to poll for it.
    const PRINT_READY_TITLE: &str = "__bismuth_print_ready__";
    const OVERALL_TIMEOUT: Duration = Duration::from_secs(60);
    const MAIN_THREAD_POLL: Duration = Duration::from_millis(25);

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "BismuthPrintDelegate"]
        // -1 = pending, 0 = failed, 1 = succeeded (NSPrintOperation's didRun callback).
        #[ivars = std::cell::Cell<i8>]
        struct PrintDelegate;

        impl PrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _op: &NSPrintOperation, success: objc2::runtime::Bool, _ctx: *mut c_void) {
                self.ivars().set(if success.as_bool() { 1 } else { 0 });
            }
        }
    );

    impl PrintDelegate {
        fn new() -> Retained<Self> {
            let this = Self::alloc().set_ivars(std::cell::Cell::new(-1));
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Everything this operation owns that must stay on the main thread for its whole life.
    struct PrintSession {
        web: Retained<WKWebView>,
        win: Retained<NSWindow>,
        delegate: Option<Retained<PrintDelegate>>,
    }

    thread_local! {
        static ACTIVE: RefCell<Option<PrintSession>> = RefCell::new(None);
        // Sessions whose print was still pending (`delegate` status < 0) when `step_release` ran
        // for the timeout/deadline path. AppKit's `runOperationModalForWindow:` callback can still
        // land after we give up waiting on it; dropping the session out from under that in-flight
        // operation frees the WKWebView/NSWindow/delegate while AppKit still holds pointers to
        // them (use-after-free). Orphaning keeps them alive for the rest of the process instead —
        // a small, bounded leak on the timeout path only, never on the success path.
        static ORPHANS: RefCell<Vec<PrintSession>> = RefCell::new(Vec::new());
    }

    /// Run `f` on the main thread via `run_on_main_thread` (which only schedules — it does not
    /// wait) and block this (non-main) worker thread until the result lands or `deadline` passes.
    /// `f` and its result must be `Send`; the AppKit/WebKit objects it touches stay behind in the
    /// `ACTIVE` thread-local and never cross this boundary themselves.
    fn on_main<F, T>(app: &tauri::AppHandle, deadline: Instant, f: F) -> Result<T, String>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let slot: Arc<Mutex<Option<T>>> = Arc::new(Mutex::new(None));
        let slot2 = slot.clone();
        app.run_on_main_thread(move || {
            let v = f();
            *slot2.lock().unwrap() = Some(v);
        })
        .map_err(|e| format!("run_on_main_thread failed: {e}"))?;
        loop {
            if let Some(v) = slot.lock().unwrap().take() {
                return Ok(v);
            }
            if Instant::now() >= deadline {
                return Err("print timed out".to_string());
            }
            std::thread::sleep(MAIN_THREAD_POLL);
        }
    }

    /// US Letter, all margins 0 — WebKit honours the document's own `@page { margin: 1in }`
    /// (see `printCss.ts`'s `WEBKIT_PRINT_HEAD`) and NSPrintInfo's margins are simply ignored when
    /// `@page` sets them; setting them to 72 here double-applies the margin. Factored out so it's
    /// directly testable without any main-thread/WebKit setup — NSPrintInfo itself is not a
    /// `MainThreadOnly` objc2 type.
    fn letter_print_info() -> Retained<NSPrintInfo> {
        let info = NSPrintInfo::new();
        info.setPaperSize(CGSize::new(612.0, 792.0));
        info.setTopMargin(0.0);
        info.setBottomMargin(0.0);
        info.setLeftMargin(0.0);
        info.setRightMargin(0.0);
        info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        unsafe { info.setJobDisposition(NSPrintSaveJob) };
        info
    }

    static PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A fresh temp path for one print job's output. `print_pdf` appends `.raw.pdf` for the
    /// WebKit-written intermediate (pre margin-fill compose) and uses this path itself for the
    /// final, composed file. Distinct on every call within one process (pid + a monotonic
    /// counter) so each job's files never collide on disk — but prints themselves are NOT
    /// concurrent: `PRINT_LOCK` (see `print_pdf_blocking`) serializes every call through the one
    /// `ACTIVE` session slot, one print at a time.
    fn temp_pdf_path() -> PathBuf {
        let n = PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("bismuth-print-{}-{}.pdf", std::process::id(), n))
    }

    fn cfurl(path: &std::path::Path) -> Result<CFRetained<CFURL>, String> {
        CFURL::with_file_system_path(
            None,
            Some(&CFString::from_str(&path.to_string_lossy())),
            CFURLPathStyle::CFURLPOSIXPathStyle,
            false,
        )
        .ok_or_else(|| "could not build a CFURL for the print output path".to_string())
    }

    /// Step 1 (main thread): create the off-screen WKWebView + NSWindow, kick off the load, and
    /// stash both in `ACTIVE` for the rest of the operation. The webview is deliberately never
    /// attached to any window's contentView — the spike proved that isn't required to print — and
    /// the window is created at (-20000, -20000), borderless, `defer: true`, and is never ordered
    /// front; it exists only to satisfy `runOperationModalForWindow:`.
    fn step_setup_load(html: String) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("print_pdf: not on the main thread")?;
        let rect = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(624.0, 864.0));
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        unsafe { config.preferences().setShouldPrintBackgrounds(true) };
        let web = unsafe { WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect, &config) };
        let win_rect = CGRect::new(CGPoint::new(-20000.0, -20000.0), CGSize::new(624.0, 864.0));
        let win = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                win_rect,
                NSWindowStyleMask::Borderless,
                NSBackingStoreType::Buffered,
                true,
            )
        };
        unsafe { win.setReleasedWhenClosed(false) };
        unsafe { web.loadHTMLString_baseURL(&NSString::from_str(&html), None) };
        ACTIVE.with(|a| *a.borrow_mut() = Some(PrintSession { web, win, delegate: None }));
        Ok(())
    }

    /// Step 2 (main thread, polled): `(isLoading, title)` of the active webview.
    fn step_load_status() -> Result<(bool, Option<String>), String> {
        ACTIVE.with(|a| {
            let b = a.borrow();
            let s = b.as_ref().ok_or("print_pdf: no active session")?;
            let loading = unsafe { s.web.isLoading() };
            let title = unsafe { s.web.title() }.map(|t| t.to_string());
            Ok((loading, title))
        })
    }

    /// Step 3 (main thread): build the print job against `raw_path`, start
    /// `runOperationModalForWindow:` (returns immediately — the delegate fires asynchronously) and
    /// stash the delegate so its status can be polled.
    fn step_start_print(raw_path: PathBuf, title: String) -> Result<(), String> {
        ACTIVE.with(|a| {
            let mut b = a.borrow_mut();
            let s = b.as_mut().ok_or("print_pdf: no active session")?;
            let info = letter_print_info();
            let url = NSURL::fileURLWithPath(&NSString::from_str(&raw_path.to_string_lossy()));
            unsafe {
                info.dictionary().insert(NSPrintJobSavingURL, &*url as &AnyObject);
            }
            let op = unsafe { s.web.printOperationWithPrintInfo(&info) };
            op.setShowsPrintPanel(false);
            op.setShowsProgressPanel(false);
            op.setJobTitle(Some(&NSString::from_str(&title)));
            op.setCanSpawnSeparateThread(true); // THE switch — false hangs every run (spike attempt 1).
            if let Some(view) = op.view() {
                view.setFrame(CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(612.0, 792.0)));
            }
            let del = PrintDelegate::new();
            unsafe {
                op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    &s.win,
                    Some(&del),
                    Some(sel!(printOperationDidRun:success:contextInfo:)),
                    std::ptr::null_mut(),
                )
            };
            s.delegate = Some(del);
            Ok(())
        })
    }

    /// Step 4 (main thread, polled): the delegate's status (-1 pending, 0 failed, 1 succeeded).
    fn step_delegate_status() -> i8 {
        ACTIVE.with(|a| {
            a.borrow()
                .as_ref()
                .and_then(|s| s.delegate.as_ref())
                .map(|d| d.ivars().get())
                .unwrap_or(-1)
        })
    }

    /// Step 5 (main thread): kick off `evaluateJavaScript` for the body background colour; the
    /// completion handler writes into `out` (main-thread callback, `Send` payload only).
    fn step_eval_background(out: Arc<Mutex<Option<String>>>) -> Result<(), String> {
        ACTIVE.with(|a| {
            let b = a.borrow();
            let s = b.as_ref().ok_or("print_pdf: no active session")?;
            let block = RcBlock::new(move |r: *mut AnyObject, _e: *mut NSError| {
                let v = unsafe { r.as_ref() }
                    .and_then(|o| o.downcast_ref::<NSString>())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                *out.lock().unwrap() = Some(v);
            });
            unsafe {
                s.web.evaluateJavaScript_completionHandler(
                    &NSString::from_str("getComputedStyle(document.body).backgroundColor"),
                    Some(&block),
                );
            }
            Ok(())
        })
    }

    /// Step 6 (main thread): release the WKWebView + NSWindow. Always called before returning,
    /// success or failure, so a failed print never leaks a session into the next call — UNLESS
    /// the delegate's status is still pending (-1, see `PrintDelegate::did_run`), meaning
    /// `runOperationModalForWindow:` has not called back yet (the deadline/timeout path). AppKit
    /// does not retain a modal-run delegate itself, so dropping the session here would free the
    /// WKWebView/NSWindow/delegate while AppKit can still send `printOperationDidRun:` to them —
    /// a use-after-free. A still-pending session is moved into `ORPHANS` to keep it alive instead
    /// of being torn down under an in-flight operation; `PRINT_LOCK` still serializes every call
    /// through `ACTIVE`, so this never blocks the next print.
    fn step_release() {
        ACTIVE.with(|a| {
            if let Some(s) = a.borrow_mut().take() {
                let pending = s.delegate.as_ref().map_or(false, |d| d.ivars().get() < 0);
                if pending {
                    ORPHANS.with(|o| o.borrow_mut().push(s));
                }
            }
        });
    }

    /// Parse `rgb(r, g, b)` / `rgba(r, g, b, a)` (WebKit's `getComputedStyle` form) into 0..1
    /// sRGB components. Falls back to white on anything unparseable, matching a blank body.
    fn parse_rgb(s: &str) -> (f64, f64, f64) {
        let nums: Vec<f64> = s
            .split(|c: char| !(c.is_ascii_digit() || c == '.'))
            .filter(|p| !p.is_empty())
            .filter_map(|p| p.parse().ok())
            .collect();
        if nums.len() >= 3 {
            (nums[0] / 255.0, nums[1] / 255.0, nums[2] / 255.0)
        } else {
            (1.0, 1.0, 1.0)
        }
    }

    /// Compose the paginated raw PDF WebKit wrote onto a fresh Letter-sized sheet per page, filled
    /// with the document's own background colour edge to edge (this is what paints the "margins" —
    /// WebKit's raw output has none, since `@page{margin:1in}` on a transparent canvas leaves the
    /// area outside the printed box unset) and sets the PDF's Title metadata (NSPrintOperation's
    /// `jobTitle` does NOT set the PDF's own Title — only this compose step does). Runs off the
    /// main thread: CoreGraphics PDF contexts are not an AppKit/WebKit main-thread-only API.
    fn compose(raw_path: &std::path::Path, out_path: &std::path::Path, title: &str, bg: (f64, f64, f64)) -> Result<(), String> {
        let src = CGPDFDocument::with_url(Some(&*cfurl(raw_path)?)).ok_or("could not open the raw print output")?;
        let media = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(612.0, 792.0));
        let title_cf = CFString::from_str(title);
        let creator_cf = CFString::from_str("Bismuth");
        let aux = unsafe {
            CFDictionary::<CFString, CFString>::from_slices(
                &[kCGPDFContextTitle, kCGPDFContextCreator],
                &[&*title_cf, &*creator_cf],
            )
        };
        let ctx: CFRetained<CGContext> =
            unsafe { CGPDFContextCreateWithURL(Some(&*cfurl(out_path)?), &media, Some(aux.as_opaque())) }
                .ok_or("could not create the output PDF context")?;
        let fill = CGColor::new_srgb(bg.0, bg.1, bg.2, 1.0);
        let pages = CGPDFDocument::number_of_pages(Some(&src));
        if pages == 0 {
            return Err("WebKit produced a 0-page PDF".to_string());
        }
        for i in 1..=pages {
            let page = CGPDFDocument::page(Some(&src), i);
            let mb = CGPDFPage::box_rect(page.as_deref(), objc2_core_graphics::CGPDFBox::MediaBox);
            unsafe { CGPDFContextBeginPage(Some(&ctx), None) };
            CGContext::set_fill_color_with_color(Some(&ctx), Some(&fill));
            CGContext::fill_rect(Some(&ctx), mb);
            CGContext::draw_pdf_page(Some(&ctx), page.as_deref());
            CGPDFContextEndPage(Some(&ctx));
        }
        CGPDFContextClose(Some(&ctx));
        Ok(())
    }

    /// Wait until `path` exists and its size has been stable for 300ms (the raw PDF is written
    /// incrementally by WebKit's print machinery; reading it too early yields a truncated file).
    /// Pure filesystem polling — no AppKit involved, so this runs directly on the async worker.
    fn wait_stable(path: &std::path::Path, deadline: Instant) -> Result<(), String> {
        let mut last: Option<u64> = None;
        let mut stable_since = Instant::now();
        loop {
            let size = std::fs::metadata(path).ok().map(|m| m.len());
            if size.is_some() && size == last {
                if stable_since.elapsed() >= Duration::from_millis(300) {
                    return Ok(());
                }
            } else {
                last = size;
                stable_since = Instant::now();
            }
            if Instant::now() >= deadline {
                return Err("print timed out".to_string());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    /// Blocking entry point — runs on a `spawn_blocking` thread (see the `#[tauri::command]`
    /// wrapper below), never on an async-runtime worker. `PRINT_LOCK` serializes every call: only
    /// one `ACTIVE` print session exists at a time, so a second `print_pdf` invocation (ExportView
    /// fires one per option change, plus `doExport` — two concurrent calls are normal) waits here
    /// instead of racing the first for `ACTIVE`/`s.delegate`.
    pub fn print_pdf_blocking(app: tauri::AppHandle, html: String, title: String) -> Result<tauri::ipc::Response, String> {
        static PRINT_LOCK: Mutex<()> = Mutex::new(());
        let _guard = PRINT_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let deadline = Instant::now() + OVERALL_TIMEOUT;
        let out_path = temp_pdf_path();
        let raw_path = PathBuf::from(format!("{}.raw.pdf", out_path.display()));
        let _ = std::fs::remove_file(&raw_path);
        let _ = std::fs::remove_file(&out_path);

        let result = run(&app, deadline, &out_path, &raw_path, html, title);

        // Always release the main-thread session and delete any temp files, success or failure.
        let _ = on_main(&app, Instant::now() + Duration::from_secs(5), step_release);
        let _ = std::fs::remove_file(&raw_path);
        if result.is_err() {
            let _ = std::fs::remove_file(&out_path);
        }
        result
    }

    fn run(
        app: &tauri::AppHandle,
        deadline: Instant,
        out_path: &std::path::Path,
        raw_path: &std::path::Path,
        html: String,
        title: String,
    ) -> Result<tauri::ipc::Response, String> {
        on_main(app, deadline, move || step_setup_load(html))??;

        loop {
            let (loading, page_title) = on_main(app, deadline, step_load_status)??;
            if !loading && page_title.as_deref() == Some(PRINT_READY_TITLE) {
                break;
            }
            if Instant::now() >= deadline {
                return Err("print timed out".to_string());
            }
            std::thread::sleep(MAIN_THREAD_POLL);
        }

        {
            let raw_path = raw_path.to_path_buf();
            let title = title.clone();
            on_main(app, deadline, move || step_start_print(raw_path, title))??;
        }

        loop {
            let status = on_main(app, deadline, step_delegate_status)?;
            if status >= 0 {
                if status == 0 {
                    return Err("WebKit print operation failed".to_string());
                }
                break;
            }
            if Instant::now() >= deadline {
                return Err("print timed out".to_string());
            }
            std::thread::sleep(MAIN_THREAD_POLL);
        }

        wait_stable(raw_path, deadline)?;

        let bg_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        {
            let bg_slot = bg_slot.clone();
            on_main(app, deadline, move || step_eval_background(bg_slot))??;
        }
        let bg_str = loop {
            if let Some(v) = bg_slot.lock().unwrap().clone() {
                break v;
            }
            if Instant::now() >= deadline {
                return Err("print timed out".to_string());
            }
            std::thread::sleep(MAIN_THREAD_POLL);
        };

        compose(raw_path, out_path, &title, parse_rgb(&bg_str))?;

        let bytes = std::fs::read(out_path).map_err(|e| format!("reading composed pdf: {e}"))?;
        let _ = std::fs::remove_file(out_path);
        Ok(tauri::ipc::Response::new(bytes))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn letter_print_info_is_us_letter_zero_margin() {
            let info = letter_print_info();
            let size = info.paperSize();
            assert_eq!((size.width, size.height), (612.0, 792.0));
            assert_eq!(info.topMargin(), 0.0);
            assert_eq!(info.bottomMargin(), 0.0);
            assert_eq!(info.leftMargin(), 0.0);
            assert_eq!(info.rightMargin(), 0.0);
        }

        #[test]
        fn temp_pdf_path_is_distinct_and_pdf() {
            let a = temp_pdf_path();
            let b = temp_pdf_path();
            assert_ne!(a, b);
            assert_eq!(a.extension().and_then(|e| e.to_str()), Some("pdf"));
            assert_eq!(b.extension().and_then(|e| e.to_str()), Some("pdf"));
        }
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn print_pdf(app: tauri::AppHandle, html: String, title: String) -> Result<tauri::ipc::Response, String> {
    // AppKit/WebKit calls in mac_impl block on main-thread round trips (`on_main`'s poll loop),
    // so this runs off the async runtime entirely via `spawn_blocking` rather than as a direct
    // `.await` on an async-runtime worker thread.
    tauri::async_runtime::spawn_blocking(move || mac_impl::print_pdf_blocking(app, html, title))
        .await
        .map_err(|e| format!("print task failed: {e}"))?
}
