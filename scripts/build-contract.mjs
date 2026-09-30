import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const audio = await readFile(new URL('../app/audio/audio.js', import.meta.url), 'utf8');
const typingEngine = await readFile(new URL('../app/core/typing-engine.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
const layouts = await readFile(new URL('../app/core/layouts.js', import.meta.url), 'utf8');
const keyboardUi = await readFile(new URL('../app/ui/keyboard.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../app/core/storage.js', import.meta.url), 'utf8');
const providers = await readFile(new URL('../app/ai/providers.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../app/main.js', import.meta.url), 'utf8');
const rust = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const cargoToml = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const tauri = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const caps = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
const workflow = await readFile(new URL('../.github/workflows/linux.yml', import.meta.url), 'utf8');
const appimageAudit = await readFile(new URL('../scripts/appimage-runtime-audit.sh', import.meta.url), 'utf8');
const uploader = workflow;

assert.equal(pkg.dependencies?.cuelume, '0.2.4', 'Cuelume must stay pinned to the tested GitHub release.');
assert.equal(pkg.dependencies?.['@tauri-apps/api'], '2.12.0', 'Tauri JS API must stay on the repaired 2.12 line.');
assert.equal(pkg.scripts?.build, 'vite build', 'Frontend build stays independent from the desktop shell.');
assert.equal(pkg.scripts?.['tauri:build'], 'cargo tauri build', 'EndeavourOS must use Arch cargo-tauri, not the npm Tauri CLI.');
assert.ok(!pkg.devDependencies?.['@tauri-apps/cli'], 'Do not install the Tauri CLI through npm on EndeavourOS.');
assert.ok(!pkg.devDependencies?.['@tauri-apps/cli-linux-x64-gnu'], 'Do not depend on npm native Tauri bindings.');
assert.match(cargoToml, /^tauri\s*=\s*\{\s*version\s*=\s*"=2\.12\.0"/m, 'Rust tauri must stay on the repaired 2.12.0 AppImage release.');
assert.match(cargoToml, /^tauri-runtime\s*=\s*\{\s*version\s*=\s*"=2\.12\.0"/m, 'tauri-runtime must stay on the 2.12.0 runtime line.');
assert.match(cargoToml, /^tauri-runtime-wry\s*=\s*\{\s*version\s*=\s*"=2\.12\.0"/m, 'tauri-runtime-wry must stay on the 2.12.0 runtime line.');
assert.match(cargoToml, /^tauri-utils\s*=\s*\{\s*version\s*=\s*"=2\.10\.0"/m, 'tauri-utils must stay on the 2.12 release family.');
assert.match(cargoToml, /^tauri-macros\s*=\s*\{\s*version\s*=\s*"=2\.7\.0"/m, 'tauri-macros must stay on the 2.12 release family.');
assert.match(cargoToml, /^tauri-build\s*=\s*\{\s*version\s*=\s*"=2\.7\.0"/m, 'tauri-build must stay on the 2.12 release family.');
assert.match(cargoToml, /^tauri-codegen\s*=\s*\{\s*version\s*=\s*"=2\.7\.0"/m, 'tauri-codegen must stay on the 2.12 release family.');
assert.equal(pkg.engines?.node, '>=22 <23', 'Frontend build is pinned to Node 22 LTS.');
assert.ok(!pkg.scripts?.postinstall, 'Do not single-file-vendor Cuelume.');
assert.match(audio, /from ['"]cuelume['"]/, 'Real key sounds must use Cuelume directly.');
assert.match(audio, /play\(name, options\)/, 'Typing feedback must call Cuelume play() directly.');
assert.match(audio, /requestCue\('type'/, 'Accepted keys must use Cuelume type cues.');
assert.match(audio, /requestCue\('error'/, 'Mistakes must use Cuelume error cues.');
assert.match(audio, /requestCue\('success'/, 'Completion must use Cuelume success cues.');
assert.match(audio, /setTheme\(THEMES\[profile\]/, 'Sound profiles must map to Cuelume themes.');
assert.doesNotMatch(audio, /createOscillator|createBufferSource|new AudioContext|new Ctor/, 'Keyflow must not maintain a second custom synth beside Cuelume.');
assert.match(storage, /keySounds:true/, 'Per-key sound must default on after the silent-default regression.');
assert.match(storage, /soundProfile:'mechanical'/, 'Cuelume audio coach must persist a sound profile.');
assert.match(main, /id=\"test-sound\"/, 'Settings must expose an explicit sound test on WebKitGTK.');
assert.match(main, /id=\"audio-coach\"/, 'Practice view must expose the audio coach where it is actually useful.');
assert.doesNotMatch(typingEngine, /\\u00A0|00A0|String\.fromCharCode\(160\)/i, 'Practice renderer must never replace normal spaces with NBSP.');
assert.match(typingEngine, /document\.createTextNode\(this\.target\)/, 'Practice text must remain one uninterrupted text node so Persian cursive shaping survives.');
assert.match(typingEngine, /shouldUseCustomHighlights\(this\.language\)/, 'Persian must route through the explicit safe highlight policy.');
assert.match(typingEngine, /language!==['"]fa['"] && !!available/, 'Persian safe highlight policy must always reject CSS Custom Highlights.');
assert.match(typingEngine, /typing-glyph-layer/, 'Persian text needs a dedicated uninterrupted glyph layer.');
assert.doesNotMatch(typingEngine, /span\.className=['"]glyph['"]/, 'Do not reintroduce per-grapheme spans; they break Arabic/Persian joining in WebKitGTK.');
assert.match(styles, /#typing-text\.rtl\{contain:none!important;transform:none!important/, 'Persian text must not be promoted into a transformed/composited layer.');
assert.match(styles, /typing-text\.rtl[\s\S]*unicode-bidi:normal/, 'Persian passage must use one normal RTL bidi paragraph rather than nested plaintext runs.');
assert.match(styles, /\.typing-text\.rtl\{[^}]*letter-spacing:0/, 'Persian shaping must not inject tracking between joining glyphs.');
assert.match(styles, /typing-text\.rtl \.typing-marker\.current/, 'Persian current-key feedback must be geometric and must not recolor the glyph run.');
assert.doesNotMatch(audio, /vendor\/cuelume/, 'The stale single-file Cuelume vendor path must never return.');
assert.ok(caps.permissions.includes('core:window:allow-start-resize-dragging'), 'Borderless Linux window needs explicit resize-drag permission.');

assert.deepEqual(tauri.bundle.targets, ['appimage'], 'EndeavourOS build must emit AppImage only.');
assert.equal(tauri.bundle?.linux?.appimage?.bundleMediaFramework, true, 'Audio AppImage must bundle the GStreamer media framework.');
assert.match(workflow, /runs-on:\s*ubuntu-22\.04/, 'AppImage CI must use a native GitHub VM baseline, not a job container.');
assert.doesNotMatch(workflow, /^\s*container:/m, 'AppImage packaging must not run inside a GitHub job container (linuxdeploy/FUSE regression).');
assert.match(workflow, /node-version:\s*['\"]?22['\"]?/, 'CI must use Node 22 LTS.');
assert.match(workflow, /cargo install tauri-cli --version 2\.12\.0 --locked/, 'CI must install the pinned native Rust Tauri CLI.');
assert.match(workflow, /cargo tauri --version/, 'CI must verify cargo-tauri before compiling.');
assert.match(workflow, /APPIMAGE_EXTRACT_AND_RUN/, 'CI must support extraction-mode AppImage helper execution.');
assert.match(workflow, /libfuse2/, 'Native AppImage runner should install FUSE2 compatibility.');
assert.match(workflow, /gstreamer1\.0-plugins-base/, 'CI must install GStreamer Base plugins for appsrc/WebAudio.');
assert.match(workflow, /gstreamer1\.0-plugins-good/, 'CI must install GStreamer Good plugins for autoaudiosink/PulseAudio.');
assert.match(workflow, /gst-inspect-1\.0 appsrc/, 'CI must prove appsrc exists before packaging.');
assert.match(workflow, /gst-inspect-1\.0 autoaudiosink/, 'CI must prove autoaudiosink exists before packaging.');
assert.match(workflow, /--appimage-extract/, 'CI must smoke-test the finished AppImage before upload.');
assert.match(workflow, /appimage-runtime-audit\.sh/, 'CI must audit the extracted AppImage for rolling-Mesa ABI conflicts.');
assert.match(appimageAudit, /libwayland-client/, 'AppImage audit must explicitly reject bundled libwayland-client.');
assert.match(appimageAudit, /allowed Wayland support library/, 'Audit must distinguish Tauri 2.12 Wayland shims from the Mesa-breaking client ABI.');
assert.match(appimageAudit, /libgstapp\.so/, 'AppImage audit must require GStreamer appsrc plugin.');
assert.match(appimageAudit, /libgstautodetect\.so/, 'AppImage audit must require autoaudiosink/autodetect plugin.');
assert.match(appimageAudit, /libgstpulseaudio\.so/, 'AppImage audit must accept a PulseAudio sink plugin.');
assert.match(appimageAudit, /GST_PLUGIN_SCANNER_1_0/, 'AppImage audit must require the bundled plugin scanner hook.');
const fatalAuditBlock = appimageAudit.match(/fatal_patterns=\([\s\S]*?\n\)/)?.[0] ?? '';
assert.ok(fatalAuditBlock, 'AppImage audit must define a fatal_patterns block.');
assert.doesNotMatch(fatalAuditBlock, /libwayland-egl/, 'libwayland-egl must not be a fatal audit pattern on the repaired Tauri 2.12 path.');
assert.doesNotMatch(fatalAuditBlock, /libwayland-cursor/, 'libwayland-cursor must not be a fatal audit pattern on the repaired Tauri 2.12 path.');
assert.match(pkg.scripts?.check ?? '', /test-appimage-runtime-audit\.sh/, 'npm run check must regression-test the AppImage audit itself.');
assert.match(workflow, /tauri-version-contract\.mjs|npm run check/, 'CI must run the Tauri JS/Rust version contract before packaging.');
assert.doesNotMatch(workflow, /@tauri-apps\/cli-linux-x64-gnu/, 'CI must not return to npm native Tauri bindings.');
assert.doesNotMatch(workflow, /actions\/upload-artifact@/, 'GitHub artifact storage must not be used; upload to Serv00.');
assert.match(workflow, /SERV00_UPLOAD_URL/, 'Serv00 upload URL must be wired in CI.');
assert.match(workflow, /SERV00_UPLOAD_TOKEN/, 'Serv00 upload token must be wired in CI.');
assert.match(workflow, /repository=\$\{GITHUB_REPOSITORY\}/, 'Serv00 upload must include OWNER/REPO metadata.');
assert.match(workflow, /SHA256SUMS\.txt/, 'AppImage checksum must be uploaded with the build.');
assert.doesNotMatch(workflow, /path:\s*.*(?:bundle\/deb|\.deb|\.rpm)/, 'CI must not publish deb/rpm artifacts.');
assert.match(rust, /WEBKIT_DISABLE_DMABUF_RENDERER/, 'Arch/KDE WebKitGTK compatibility fallback is required.');
assert.match(rust, /KEYFLOW_RENDERER/, 'Renderer override must remain available for diagnostics.');
assert.match(rust, /configure_appimage_gstreamer/, 'Native startup must reinforce the AppImage GStreamer environment before WebKit starts.');
assert.match(rust, /GST_PLUGIN_SYSTEM_PATH_1_0/, 'Native startup must point WebKitGTK at bundled GStreamer plugins.');
assert.match(rust, /libgstapp\.so/, 'Native diagnostics must verify appsrc exists in the media bundle.');
assert.match(rust, /libgstautodetect\.so/, 'Native diagnostics must verify autoaudiosink plugin exists.');
assert.doesNotMatch(
  rust,
  /to_ascii_lowercase\(\)\.as_str\(\)/,
  'Rust must not borrow as_str() from a temporary lowercase String (E0716 regression).'
);
assert.match(
  rust,
  /let normalized = value\.trim\(\)\.to_ascii_lowercase\(\);[\s\S]*match normalized\.as_str\(\)/,
  'GPU vendor normalization must bind the owned String before matching.'
);
assert.match(rust, /\.local\/state\/keyflow\/startup\.log/, 'Startup renderer diagnostics must be persisted.');
assert.match(layouts, /export const PHYSICAL_ROWS/, 'Physical keyboard rows must have a canonical export.');
assert.match(layouts, /export const KEY_ROWS = PHYSICAL_ROWS/, 'Keep KEY_ROWS compatibility alias to prevent stale UI import regressions.');
assert.match(keyboardUi, /import \{ PHYSICAL_ROWS, formatChord \}/, 'Keyboard UI must import the canonical PHYSICAL_ROWS export.');
assert.match(layouts, /xkb_symbols \"pes\"|Exact XKB mapping/, 'Persian standard profile must be derived from the real Linux XKB layout.');
assert.match(layouts, /KeyM:\['پ'/, 'Standard Persian پ must map to KeyM on ir(pes).');
assert.match(layouts, /Space:\[' ','‌'/, 'Standard Persian must expose Shift+Space ZWNJ.');

assert.match(rust, /distro == "endeavouros"[\s\S]*WEBKIT_DISABLE_DMABUF_RENDERER/, 'EndeavourOS must default to the DMABUF-safe WebKitGTK renderer on both X11 and Wayland.');
assert.match(rust, /is_appimage[\s\S]*WEBKIT_DISABLE_COMPOSITING_MODE/, 'EndeavourOS AppImage must use the WebKitGTK software-compositing safety path.');
assert.match(storage, /DB_VERSION=2/, 'Session DB migration with compound recent-session index is required.');
assert.match(storage, /languageStartedAt/, 'Recent per-language sessions must use an IndexedDB compound index.');
assert.match(main, /Weak-key heatmap|weak-key heatmap/i, 'Physical weak-key heatmap must stay available.');
assert.match(main, /Adaptive difficulty/, 'Adaptive difficulty must stay available.');
assert.match(main, /Retry mistakes/, 'Session recovery drill must stay available.');
assert.ok(!providers.includes('\x08'), 'Provider picker must not contain hidden backspace control characters in regexes.');
assert.match(providers, /free\\b/, 'Smart free-model matching must use a real word boundary.');

try {
  await access(new URL('../scripts/vendor-cuelume.mjs', import.meta.url), constants.F_OK);
  assert.fail('scripts/vendor-cuelume.mjs must not exist.');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log('✓ build contract: repaired Tauri 2.12 AppImage stack + precise Mesa ABI audit + Node 22 + Serv00 + EndeavourOS target');
