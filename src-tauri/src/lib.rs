use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestInput {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    proxy_url: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponseOutput {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    distro: String,
    distro_like: String,
    desktop: String,
    session: String,
    display_server: String,
    gpu_vendors: Vec<String>,
    renderer_mode: String,
    applied_env: Vec<String>,
    startup_log: String,
    media_framework_bundled: bool,
    gstreamer_ready: bool,
    gstreamer_plugin_path: String,
    gstreamer_scanner: String,
}

#[tauri::command]
async fn http_request(input: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    let parsed = url::Url::parse(&input.url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http:// and https:// API URLs are allowed".into());
    }

    let timeout_ms = input.timeout_ms.unwrap_or(45_000).clamp(3_000, 120_000);
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        // Do not forward custom auth headers through redirects to another host.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Keyflow/2.5.0");

    if let Some(proxy_url) = input.proxy_url.as_deref().map(str::trim).filter(|x| !x.is_empty()) {
        let proxy_parsed = url::Url::parse(proxy_url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
        match proxy_parsed.scheme() {
            "http" | "https" | "socks5" | "socks5h" => {}
            _ => return Err("Proxy must use http://, https://, socks5://, or socks5h://".into()),
        }
        let proxy = reqwest::Proxy::all(proxy_url).map_err(|e| format!("Invalid proxy configuration: {e}"))?;
        builder = builder.proxy(proxy);
    }

    let client = builder.build().map_err(|e| format!("Could not create HTTP client: {e}"))?;

    let method = input
        .method
        .unwrap_or_else(|| "GET".into())
        .parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid HTTP method: {e}"))?;

    let mut request = client.request(method, parsed);
    if let Some(headers) = input.headers {
        for (name, value) in headers {
            let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|e| format!("Invalid header name: {e}"))?;
            let value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|e| format!("Invalid header value: {e}"))?;
            request = request.header(name, value);
        }
    }
    if let Some(body) = input.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(name.as_str().to_string(), v.to_string());
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Could not read response: {e}"))?;
    if bytes.len() > 6 * 1024 * 1024 {
        return Err("API response is larger than Keyflow's 6 MiB safety limit".into());
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(HttpResponseOutput { status, headers, body })
}

#[tauri::command]
fn runtime_info(state: tauri::State<'_, RuntimeInfo>) -> RuntimeInfo {
    state.inner().clone()
}

fn read_os_release() -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Ok(raw) = fs::read_to_string("/etc/os-release") {
        for line in raw.lines() {
            if let Some((key, value)) = line.split_once('=') {
                out.insert(
                    key.to_string(),
                    value.trim().trim_matches('"').to_ascii_lowercase(),
                );
            }
        }
    }
    out
}

fn detect_gpu_vendors() -> Vec<String> {
    let mut vendors = Vec::new();
    if let Ok(entries) = fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            let vendor_path = entry.path().join("device/vendor");
            if let Ok(value) = fs::read_to_string(vendor_path) {
                // Keep the normalized PCI vendor id owned for the whole match.
                // Matching on a borrowed slice from an inline lowercase temporary would
                // trigger Rust E0716, so bind the owned String first.
                let normalized = value.trim().to_ascii_lowercase();
                let label = match normalized.as_str() {
                    "0x8086" => "intel".to_string(),
                    "0x10de" => "nvidia".to_string(),
                    "0x1002" | "0x1022" => "amd".to_string(),
                    _ => normalized,
                };
                if !vendors.iter().any(|v| v == &label) {
                    vendors.push(label);
                }
            }
        }
    }
    vendors
}

fn write_startup_log(info: &RuntimeInfo) {
    let path = PathBuf::from(&info.startup_log);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let lines = format!(
        "Keyflow 2.5.0 startup\ndistro={} like={}\ndesktop={} session={} display={}\ngpu={}\nrenderer={}\nmedia_framework_bundled={} gstreamer_ready={}\ngstreamer_plugin_path={}\ngstreamer_scanner={}\napplied_env={}\n",
        info.distro,
        info.distro_like,
        info.desktop,
        info.session,
        info.display_server,
        info.gpu_vendors.join(","),
        info.renderer_mode,
        info.media_framework_bundled,
        info.gstreamer_ready,
        info.gstreamer_plugin_path,
        info.gstreamer_scanner,
        info.applied_env.join(",")
    );
    let _ = fs::write(path, lines);
}

#[cfg(target_os = "linux")]
fn configure_appimage_gstreamer(applied_env: &mut Vec<String>) -> (bool, bool, String, String) {
    let appdir = std::env::var("APPDIR").unwrap_or_default();
    if appdir.is_empty() {
        return (false, false, String::new(), String::new());
    }

    let plugin_dir = PathBuf::from(&appdir).join("usr/lib/gstreamer-1.0");
    let scanner = PathBuf::from(&appdir)
        .join("usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner");
    let appsrc = plugin_dir.join("libgstapp.so").is_file();
    let autodetect = plugin_dir.join("libgstautodetect.so").is_file();
    let pulse = plugin_dir.join("libgstpulseaudio.so").is_file();
    let alsa = plugin_dir.join("libgstalsa.so").is_file();
    let bundled = plugin_dir.is_dir();

    if bundled {
        let plugin = plugin_dir.to_string_lossy().into_owned();
        // Tauri's AppRun GStreamer hook sets the same values. Repeat them here
        // before WebKitGTK is initialized so a desktop launcher/compositor can
        // never strip the media path and make WebAudio silently lose appsrc or
        // autoaudiosink on EndeavourOS.
        std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &plugin);
        std::env::set_var("GST_PLUGIN_PATH_1_0", &plugin);
        std::env::set_var("GST_REGISTRY_REUSE_PLUGIN_SCANNER", "no");
        applied_env.push(format!("GST_PLUGIN_SYSTEM_PATH_1_0={plugin}"));
        applied_env.push(format!("GST_PLUGIN_PATH_1_0={plugin}"));
        if scanner.is_file() {
            let scanner_value = scanner.to_string_lossy().into_owned();
            std::env::set_var("GST_PLUGIN_SCANNER_1_0", &scanner_value);
            applied_env.push(format!("GST_PLUGIN_SCANNER_1_0={scanner_value}"));
        }
    }

    let ready = bundled && appsrc && autodetect && (pulse || alsa) && scanner.is_file();
    (
        bundled,
        ready,
        plugin_dir.to_string_lossy().into_owned(),
        scanner.to_string_lossy().into_owned(),
    )
}

#[cfg(target_os = "linux")]
fn prepare_runtime() -> RuntimeInfo {
    let os = read_os_release();
    let distro = os.get("ID").cloned().unwrap_or_else(|| "linux".into());
    let distro_like = os.get("ID_LIKE").cloned().unwrap_or_default();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("DESKTOP_SESSION"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let session = std::env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let display_server = if session == "wayland" || std::env::var_os("WAYLAND_DISPLAY").is_some() {
        "wayland"
    } else if std::env::var_os("DISPLAY").is_some() {
        "x11"
    } else {
        "unknown"
    }
    .to_string();
    let gpu_vendors = detect_gpu_vendors();
    let override_mode = std::env::var("KEYFLOW_RENDERER")
        .unwrap_or_else(|_| "auto".into())
        .to_ascii_lowercase();
    let is_arch_family = distro == "endeavouros"
        || distro == "arch"
        || distro_like.split_whitespace().any(|x| x == "arch");
    let is_kde = desktop.contains("kde") || desktop.contains("plasma");
    let wayland = display_server == "wayland";
    let mut applied_env = Vec::new();
    let (media_framework_bundled, gstreamer_ready, gstreamer_plugin_path, gstreamer_scanner) =
        configure_appimage_gstreamer(&mut applied_env);
    let renderer_mode;

    let set_env = |key: &str, value: &str, applied: &mut Vec<String>| {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
            applied.push(format!("{key}={value}"));
        }
    };

    match override_mode.as_str() {
        "normal" | "native" => {
            renderer_mode = "native".to_string();
        }
        "software" => {
            set_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1", &mut applied_env);
            set_env("WEBKIT_DISABLE_COMPOSITING_MODE", "1", &mut applied_env);
            renderer_mode = "software-safe".to_string();
        }
        "x11" | "x11-safe" => {
            set_env("GDK_BACKEND", "x11", &mut applied_env);
            set_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1", &mut applied_env);
            renderer_mode = "x11-safe".to_string();
        }
        _ => {
            // EndeavourOS is the primary target. Tauri 2.12 fixes the AppImage-side
            // Mesa/libwayland mismatch, while this WebKit switch protects the remaining
            // driver-specific DMABUF path. Do not force X11 here: the 2.12 GTK hook
            // intentionally preserves the user's native Wayland/X11 backend.
            if distro == "endeavouros" {
                set_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1", &mut applied_env);
                // Keyflow is a text/UI application, not a WebGL workload. When it is
                // launched from an AppImage on EndeavourOS, prefer reliability over
                // WebKitGTK's accelerated compositor. This is Tauri's documented
                // last-resort workaround for blank/black WebKitGTK windows and keeps
                // normal `cargo tauri dev` / native executions accelerated.
                let is_appimage = std::env::var_os("APPIMAGE").is_some()
                    || std::env::var_os("APPDIR").is_some();
                if is_appimage {
                    set_env("WEBKIT_DISABLE_COMPOSITING_MODE", "1", &mut applied_env);
                }
                if wayland && gpu_vendors.iter().any(|x| x == "nvidia") {
                    set_env("__NV_DISABLE_EXPLICIT_SYNC", "1", &mut applied_env);
                }
                renderer_mode = if is_appimage {
                    "endeavouros-appimage-software-safe".to_string()
                } else if wayland {
                    "endeavouros-wayland-dmabuf-safe".to_string()
                } else {
                    "endeavouros-x11-dmabuf-safe".to_string()
                };
            } else if is_arch_family && is_kde && wayland {
                set_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1", &mut applied_env);
                renderer_mode = "arch-plasma-wayland-dmabuf-safe".to_string();
            } else if wayland && gpu_vendors.iter().any(|x| x == "nvidia") {
                set_env("__NV_DISABLE_EXPLICIT_SYNC", "1", &mut applied_env);
                set_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1", &mut applied_env);
                renderer_mode = "wayland-nvidia-dmabuf-safe".to_string();
            } else {
                renderer_mode = "native".to_string();
            }
        }
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let startup_log = format!("{home}/.local/state/keyflow/startup.log");
    let info = RuntimeInfo {
        distro,
        distro_like,
        desktop,
        session,
        display_server,
        gpu_vendors,
        renderer_mode,
        applied_env,
        startup_log,
        media_framework_bundled,
        gstreamer_ready,
        gstreamer_plugin_path,
        gstreamer_scanner,
    };
    write_startup_log(&info);
    info
}

#[cfg(not(target_os = "linux"))]
fn prepare_runtime() -> RuntimeInfo {
    RuntimeInfo {
        distro: "unsupported".into(),
        distro_like: String::new(),
        desktop: String::new(),
        session: String::new(),
        display_server: String::new(),
        gpu_vendors: Vec::new(),
        renderer_mode: "native".into(),
        applied_env: Vec::new(),
        startup_log: String::new(),
        media_framework_bundled: false,
        gstreamer_ready: false,
        gstreamer_plugin_path: String::new(),
        gstreamer_scanner: String::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = prepare_runtime();
    tauri::Builder::default()
        .manage(runtime)
        .invoke_handler(tauri::generate_handler![http_request, runtime_info])
        .run(tauri::generate_context!())
        .expect("error while running Keyflow");
}
