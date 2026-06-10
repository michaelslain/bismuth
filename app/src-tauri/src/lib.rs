use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Quit the app — invoked by the frontend after a self-update build succeeds, so the
// detached updater script (waiting on our pid) can swap the .app bundle + relaunch.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// Clear ONLY the global "intro seen" marker (leaving the vault config intact) + relaunch, so
// the intro replays and then drops the user back into their current vault. Bound to a secret
// keybind in the app (replay the onboarding animation).
#[tauri::command]
fn reset_first_run(app: tauri::AppHandle) {
    if let Some(path) = intro_marker_path(&app) {
        let _ = std::fs::remove_file(path);
    }
    app.restart();
}

// Finish the intro WITHOUT picking a vault — used on replay, where a vault is already
// configured. Marks the intro seen and relaunches back into the existing vault.
#[tauri::command]
fn finish_intro(app: tauri::AppHandle) {
    mark_intro_seen(&app);
    app.restart();
}

// Handle to the spawned core server, killed when the app exits so we never orphan it.
struct Backend(Mutex<Option<CommandChild>>);

// The vault + memory dirs the backend serves. Persisted in the app config dir so a
// Finder-launched app (which has no shell env) remembers the user's choice. First run
// (or a stale/missing vault) prompts a native folder picker.
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct AppConfig {
    vault: String,
    memory: String,
}

fn config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("config.json"))
}

// One-time migration for the bundle-identifier rename (com.michael.obsidian → com.bismuth.app).
// The app-config dir is keyed off the identifier, so a rename would orphan an existing user's
// saved vault (config.json). app_config_dir() now resolves to the NEW id's dir; its parent is
// the per-identifier root (e.g. ~/Library/Application Support). If the OLD dir exists and the
// NEW one doesn't yet, move it across so the saved config carries over. Best-effort; logs on
// failure. Must run BEFORE any config read.
fn migrate_legacy_config_dir(app: &tauri::AppHandle) {
    const OLD_ID: &str = "com.michael.obsidian";
    const NEW_ID: &str = "com.bismuth.app";
    let Ok(new_dir) = app.path().app_config_dir() else {
        return;
    };
    let Some(root) = new_dir.parent() else {
        return;
    };
    let old_dir = root.join(OLD_ID);
    let new_dir = root.join(NEW_ID);
    if old_dir.exists() && !new_dir.exists() {
        if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
            eprintln!("bismuth: legacy config-dir migration failed: {e}");
        }
    }
}

fn read_config(app: &tauri::AppHandle) -> Option<AppConfig> {
    let text = std::fs::read_to_string(config_path(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_config(app: &tauri::AppHandle, cfg: &AppConfig) {
    let Some(path) = config_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(path, text);
    }
}

// A GLOBAL (app-level, not per-vault) marker that the user has completed the first-run intro.
// Kept separate from config.json (the vault paths) so replaying the intro never touches the
// vault, and so it's one flag across all vaults — not re-shown per vault.
fn intro_marker_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("intro-seen"))
}
fn has_seen_intro(app: &tauri::AppHandle) -> bool {
    intro_marker_path(app).map(|p| p.exists()).unwrap_or(false)
}
fn mark_intro_seen(app: &tauri::AppHandle) {
    let Some(path) = intro_marker_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, "1");
}

fn default_memory_dir() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/.claude-bot/memory")
}

// A valid saved vault + memory, or None when there's no usable config yet (first run,
// or a stale/missing vault). Does NOT prompt — first run is handled by the in-app intro,
// whose CTA invokes `choose_first_vault` (below) instead of a startup picker.
fn read_valid_config(app: &tauri::AppHandle) -> Option<(String, String)> {
    let cfg = read_config(app)?;
    if cfg.vault.is_empty() || !std::path::Path::new(&cfg.vault).is_dir() {
        return None;
    }
    let memory = if cfg.memory.is_empty() { default_memory_dir() } else { cfg.memory };
    Some((cfg.vault, memory))
}

// True if a token is safe to drop into our scoped YAML seed unquoted (theme/icon are
// enum values from the frontend; this is just defense-in-depth against odd input).
fn safe_token(s: &str) -> bool {
    !s.is_empty() && s.len() < 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

// Seed a brand-new vault's settings.yaml with the theme/icon picked in the intro, so the
// app paints in that theme immediately. We write only the two keys; the sidecar's
// reconcileSettings fills the rest on boot while preserving these. No-op if a settings
// file already exists, or if either token looks unexpected.
fn seed_vault_settings(vault: &str, theme: &str, icon: &str) {
    if !safe_token(theme) || !safe_token(icon) {
        return;
    }
    let path = std::path::Path::new(vault).join("settings.yaml");
    if path.exists() {
        return;
    }
    let body = format!("appearance:\n  theme: {theme}\n  icon: {icon}\n");
    let _ = std::fs::write(path, body);
}

// First-run CTA: open the native folder picker, make the chosen folder a vault, persist
// config.json, and relaunch into it. Works for a brand-new folder (seeds the picked theme)
// OR an existing vault (its own settings.yaml is left untouched — see seed_vault_settings).
// Returns Ok(false) if the user cancels the picker. On success the app restarts.
#[tauri::command]
async fn choose_first_vault(app: tauri::AppHandle, theme: String, icon: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // Use a channel so we can await the async pick_folder callback without blocking the main thread
    // (blocking_pick_folder can be suppressed on macOS when called from a non-main thread).
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Open or create your Bismuth vault")
        .pick_folder(move |fp| {
            let _ = tx.send(fp.and_then(|f| f.into_path().ok()));
        });
    let picked = rx.recv().map_err(|e| e.to_string())?;
    let Some(path) = picked else {
        return Ok(false);
    };
    let vault = path.to_string_lossy().to_string();
    let _ = std::fs::create_dir_all(&vault);
    let memory = default_memory_dir();
    let _ = std::fs::create_dir_all(&memory);
    seed_vault_settings(&vault, &theme, &icon);
    write_config(&app, &AppConfig { vault, memory });
    mark_intro_seen(&app); // global flag: don't replay the intro on future launches
    // In dev (tauri dev), app.restart() tears down the beforeDevCommand backend → white screen,
    // and the vault comes from OA_VAULT env anyway. So skip the restart in debug builds; the
    // frontend navigates into the app instead. Release does the real relaunch into the new vault.
    if !cfg!(debug_assertions) {
        app.restart();
    }
    Ok(true)
}

// Persist `vault` as the last-opened vault in config.json, so the next cold launch reopens
// it (the main window opens config.json's vault). Called by the frontend's "open folder"
// flow when the user opens another folder as a new brain. Preserves the existing memory dir.
// Ignores an empty/nonexistent path so a bad value never clobbers a good saved vault.
#[tauri::command]
fn set_last_vault(app: tauri::AppHandle, vault: String) {
    if vault.is_empty() || !std::path::Path::new(&vault).is_dir() {
        return;
    }
    let memory = read_config(&app)
        .map(|c| c.memory)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(default_memory_dir);
    write_config(&app, &AppConfig { vault, memory });
}

// The running .app bundle path (…/Bismuth.app), derived from the executable. None in dev
// (the binary isn't inside a .app), which self-disables the git self-updater.
fn running_app_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
        .map(|p| p.to_path_buf())
}

// Find a free TCP port by binding :0 and reading the assigned port. Returns the bound
// listener alongside the port so the caller can keep it open (reserving the port) until
// the moment the sidecar spawns, shrinking the TOCTOU window where another process could
// grab it. Falls back to 4321 (with no held listener) when binding fails.
fn pick_free_port() -> (Option<std::net::TcpListener>, u16) {
    match std::net::TcpListener::bind("127.0.0.1:0").ok().and_then(|l| {
        let port = l.local_addr().ok()?.port();
        Some((l, port))
    }) {
        Some((listener, port)) => (Some(listener), port),
        None => (None, 4321),
    }
}

// Spawn the bundled `bismuth-core` sidecar on a free port for the given vault + memory.
// Returns the port on success so the caller can point the webview at it (via
// window.__OA_API__). Stores the child so it's killed on exit. Best-effort: returns None
// if the spawn fails (the app still opens, against the frontend's default / "disconnected").
fn start_backend(app: &tauri::AppHandle, vault: &str, memory: &str) -> Option<u16> {
    // Hold the bound listener through all the setup below so the port stays reserved; it's
    // released (dropped) right before spawn so the sidecar can claim it (see B53).
    let (listener, port) = pick_free_port();
    let sidecar = match app.shell().sidecar("bismuth-core") {
        Ok(c) => c,
        Err(e) => { eprintln!("bismuth: sidecar resolve failed: {e}"); return None; }
    };
    let mut cmd = sidecar.args(["--vault", vault, "--memory", memory, "--port", &port.to_string()]);
    // Point the sidecar at bundled resources: relay/ (terminal-tab shim → relay auto-attach)
    // and bismuth-tools/ (compiled cli + mcp + docs → machine-wide install on boot). Tauri
    // stages bundle.resources under <resource_dir>/resources/<path>, so prefer that; fall
    // back to <resource_dir> directly for layout robustness.
    if let Ok(res) = app.path().resource_dir() {
        let staged = res.join("resources");
        let base = if staged.join("relay").is_dir() { staged } else { res };
        cmd = cmd
            .env("OA_RELAY_BUNDLE", base.join("relay"))
            .env("OA_BISMUTH_INSTALL_SRC", base.join("bismuth-tools"));
    }
    // Self-update: tell the sidecar which .app is running + our pid, so the detached
    // updater can swap the bundle after we quit (core/src/selfUpdate.ts). Absent in dev.
    if let Some(app_path) = running_app_path() {
        cmd = cmd
            .env("OA_APP_PATH", &app_path)
            .env("OA_APP_PID", std::process::id().to_string());
    }
    // Release the reserved port immediately before spawning so the sidecar can bind it.
    drop(listener);
    match cmd.spawn() {
        Ok((mut rx, child)) => {
            app.state::<Backend>().0.lock().unwrap().replace(child);
            // Drain the event stream so its buffer never blocks the child's IO.
            tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            eprintln!("bismuth: core sidecar started (vault={vault}, :{port})");
            Some(port)
        }
        Err(e) => { eprintln!("bismuth: failed to spawn core sidecar: {e}"); None }
    }
}

// Build the main window. `injected` (Some when we spawned a backend on a known port) is
// set as `window.__OA_API__` before any app JS runs, so the frontend talks to our spawned
// core. In dev (no spawn) it's None → the frontend uses its :4321 default. `first_run`
// sets `window.__OA_FIRST_RUN__`, telling index.tsx to render the intro instead of App
// (there's no backend yet — the intro's CTA picks the vault and relaunches).
fn build_main_window(app: &tauri::AppHandle, injected: Option<String>, first_run: bool, has_vault: bool) -> tauri::Result<()> {
    let mut builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("Bismuth")
        .inner_size(1200.0, 800.0);
    let mut script = String::new();
    if let Some(api) = injected {
        script.push_str(&format!("window.__OA_API__={api:?};"));
    }
    if first_run {
        script.push_str("window.__OA_FIRST_RUN__=true;");
        // On replay a vault is already configured, so the intro's CTA continues into it
        // (finish_intro) instead of forcing a re-pick (choose_first_vault).
        if has_vault {
            script.push_str("window.__OA_HAS_VAULT__=true;");
        }
    }
    if !script.is_empty() {
        builder = builder.initialization_script(&script);
    }
    builder.build()?;
    Ok(())
}

// Pre-rendered dock-icon PNGs, one per Bismuth mark (generated by
// app/scripts/gen-dock-icons.ts from app/public/logos/*.svg). Embedded so they're
// available in both dev and bundled builds without any filesystem lookup.
#[cfg(target_os = "macos")]
fn mark_png(name: &str) -> Option<&'static [u8]> {
    Some(match name {
        "hopper-crystal" => include_bytes!("../icons/marks/hopper-crystal.png"),
        "node-b" => include_bytes!("../icons/marks/node-b.png"),
        "square-funnel" => include_bytes!("../icons/marks/square-funnel.png"),
        "nested-diamonds" => include_bytes!("../icons/marks/nested-diamonds.png"),
        "pinwheel" => include_bytes!("../icons/marks/pinwheel.png"),
        "node-crystal" => include_bytes!("../icons/marks/node-crystal.png"),
        "lattice" => include_bytes!("../icons/marks/lattice.png"),
        "diamond-bloom" => include_bytes!("../icons/marks/diamond-bloom.png"),
        "node-diamond" => include_bytes!("../icons/marks/node-diamond.png"),
        "octagon-bloom" => include_bytes!("../icons/marks/octagon-bloom.png"),
        "spin-cross" => include_bytes!("../icons/marks/spin-cross.png"),
        "tri-bloom" => include_bytes!("../icons/marks/tri-bloom.png"),
        "radial-graph" => include_bytes!("../icons/marks/radial-graph.png"),
        "node-rings" => include_bytes!("../icons/marks/node-rings.png"),
        _ => return None,
    })
}

// Read `appearance.icon` from the active vault's settings.yaml. The vault is OA_VAULT
// (dev) or, in a Finder-launched bundle (no shell env), the one saved in config.json.
// Returns None if unset/absent. Tiny scoped scan rather than a YAML dependency: the
// `icon:` key inside the top-level `appearance:` block.
#[cfg(target_os = "macos")]
fn vault_icon_name(app: &tauri::AppHandle) -> Option<String> {
    let vault = std::env::var("OA_VAULT")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| read_config(app).map(|c| c.vault).filter(|v| !v.is_empty()))?;
    let text = std::fs::read_to_string(std::path::Path::new(&vault).join("settings.yaml")).ok()?;
    let mut in_appearance = false;
    for line in text.lines() {
        let is_top_level = !line.is_empty() && !line.starts_with(char::is_whitespace);
        if is_top_level {
            in_appearance = line.trim_start().starts_with("appearance:");
            continue;
        }
        if in_appearance {
            if let Some(rest) = line.trim().strip_prefix("icon:") {
                return Some(rest.trim().trim_matches(|c| c == '"' || c == '\'').to_string());
            }
        }
    }
    None
}

// Set the macOS dock icon to the vault's chosen mark. Runs at the `Ready` event
// (pre-composite), mirroring Tauri's own internal dev call.
#[cfg(target_os = "macos")]
fn apply_vault_dock_icon(app: &tauri::AppHandle) {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;
    let Some(png) = vault_icon_name(app).and_then(|n| mark_png(&n)) else {
        return;
    };
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let data = NSData::with_bytes(png);
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
        let nsapp = NSApplication::sharedApplication(mtm);
        unsafe { nsapp.setApplicationIconImage(Some(&image)) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Backend(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet, quit_app, choose_first_vault, finish_intro, reset_first_run, set_last_vault])
        .setup(|app| {
            // One-time: carry an existing user's saved vault config across the bundle-id
            // rename. Must run before any config read below (the config dir is id-keyed).
            migrate_legacy_config_dir(&app.handle());
            // Bundled builds spawn their own core server on a free port; in dev
            // (`bun run dev`) the concurrently-launched core already owns :4321, so
            // don't double-spawn. The window is created here (not in tauri.conf.json)
            // so the spawned port can be injected before any app JS runs.
            //
            // Show the intro takeover (no backend) when the user hasn't completed it yet
            // (global `intro-seen` marker absent) OR there's no usable vault. The intro's CTA
            // either picks a vault (choose_first_vault) or, on replay with a vault already
            // configured, continues into it (finish_intro) — both relaunch into the real app.
            let valid = if !cfg!(debug_assertions) { read_valid_config(&app.handle()) } else { None };
            let has_vault = valid.is_some();
            let first_run = !cfg!(debug_assertions) && (!has_seen_intro(&app.handle()) || !has_vault);
            let injected = if first_run {
                None // intro renders standalone; no backend until the user enters a vault
            } else {
                valid
                    .and_then(|(vault, memory)| start_backend(&app.handle(), &vault, &memory))
                    .map(|p| format!("http://localhost:{p}"))
            };
            build_main_window(&app.handle(), injected, first_run, has_vault)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Ready = event {
            apply_vault_dock_icon(app_handle);
        }
        // Kill the spawned core server when the app quits — no orphaned backend.
        if let tauri::RunEvent::Exit = event {
            if let Some(child) = app_handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
